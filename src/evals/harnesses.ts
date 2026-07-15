import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import path from "node:path"

import type { AgentAdapter, AgentUsage } from "../agents/types.js"
import { addAgentUsage } from "../agents/types.js"
import type { ProgrammersLoopConfig } from "../config.js"
import { runProcess } from "../process.js"
import { tokenizeCommand } from "../proof.js"
import {
  createAssignmentScaffold,
  createExecPlanScaffold,
} from "../scaffold.js"
import {
  executeExecPlan,
  grillExecPlan,
  sumUsage,
  validateExecPlan,
  WorkflowPhaseError,
  writeExecPlan,
  type WorkflowReceipt,
} from "../workflows/exec-plan.js"
import type {
  EpisodeSetupRecord,
  EvalSystem,
  HarnessPhaseRecord,
} from "./manifest.js"
import { materializeWorkspace, workspaceFingerprint } from "./task-package.js"
import type { TaskPackage } from "./task-package.js"

/**
 * The symmetric no-human preamble mandated by the Owner-Question Policy in
 * `docs/evals/DECISIONS.md`. Both harness conditions receive this identical
 * text so the treatment can never draw hidden human help the baseline cannot.
 * An episode that halts to ask the owner is scored as a failure in every arm.
 */
export const NO_HUMAN_PREAMBLE = `No human operator is available during this task. You must make every decision autonomously and record each material decision and its rationale as you go. Do not stop to ask the owner a question or wait for confirmation: there is no one to answer, and an episode that halts for owner input is scored as a failure. When requirements are ambiguous, choose the most defensible interpretation, note it, and continue.`

/**
 * Files the runner introduces into every sandbox that the hidden grader must
 * never attribute to the evaluated agent. `.runtime/` holds agent-event
 * transcripts and phase receipts (both conditions write there); the two
 * `docs/` entries hold the Loop treatment's contract copy and scaffolded
 * planning artifacts. Ignoring them keeps the baseline commit and every later
 * `git status` limited to the agent's genuine, in-scope edits. Exact paths are
 * ignored rather than a blanket `docs/` so a task shipping its own docs cannot
 * be silently hidden.
 */
export const EVAL_GITIGNORE = [
  ".runtime/",
  "/docs/assignments/",
  "/docs/contracts/",
  "",
].join("\n")

/**
 * Merge the runner's ignore entries onto a workspace's own `.gitignore`
 * instead of clobbering it. Overwriting silently un-ignored everything the
 * task ignored for itself — most damagingly `node_modules/` for tasks whose
 * `setup_command` installs dependencies, which would then flood the baseline
 * commit and every `git status`-based scope check. The workspace's content is
 * kept byte-intact at the top; eval entries the workspace already lists are
 * not repeated.
 */
export function mergeEvalGitignore(existing: string | null): string {
  if (existing === null || existing.trim() === "") return EVAL_GITIGNORE
  const present = new Set(existing.split(/\r?\n/).map((line) => line.trim()))
  const additions = EVAL_GITIGNORE.split("\n").filter(
    (line) => line !== "" && !present.has(line),
  )
  const base = existing.endsWith("\n") ? existing : `${existing}\n`
  if (additions.length === 0) return base
  return `${base}${additions.join("\n")}\n`
}

/**
 * A failed `setup_command`. Sandbox preparation throws it so the runner can
 * map the episode to `infrastructure_failure` (a broken install is never a
 * scored model result) while still persisting the setup evidence it carries.
 */
export class SetupCommandError extends Error {
  readonly setup: EpisodeSetupRecord

  constructor(message: string, setup: EpisodeSetupRecord) {
    super(message)
    this.name = "SetupCommandError"
    this.setup = setup
  }
}

/**
 * Execute the task's `setup_command` inside the sandbox. The command is
 * tokenized with the proof tokenizer (no shell, no operators or
 * substitution) and spawned directly in the sandbox cwd with the runner's
 * environment. It is capped by the task's own wall budget — setup may not
 * consume more wall time than the episode it prepares — and bounded output.
 * Non-zero exit or timeout throws {@link SetupCommandError}.
 */
async function runSetupCommand(params: {
  command: string
  maxOutputBytes: number
  maxWallMs: number
  sandboxDir: string
}): Promise<EpisodeSetupRecord> {
  let argv: string[]
  try {
    argv = tokenizeCommand(params.command)
  } catch (error) {
    throw new SetupCommandError(
      `setup_command could not be tokenized (${error instanceof Error ? error.message : String(error)}): ${params.command}`,
      {
        command: params.command,
        exitCode: -1,
        networkCarveOut: true,
        timedOut: false,
        wallMs: 0,
      },
    )
  }
  const startedAt = Date.now()
  const result = await runProcess({
    args: argv.slice(1),
    command: argv[0] ?? "",
    cwd: params.sandboxDir,
    maxOutputBytes: params.maxOutputBytes,
    timeoutMs: params.maxWallMs,
  })
  const setup: EpisodeSetupRecord = {
    command: params.command,
    exitCode: result.exitCode,
    networkCarveOut: true,
    timedOut: result.timedOut,
    wallMs: Date.now() - startedAt,
  }
  if (result.timedOut || result.exitCode !== 0) {
    const detail = result.timedOut
      ? `timed out after ${params.maxWallMs}ms`
      : `exited ${result.exitCode}`
    throw new SetupCommandError(
      `setup_command ${detail}: ${params.command}\n${result.stderr.slice(0, 500)}`.trimEnd(),
      setup,
    )
  }
  return setup
}

/** Fixed scaffold coordinates keep Loop sandboxes byte-reproducible. */
export const EVAL_SCAFFOLD_DATE = "2026-07-14"

/**
 * Automatic grill reply rounds for the Loop arm. Set to the workflow's own
 * default (`grillExecPlan` uses `maxRounds ?? 5`); the earlier value of 2
 * structurally forced any task needing more than two clarifications to end
 * `owner_blocked`. Evidence: `codex-dryrun-001` episode
 * `smoke-retry-flag-loop-r1` — both grill rounds returned a well-formed footer
 * with a concrete `AUTOMATION_REPLY` (never `none`), so the auto-reply loop was
 * making progress; it simply exhausted the 2-round budget and returned the
 * "exhausted its bounded automatic reply budget" question, which maps to
 * `owner_blocked`. Aligning with the workflow default gives a productive
 * auto-reply loop room to converge on `complete`. A grill that still cannot
 * finish within this budget is a genuine owner-question finding for the
 * preregistration policy, not a too-tight cap.
 */
const LOOP_MAX_GRILL_ROUNDS = 5
const LOOP_MAX_VALIDATION_ATTEMPTS = 2

export type HarnessDisposition =
  | "grade"
  | "timeout"
  | "budget_exhausted"
  | "owner_blocked"
  | "harness_failure"

/**
 * Which fixed Loop route produced a phase record. The Loop harness dispatches
 * on the task's declared `workflow_shape` (never model discretion): a
 * "skip"-shape task takes a single direct-style run, while an "exec-plan"-shape
 * task drives the write -> grill -> execute -> validate spine. Recording the
 * route on every phase lets analyses separate the two economies (H6 routing) even
 * though both are scored under the `loop` system. "program" is not a route: it
 * is rejected before any agent runs.
 */
export type LoopRoute = "skip" | "exec-plan"

/**
 * A {@link HarnessPhaseRecord} annotated with the Loop route that produced it.
 * `routeTaken` is the only typed channel that survives to the persisted episode
 * record: the runner rebuilds `EpisodeRecord.harness` field by field and copies
 * the `phases` array by reference, so an extra property on these objects rides
 * through to JSON while a top-level outcome field would be silently dropped. It
 * is optional because the direct baseline emits plain phase records.
 */
export type RoutedPhaseRecord = HarnessPhaseRecord & { routeTaken?: LoopRoute }

export type HarnessOutcome = {
  disposition: HarnessDisposition
  phases: RoutedPhaseRecord[]
  usage: AgentUsage | null
  notes: string[]
}

export type PreparedSandbox = {
  /** Fingerprint of the pristine workspace, before treatment or git. */
  fingerprint: string
  /** Repository-relative (to the sandbox) ExecPlan path for the Loop arm. */
  planPath: string | null
  /** Evidence of the setup_command run, or null when the task declares none. */
  setup: EpisodeSetupRecord | null
}

async function runGit(sandboxDir: string, args: string[]): Promise<number> {
  const result = await runProcess({
    args: [
      "-C",
      sandboxDir,
      "-c",
      "user.name=evals",
      "-c",
      "user.email=evals@example.com",
      "-c",
      "commit.gpgsign=false",
      "-c",
      "init.defaultBranch=main",
      ...args,
    ],
    command: "git",
    cwd: sandboxDir,
    timeoutMs: 30_000,
  })
  return result.exitCode
}

/** `git status --porcelain` output, or empty string when the tree is clean. */
export async function gitStatusPorcelain(sandboxDir: string): Promise<string> {
  const result = await runProcess({
    args: ["-C", sandboxDir, "status", "--porcelain"],
    command: "git",
    cwd: sandboxDir,
    timeoutMs: 30_000,
  })
  return result.stdout.trim()
}

async function gitInitAndCommit(sandboxDir: string): Promise<void> {
  if ((await runGit(sandboxDir, ["init", "--quiet"])) !== 0) {
    throw new Error("git init failed in the eval sandbox")
  }
  if ((await runGit(sandboxDir, ["add", "-A"])) !== 0) {
    throw new Error("git add failed in the eval sandbox")
  }
  if (
    (await runGit(sandboxDir, [
      "commit",
      "--quiet",
      "--no-gpg-sign",
      "-m",
      "eval baseline",
    ])) !== 0
  ) {
    throw new Error("git baseline commit failed in the eval sandbox")
  }
}

/**
 * Materialize the task workspace into an empty sandbox, record its pristine
 * fingerprint, merge the eval entries onto the workspace's `.gitignore`, run
 * the task's `setup_command` (when declared), apply the Loop treatment when
 * requested, then create the single baseline commit. The fingerprint is taken
 * before any treatment, setup, or git metadata so it is identical across
 * conditions and across resets, and so it captures only the task's own files —
 * setup outputs (installs are not byte-deterministic) never enter it. Setup
 * runs BEFORE the baseline commit so any non-ignored setup output is absorbed
 * into the baseline and the evaluated agent's diff stays clean.
 */
export async function prepareSandbox(params: {
  config: ProgrammersLoopConfig
  pkg: TaskPackage
  sandboxDir: string
  system: EvalSystem
}): Promise<PreparedSandbox> {
  await rm(params.sandboxDir, { force: true, recursive: true })
  await materializeWorkspace(params.pkg, params.sandboxDir)
  const fingerprint = await workspaceFingerprint(params.sandboxDir)

  const gitignorePath = path.join(params.sandboxDir, ".gitignore")
  let existingGitignore: string | null = null
  try {
    existingGitignore = await readFile(gitignorePath, "utf8")
  } catch {
    existingGitignore = null
  }
  await writeFile(gitignorePath, mergeEvalGitignore(existingGitignore), "utf8")

  let setup: EpisodeSetupRecord | null = null
  if (params.pkg.setupCommand !== null) {
    setup = await runSetupCommand({
      command: params.pkg.setupCommand,
      maxOutputBytes: params.config.agent.maxOutputBytes,
      maxWallMs: params.pkg.budgets.maxWallMs,
      sandboxDir: params.sandboxDir,
    })
  }

  let planPath: string | null = null
  if (params.system === "loop") {
    planPath = await materializeLoopTreatment({
      config: params.config,
      pkg: params.pkg,
      sandboxDir: params.sandboxDir,
    })
  }

  await gitInitAndCommit(params.sandboxDir)
  return { fingerprint, planPath, setup }
}

/**
 * Copy the minimum Loop files the exec-plan phases reference and scaffold a
 * standalone Assignment plus one ExecPlan inside the sandbox. Prompts are read
 * from THIS repository's `prompts/` by the workflow (via `import.meta.dirname`),
 * so only `docs/contracts/exec-plan.md` needs copying; the ExecPlan lint checks
 * the plan text, not that the contract file is present, but the execute prompt
 * asks the agent to read it, so it is provided. Returns the ExecPlan path
 * relative to the sandbox root.
 */
async function materializeLoopTreatment(params: {
  config: ProgrammersLoopConfig
  pkg: TaskPackage
  sandboxDir: string
}): Promise<string> {
  const packageRoot = path.resolve(import.meta.dirname, "..", "..")
  await mkdir(path.join(params.sandboxDir, "docs", "contracts"), {
    recursive: true,
  })
  await copyFile(
    path.join(packageRoot, "docs", "contracts", "exec-plan.md"),
    path.join(params.sandboxDir, "docs", "contracts", "exec-plan.md"),
  )

  const assignment = await createAssignmentScaffold({
    config: params.config,
    date: EVAL_SCAFFOLD_DATE,
    repoRoot: params.sandboxDir,
    slug: params.pkg.id,
    title: params.pkg.title,
  })
  const execPlan = await createExecPlanScaffold({
    config: params.config,
    date: EVAL_SCAFFOLD_DATE,
    ownerPath: assignment.path,
    repoRoot: params.sandboxDir,
    slug: params.pkg.id,
    testCommand: "node --test",
    title: params.pkg.title,
  })
  return execPlan.path
}

function mergeUsage(
  left: AgentUsage | null,
  right: AgentUsage | null,
): AgentUsage | null {
  if (!left) return right
  if (!right) return left
  return addAgentUsage(left, right)
}

/** The task request plus the identical no-human preamble, used by both arms. */
export function buildDirectPrompt(pkg: TaskPackage): string {
  return `${pkg.request.trim()}\n\n${NO_HUMAN_PREAMBLE}`
}

/**
 * Direct baseline: a single workspace-write agent run in the sandbox.
 *
 * Outcome mapping:
 * - `result.timedOut`                     -> "timeout"
 * - exit 0                                 -> "grade" (grader is the judge)
 * - exit != 0 with a work product          -> "grade" (the agent mutated the
 *                                             tree; let the grader decide rather
 *                                             than assume a harness fault)
 * - exit != 0 with no work product         -> "harness_failure"
 *
 * A work product is any non-empty `git status --porcelain`, which excludes the
 * ignored `.runtime/` transcripts the adapter itself writes into the sandbox.
 */
export async function runDirectHarness(params: {
  adapter: AgentAdapter
  config: ProgrammersLoopConfig
  pkg: TaskPackage
  sandboxDir: string
}): Promise<HarnessOutcome> {
  const result = await params.adapter.run({
    cwd: params.sandboxDir,
    ephemeral: true,
    maxOutputBytes: params.config.agent.maxOutputBytes,
    maxTurns: params.pkg.budgets.maxTurns,
    model: params.config.agent.model,
    prompt: buildDirectPrompt(params.pkg),
    reasoningEffort: params.config.agent.reasoningEffort ?? null,
    sandbox: "workspace-write",
    timeoutMs: params.pkg.budgets.maxWallMs,
  })
  const phases: HarnessPhaseRecord[] = [
    {
      phase: "direct",
      receiptPath: result.eventsPath,
      status: `exit ${result.exitCode}`,
    },
  ]
  if (result.timedOut) {
    return {
      disposition: "timeout",
      notes: ["direct agent run exceeded max_wall_ms"],
      phases,
      usage: result.usage,
    }
  }
  if (result.exitCode !== 0) {
    const workProduct = (await gitStatusPorcelain(params.sandboxDir)) !== ""
    if (!workProduct) {
      return {
        disposition: "harness_failure",
        notes: [
          `direct agent exited ${result.exitCode} with no work product`,
          result.stderr.slice(0, 500),
        ].filter((note) => note !== ""),
        phases,
        usage: result.usage,
      }
    }
  }
  return { disposition: "grade", notes: [], phases, usage: result.usage }
}

/**
 * Skip route: the task declared `workflow_shape: skip`, so durable planning is
 * bypassed and the Loop system performs a single direct-style agent run. This
 * delegates to {@link runDirectHarness} so the mechanics are identical by
 * construction — same workspace-write sandbox, same budgets, same no-human
 * preamble and outcome mapping — and only re-tags each phase with routeTaken
 * "skip". Loop-vs-direct on a skip-shape task is therefore the same execution by
 * design: H6 routing economics measure the routing decision, not a different way
 * of doing the work. The ExecPlan the runner scaffolds for every loop episode is
 * left untouched here; it is gitignored, so the grader never sees it.
 */
async function runLoopSkipRoute(params: {
  adapter: AgentAdapter
  config: ProgrammersLoopConfig
  pkg: TaskPackage
  planPath: string
  sandboxDir: string
}): Promise<HarnessOutcome> {
  const outcome = await runDirectHarness({
    adapter: params.adapter,
    config: params.config,
    pkg: params.pkg,
    sandboxDir: params.sandboxDir,
  })
  return {
    ...outcome,
    phases: outcome.phases.map((phase) => ({ ...phase, routeTaken: "skip" })),
  }
}

/**
 * Program route: multi-slice "program"-shape work is 0.2 scope. It is rejected
 * before any agent runs and mapped to the harness_failure terminal — never a
 * thrown error, which the runner would recategorize as an infrastructure failure
 * and exclude from scoring.
 */
function unsupportedProgramShape(pkg: TaskPackage): HarnessOutcome {
  return {
    disposition: "harness_failure",
    notes: [
      `workflow_shape "program" is not supported by the Loop harness in 0.1 (task ${pkg.id}); only "skip" and "exec-plan" route.`,
    ],
    phases: [],
    usage: null,
  }
}

/**
 * Programmers Loop treatment, routed by the task's declared `workflow_shape`
 * (fixed routing, GitHub issue #8):
 *
 * - "skip"      -> {@link runLoopSkipRoute}: a single direct-style run, so
 *                  trivial work bypasses durable planning.
 * - "exec-plan" -> the fixed spine below.
 * - "program"   -> {@link unsupportedProgramShape}: multi-slice work is 0.2
 *                  scope and is rejected as a harness failure.
 *
 * The exec-plan route drives the fixed spine write -> grill -> execute ->
 * validate against the sandbox as a foreign repository root. Each spine phase
 * counts as one phase against `budgets.max_phases`; when the next phase would
 * exceed the cap the run stops and records `budget_exhausted`. A grill that ends
 * in a question or blocked state maps to `owner_blocked` (the treatment must not
 * consult a human). Validation runs without deterministic proof commands: the
 * hidden task grader is the acceptance oracle.
 */
export async function runLoopHarness(params: {
  adapter: AgentAdapter
  config: ProgrammersLoopConfig
  pkg: TaskPackage
  planPath: string
  sandboxDir: string
}): Promise<HarnessOutcome> {
  if (params.pkg.workflowShape === "skip") return runLoopSkipRoute(params)
  if (params.pkg.workflowShape === "program") {
    return unsupportedProgramShape(params.pkg)
  }

  // workflow_shape "exec-plan": drive the fixed planning spine.
  const loopConfig: ProgrammersLoopConfig = {
    ...params.config,
    agent: {
      ...params.config.agent,
      runTimeoutMs: params.pkg.budgets.maxWallMs,
    },
  }
  const common = {
    adapter: params.adapter,
    config: loopConfig,
    planPath: params.planPath,
    repoRoot: params.sandboxDir,
  }
  const outline = `${params.pkg.request.trim()}\n\n${NO_HUMAN_PREAMBLE}`
  const maxPhases = params.pkg.budgets.maxPhases

  const phases: RoutedPhaseRecord[] = []
  let usage: AgentUsage | null = null
  const notes: string[] = []

  const absorb = (receipt: WorkflowReceipt): void => {
    phases.push({
      phase: receipt.phase,
      receiptPath: receipt.receiptPath,
      routeTaken: "exec-plan",
      status: receipt.status,
    })
    usage = mergeUsage(usage, sumUsage(receipt.attempts))
  }
  const budgetExhausted = (): HarnessOutcome => ({
    disposition: "budget_exhausted",
    notes: [
      ...notes,
      `stopped before phase ${phases.length + 1}; budget max_phases=${maxPhases}`,
    ],
    phases,
    usage,
  })
  const harnessFailure = (phase: string, error: unknown): HarnessOutcome => {
    // A workflow phase that throws has already persisted its durable receipt
    // and carries it on the error; absorb it so failed phases still contribute
    // their receipt path and usage to the episode record and to the loop
    // token rollup (smoke-001 defect E3).
    if (error instanceof WorkflowPhaseError) absorb(error.receipt)
    return {
      disposition: "harness_failure",
      notes: [
        ...notes,
        `${phase} phase threw: ${error instanceof Error ? error.message : String(error)}`,
      ],
      phases,
      usage,
    }
  }
  const failedReceipt = (phase: string): HarnessOutcome => ({
    disposition: "harness_failure",
    notes: [...notes, `${phase} phase did not complete`],
    phases,
    usage,
  })

  // write
  if (phases.length >= maxPhases) return budgetExhausted()
  let receipt: WorkflowReceipt
  try {
    receipt = await writeExecPlan({ ...common, outline })
  } catch (error) {
    return harnessFailure("write", error)
  }
  absorb(receipt)
  if (receipt.status !== "completed") return failedReceipt("write")

  // grill
  if (phases.length >= maxPhases) return budgetExhausted()
  let grill: WorkflowReceipt
  try {
    grill = await grillExecPlan({ ...common, maxRounds: LOOP_MAX_GRILL_ROUNDS })
  } catch (error) {
    return harnessFailure("grill", error)
  }
  absorb(grill)
  if (grill.status === "question" || grill.status === "blocked") {
    return {
      disposition: "owner_blocked",
      notes: [...notes, "grill halted for owner input"],
      phases,
      usage,
    }
  }
  if (grill.status !== "completed") return failedReceipt("grill")

  // execute
  if (phases.length >= maxPhases) return budgetExhausted()
  try {
    receipt = await executeExecPlan(common)
  } catch (error) {
    return harnessFailure("execute", error)
  }
  absorb(receipt)
  if (receipt.status !== "completed") return failedReceipt("execute")

  // validate (deterministic proof off; the task grader is the acceptance oracle)
  if (phases.length >= maxPhases) return budgetExhausted()
  try {
    receipt = await validateExecPlan({
      ...common,
      executeProofCommands: false,
      maxAttempts: LOOP_MAX_VALIDATION_ATTEMPTS,
    })
  } catch (error) {
    return harnessFailure("validate", error)
  }
  absorb(receipt)
  if (receipt.status !== "completed") return failedReceipt("validate")

  return { disposition: "grade", notes, phases, usage }
}
