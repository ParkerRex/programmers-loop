import {
  chmod,
  copyFile,
  mkdir,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises"
import path from "node:path"

import type {
  AgentAdapter,
  AgentRunRequest,
  AgentToolPolicy,
  AgentUsage,
} from "../agents/types.js"
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
  EpisodeTreatmentRecord,
  EvalSystem,
  HarnessPhaseRecord,
} from "./manifest.js"
import { materializeWorkspace, workspaceFingerprint } from "./task-package.js"
import type { TaskPackage, TaskScope } from "./task-package.js"

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
 * planning artifacts, and `/programmers-loop.config.yaml` is the sandbox-local
 * config the Loop CLI shim needs to resolve the sandbox as its repo root (it
 * would otherwise walk up and escape the sandbox). Ignoring them keeps the
 * baseline commit and every later `git status` limited to the agent's genuine,
 * in-scope edits. Exact paths are ignored rather than a blanket `docs/` so a
 * task shipping its own docs cannot be silently hidden.
 */
export const EVAL_GITIGNORE = [
  ".runtime/",
  "/docs/assignments/",
  "/docs/contracts/",
  "/programmers-loop.config.yaml",
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
  /** Loop treatment materialization recorded on the episode (issue #8). */
  treatment: EpisodeTreatmentRecord
  /** Sandbox-relative AGENTS.md paths in the materialized workspace, or [] (issue #7). */
  agentsMdPaths: string[]
  /**
   * Absolute path to the Loop CLI shim's bin directory to prepend to the
   * agent's PATH, or null for the direct arm (which gets no shim). Used only by
   * live runs; the mock adapter never spawns a child.
   */
  shimBinDir: string | null
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
  // Scanned on the pristine workspace, before any treatment or git metadata, so
  // only the task's own AGENTS.md are captured (both arms see the same set).
  const agentsMdPaths = await findAgentsMd(params.sandboxDir)

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
  let shimBinDir: string | null = null
  let treatment: EpisodeTreatmentRecord = {
    injectedPaths: [],
    loopCliShimPath: null,
    loopCliShimPresent: false,
    loopCliTargetVersion: null,
  }
  if (params.system === "loop") {
    const materialized = await materializeLoopTreatment({
      config: params.config,
      pkg: params.pkg,
      sandboxDir: params.sandboxDir,
    })
    planPath = materialized.planPath
    shimBinDir = materialized.shimBinDir
    treatment = materialized.treatment
  }

  await gitInitAndCommit(params.sandboxDir)
  return { agentsMdPaths, fingerprint, planPath, setup, shimBinDir, treatment }
}

/** Sandbox-relative bin directory (gitignored) holding the Loop CLI shim. */
export const LOOP_CLI_SHIM_BIN_DIR = path.posix.join(".runtime", "loop-bin")
/** Shim executable name; matches the `programmers-loop` command the prompts invoke. */
export const LOOP_CLI_SHIM_NAME = "programmers-loop"

/** Read THIS repository's declared CLI version, or "unknown". */
async function readCliVersion(packageRoot: string): Promise<string> {
  try {
    const raw = await readFile(path.join(packageRoot, "package.json"), "utf8")
    const parsed = JSON.parse(raw) as { version?: unknown }
    return typeof parsed.version === "string" ? parsed.version : "unknown"
  } catch {
    return "unknown"
  }
}

/**
 * Write an executable `programmers-loop` shim into the sandbox that runs THIS
 * repository's CLI against the *sandbox* as cwd. The Loop write/grill prompts
 * instruct the agent to run the focused linter (`programmers-loop ...`), but
 * sandboxes ship no such binary — live grill runs observed `exit 127` and
 * blocked (issue #8, grill-triage-002). The shim closes that gap: it `exec`s
 * `bun <repo>/src/cli.ts "$@"` by absolute path so the treatment works without
 * a build, and stays in the caller's cwd so `exec-plan lint --path <plan>`
 * resolves against the sandbox — the sibling `programmers-loop.config.yaml`
 * makes the CLI's `findRepoRoot` stop at the sandbox instead of walking up and
 * escaping it. It is network-inert: `bun --no-install` never reaches a
 * registry, and the CLI it runs performs only local file operations.
 */
async function writeLoopCliShim(sandboxDir: string): Promise<{
  binDirAbs: string
  shimPath: string
  targetVersion: string
}> {
  const packageRoot = path.resolve(import.meta.dirname, "..", "..")
  const cliEntry = path.join(packageRoot, "src", "cli.ts")
  const binDirAbs = path.join(sandboxDir, LOOP_CLI_SHIM_BIN_DIR)
  await mkdir(binDirAbs, { recursive: true })
  const shimAbs = path.join(binDirAbs, LOOP_CLI_SHIM_NAME)
  const script = `#!/bin/sh
# Programmers Loop CLI shim (eval treatment surface, issue #8). Runs this
# repository's CLI against the current working directory (the sandbox).
# Network-inert: --no-install never reaches a registry.
exec bun --no-install ${JSON.stringify(cliEntry)} "$@"
`
  await writeFile(shimAbs, script, "utf8")
  await chmod(shimAbs, 0o755)
  return {
    binDirAbs,
    shimPath: path.posix.join(LOOP_CLI_SHIM_BIN_DIR, LOOP_CLI_SHIM_NAME),
    targetVersion: await readCliVersion(packageRoot),
  }
}

/**
 * Materialize the Loop treatment surface into the sandbox and record exactly
 * what was injected (issue #8: specified AND recorded). This copies the
 * minimum Loop files the exec-plan phases reference — `docs/contracts/exec-plan.md`
 * (the execute prompt asks the agent to read it) — plus a sandbox-local
 * `programmers-loop.config.yaml` (so the CLI shim resolves the sandbox as its
 * repo root) and the `programmers-loop` PATH shim; it then scaffolds a
 * standalone Assignment and one ExecPlan. Prompts themselves are read from THIS
 * repository's `prompts/` by the workflow (via `import.meta.dirname`), so they
 * are not copied. Returns the ExecPlan path, the shim bin directory to prepend
 * to PATH, and the treatment record.
 */
async function materializeLoopTreatment(params: {
  config: ProgrammersLoopConfig
  pkg: TaskPackage
  sandboxDir: string
}): Promise<{
  planPath: string
  shimBinDir: string
  treatment: EpisodeTreatmentRecord
}> {
  const packageRoot = path.resolve(import.meta.dirname, "..", "..")
  await mkdir(path.join(params.sandboxDir, "docs", "contracts"), {
    recursive: true,
  })
  await copyFile(
    path.join(packageRoot, "docs", "contracts", "exec-plan.md"),
    path.join(params.sandboxDir, "docs", "contracts", "exec-plan.md"),
  )
  // A sandbox-local config makes findRepoRoot stop at the sandbox; gitignored
  // via EVAL_GITIGNORE so it never enters the baseline commit or grader view.
  await copyFile(
    path.join(packageRoot, "programmers-loop.config.yaml"),
    path.join(params.sandboxDir, "programmers-loop.config.yaml"),
  )
  const shim = await writeLoopCliShim(params.sandboxDir)

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
  const injectedPaths = [
    "docs/contracts/exec-plan.md",
    "programmers-loop.config.yaml",
    shim.shimPath,
    assignment.path,
    execPlan.path,
  ].toSorted()
  return {
    planPath: execPlan.path,
    shimBinDir: shim.binDirAbs,
    treatment: {
      injectedPaths,
      loopCliShimPath: shim.shimPath,
      loopCliShimPresent: true,
      loopCliTargetVersion: shim.targetVersion,
    },
  }
}

/**
 * Sandbox-relative paths of every `AGENTS.md` (case-insensitive) in a
 * materialized workspace, sorted. Documents the ambient agent instructions the
 * baseline/treatment workspace carried (issue #7). `.git`/`.runtime` are not
 * present when this runs (before git init and treatment) but are skipped
 * defensively.
 */
async function findAgentsMd(root: string): Promise<string[]> {
  const found: string[] = []
  async function visit(dir: string, prefix: string): Promise<void> {
    let dirents
    try {
      dirents = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const dirent of dirents) {
      if (dirent.name === ".git" || dirent.name === ".runtime") continue
      const rel = prefix === "" ? dirent.name : `${prefix}/${dirent.name}`
      if (dirent.isDirectory()) {
        await visit(path.join(dir, dirent.name), rel)
      } else if (dirent.isFile() && dirent.name.toLowerCase() === "agents.md") {
        found.push(rel)
      }
    }
  }
  await visit(root, "")
  return found.toSorted()
}

function mergeUsage(
  left: AgentUsage | null,
  right: AgentUsage | null,
): AgentUsage | null {
  if (!left) return right
  if (!right) return left
  return addAgentUsage(left, right)
}

/**
 * Wrap the subject adapter so every agent call the Loop spine makes is bounded
 * by the same budgets the direct arm enforces (issue #7, defect E2):
 *
 * - `max_turns` is injected as a per-agent-call cap when the workflow's
 *   `runAgent` did not set one (it never does), matching the direct arm's
 *   single-call `--max-turns`.
 * - `max_wall_ms` is a per-EPISODE total: every call's timeout is clamped to the
 *   budget remaining at call time (`deadlineAt - now()`), so a multi-round phase
 *   cannot restart the full wall budget on each round. The harness additionally
 *   refuses to start a phase once the remainder is spent.
 * - `toolPolicy` is injected the same way `maxTurns` is: the workflow's `runAgent`
 *   never sets one, so the task's named-tool policy (paper's tool-filtering hook)
 *   reaches every spine phase without touching `src/workflows/**`. A request that
 *   already carries a policy is left as-is.
 *
 * The wrapper is inert for CLIs that ignore `maxTurns`/`toolPolicy` (Codex) and
 * for the mock adapter (which does not spawn); it only shapes the request.
 */
function budgetedLoopAdapter(
  inner: AgentAdapter,
  opts: {
    deadlineAt: number
    maxTurns: number
    now: () => number
    toolPolicy?: AgentToolPolicy
  },
): AgentAdapter {
  return {
    id: inner.id,
    doctor: (cwd: string) => inner.doctor(cwd),
    run: (request: AgentRunRequest) => {
      const remaining = Math.max(0, opts.deadlineAt - opts.now())
      return inner.run({
        ...request,
        maxTurns: request.maxTurns ?? opts.maxTurns,
        timeoutMs:
          request.timeoutMs === undefined
            ? remaining
            : Math.min(request.timeoutMs, remaining),
        toolPolicy: request.toolPolicy ?? opts.toolPolicy,
      })
    },
  }
}

/**
 * Render the task package's scope contract as agent-visible rules (smoke-001
 * defect E4 fix). The graded acceptance stays hidden, but the RULES the agent is
 * graded against — `allowed_paths` and `forbidden_paths` — are public manifest
 * data, and an agent that cannot see them can only guess (E4: retry-flag-direct
 * shipped a working flag and lost the episode for also documenting it in a
 * forbidden README.md, a boundary it had no way to know). Both arms receive this
 * identical text so surfacing scope never advantages one arm. `forbidden_paths`
 * is validated with `allowEmpty: true`, so the closed-world rule is always
 * rendered and the block still constrains even with no explicit forbidden list.
 */
export function renderScopeRules(scope: TaskScope): string {
  const lines = [
    "## Edit scope (graded)",
    "",
    "You are graded on staying inside this edit boundary. Creating, modifying, or deleting anything outside it fails the episode even when the rest of the work is correct. In these globs `*` matches within a single path segment and `**` matches across segments.",
    "",
    "Files you may create, modify, or delete:",
    scope.allowedPaths.map((pattern) => `- ${pattern}`).join("\n"),
  ]
  if (scope.forbiddenPaths.length > 0) {
    lines.push(
      "",
      "Files you must not create, modify, or delete:",
      scope.forbiddenPaths.map((pattern) => `- ${pattern}`).join("\n"),
    )
  }
  lines.push(
    "",
    "Anything not listed as allowed above is out of scope: leave it untouched.",
  )
  return lines.join("\n")
}

/**
 * The shared task prompt: the request, the visible scope rules (E4), and the
 * identical no-human preamble. This ONE function is the single source of the
 * prompt text for every arm — the direct baseline, the Loop skip route (which
 * runs through {@link runDirectHarness}), and the Loop exec-plan spine's outline
 * injection — so the scope rules are byte-identical wherever the task request
 * enters an agent. Fairness depends on that shared identity, not on parallel
 * copies staying in sync.
 */
export function buildTaskPrompt(pkg: TaskPackage): string {
  return `${pkg.request.trim()}\n\n${renderScopeRules(pkg.scope)}\n\n${NO_HUMAN_PREAMBLE}`
}

/**
 * Record on the episode (via harness notes) when a named-tool policy is declared
 * but the running adapter cannot enforce it. The Claude arm maps the policy onto
 * `--allowedTools`/`--disallowedTools`; the Codex CLI has no named-tool surface,
 * so a codex run's `tool_policy.tools` is declared-not-enforced (its `network:
 * deny` is still enforced structurally by the `--sandbox` mode). Empty policies
 * and enforcing adapters produce no note — never overclaim, never over-warn.
 */
function declaredNotEnforcedNotes(
  adapterId: string,
  policy: AgentToolPolicy | undefined,
): string[] {
  if (adapterId !== "codex" || !policy) return []
  const named = [...(policy.allowed ?? []), ...(policy.disallowed ?? [])]
  if (named.length === 0) return []
  return [
    `tool_policy.tools declared but NOT enforced: the codex CLI exposes no named-tool allow/deny surface (network deny is enforced by --sandbox). Declared allow=[${(policy.allowed ?? []).join(", ")}] disallow=[${(policy.disallowed ?? []).join(", ")}].`,
  ]
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
  // Thread the task's named-tool policy (paper's tool-filtering hook) to the
  // adapter. Enforced by the Claude arm; declaredNotEnforcedNotes records when
  // the codex arm cannot honor it.
  const toolPolicy = params.pkg.toolPolicy.tools
  const policyNotes = declaredNotEnforcedNotes(params.adapter.id, toolPolicy)
  const result = await params.adapter.run({
    cwd: params.sandboxDir,
    ephemeral: true,
    maxOutputBytes: params.config.agent.maxOutputBytes,
    maxTurns: params.pkg.budgets.maxTurns,
    model: params.config.agent.model,
    prompt: buildTaskPrompt(params.pkg),
    reasoningEffort: params.config.agent.reasoningEffort ?? null,
    sandbox: "workspace-write",
    timeoutMs: params.pkg.budgets.maxWallMs,
    toolPolicy,
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
      notes: [...policyNotes, "direct agent run exceeded max_wall_ms"],
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
          ...policyNotes,
          `direct agent exited ${result.exitCode} with no work product`,
          result.stderr.slice(0, 500),
        ].filter((note) => note !== ""),
        phases,
        usage: result.usage,
      }
    }
  }
  return {
    disposition: "grade",
    notes: policyNotes,
    phases,
    usage: result.usage,
  }
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
  /** Injectable clock for the per-episode wall budget; defaults to Date.now. */
  now?: () => number
}): Promise<HarnessOutcome> {
  if (params.pkg.workflowShape === "skip") return runLoopSkipRoute(params)
  if (params.pkg.workflowShape === "program") {
    return unsupportedProgramShape(params.pkg)
  }

  // workflow_shape "exec-plan": drive the fixed planning spine.
  // max_wall_ms is a per-EPISODE total (symmetric with the direct arm): track a
  // single deadline and thread the running remainder into every phase call via
  // the budgeted adapter. max_turns is a per-agent-call cap the adapter injects
  // into each phase call (runAgent omits it). Phases are additionally bounded by
  // max_phases.
  const now = params.now ?? Date.now
  const maxWallMs = params.pkg.budgets.maxWallMs
  const deadlineAt = now() + maxWallMs
  const remainingWallMs = (): number => deadlineAt - now()
  // The task's named-tool policy rides into every spine phase via the budgeted
  // adapter (runAgent never sets one), matching the direct arm's passthrough.
  const toolPolicy = params.pkg.toolPolicy.tools
  const cappedAdapter = budgetedLoopAdapter(params.adapter, {
    deadlineAt,
    maxTurns: params.pkg.budgets.maxTurns,
    now,
    toolPolicy,
  })
  const loopConfig: ProgrammersLoopConfig = {
    ...params.config,
    agent: {
      ...params.config.agent,
      runTimeoutMs: maxWallMs,
    },
  }
  const common = {
    adapter: cappedAdapter,
    config: loopConfig,
    planPath: params.planPath,
    repoRoot: params.sandboxDir,
  }
  // buildTaskPrompt is the SAME function the direct arm uses, so the request +
  // visible scope rules (E4) + no-human preamble are byte-identical across arms
  // at the point the task enters the spine (the write phase's feature_outline).
  const outline = buildTaskPrompt(params.pkg)
  const maxPhases = params.pkg.budgets.maxPhases

  const phases: RoutedPhaseRecord[] = []
  let usage: AgentUsage | null = null
  const notes: string[] = declaredNotEnforcedNotes(
    params.adapter.id,
    toolPolicy,
  )

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
  const timedOut = (): HarnessOutcome => ({
    disposition: "timeout",
    notes: [
      ...notes,
      `episode exceeded max_wall_ms=${maxWallMs} across ${phases.length} phase(s)`,
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
    // A phase that threw because its agent ran out of the episode wall budget is
    // a timeout, not a harness fault: classify it as the shared terminal.
    if (remainingWallMs() <= 0) return timedOut()
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
  if (remainingWallMs() <= 0) return timedOut()
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
  if (remainingWallMs() <= 0) return timedOut()
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
  if (remainingWallMs() <= 0) return timedOut()
  try {
    receipt = await executeExecPlan(common)
  } catch (error) {
    return harnessFailure("execute", error)
  }
  absorb(receipt)
  if (receipt.status !== "completed") return failedReceipt("execute")

  // validate (deterministic proof off; the task grader is the acceptance oracle)
  if (phases.length >= maxPhases) return budgetExhausted()
  if (remainingWallMs() <= 0) return timedOut()
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
