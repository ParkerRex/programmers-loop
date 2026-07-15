import { access, mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"

import { createAgentAdapter } from "../agents/index.js"
import { addAgentUsage } from "../agents/types.js"
import type {
  AgentAdapter,
  AgentRunResult,
  AgentUsage,
} from "../agents/types.js"
import type { ProgrammersLoopConfig } from "../config.js"
import { lintExecPlan, lintExecPlanReadiness } from "../contracts/exec-plan.js"
import {
  executeProof,
  previewProof,
  type ProofPreview,
  type ProofReceipt,
} from "../proof.js"
import {
  assertWritePathInRepo,
  resolveExistingRepoPath,
  resolveRepoPath,
  toRepoPath,
  UserInputError,
} from "../repo-path.js"
import { extractSubsection } from "../contracts/shared.js"
import {
  extractSection,
  parseMarkdownFrontmatter,
} from "../markdown/frontmatter.js"
import {
  createRunId,
  readRuntimeJson,
  writeRuntimeJson,
} from "../runtime/store.js"
import { curatedSkillsBlock } from "./curated-skills.js"
import { loadRuntimePrompt, renderPrompt } from "./prompts.js"

/**
 * The ExecPlan spine is always the "exec-plan" workflow shape; curated skills
 * that target this shape are selected for every phase prompt assembled here.
 */
const EXEC_PLAN_SHAPE = "exec-plan" as const

/**
 * The plan's declared scope, rendered for the `<declared_scope>` execute-prompt
 * block so the In/Out-of-Scope boundary is salient AT EXECUTION TIME rather than
 * buried in the plan body. Targets the live smoke finding that scope was
 * invisible to the agent (an out-of-scope README edit sank a working feature).
 * Mirrors validateScope's extraction; returns undefined when the plan declares
 * no Context and Orientation scope, so the block is simply omitted.
 */
async function declaredScopeBlock(
  planAbsolutePath: string,
): Promise<string | undefined> {
  const { body } = parseMarkdownFrontmatter(
    await readFile(planAbsolutePath, "utf8"),
  )
  const context = extractSection(body, "Context and Orientation")
  if (context === null) return undefined
  const inScope = extractSubsection(context, "In Scope")
  const outOfScope = extractSubsection(context, "Out Of Scope")
  if (!inScope && !outOfScope) return undefined
  return [
    "This ExecPlan declares the scope below. Implement ONLY what is In Scope. Anything Out Of Scope is forbidden this slice — if it feels helpful, record it in the Decision Log instead of editing it.",
    `### In Scope\n${inScope ?? "(none declared)"}`,
    `### Out Of Scope\n${outOfScope ?? "(none declared)"}`,
  ].join("\n\n")
}

export type AgentAttempt = {
  eventsPath: string | null
  exitCode: number
  lastMessage: string
  round: number
  sessionId: string | null
  stderr: string
  stderrTruncated: boolean
  timedOut: boolean
  usage: AgentUsage | null
}

export type WorkflowReceipt = {
  schemaVersion: 1
  runId: string
  phase: "outline" | "write" | "grill" | "execute" | "validate" | "workflow"
  planPath: string
  startedAt: string
  completedAt: string
  status: "completed" | "failed" | "question" | "blocked"
  attempts: AgentAttempt[]
  proofReceipts: string[]
  message: string
  receiptPath: string
}

type WorkflowContext = {
  adapter: AgentAdapter
  config: ProgrammersLoopConfig
  planPath: string
  repoRoot: string
}

/**
 * A workflow phase that failed after persisting its durable receipt. The
 * receipt travels on the error so callers that observe the throw (for example
 * the eval harness) can still absorb the phase's receipt path and usage; the
 * message is exactly the receipt's failure message.
 */
export class WorkflowPhaseError extends Error {
  readonly receipt: WorkflowReceipt

  constructor(receipt: WorkflowReceipt, options?: { cause?: unknown }) {
    super(receipt.message, options)
    this.name = "WorkflowPhaseError"
    this.receipt = receipt
  }
}

function bounded(value: string, maxBytes: number): string {
  const buffer = Buffer.from(value)
  if (buffer.length <= maxBytes) return value
  return `${buffer.subarray(0, maxBytes).toString("utf8")}\n[truncated]`
}

function attemptFromResult(
  round: number,
  result: AgentRunResult,
  maxBytes: number,
): AgentAttempt {
  return {
    eventsPath: result.eventsPath,
    exitCode: result.exitCode,
    lastMessage: bounded(result.lastMessage, maxBytes),
    round,
    sessionId: result.sessionId ?? null,
    stderr: bounded(result.stderr, maxBytes),
    stderrTruncated: result.stderrTruncated,
    timedOut: result.timedOut,
    usage: result.usage,
  }
}

/**
 * Rolls up the usage recorded across a receipt's attempts. Returns null when
 * no attempt captured usage; otherwise sums field-wise, keeping fields null
 * that no attempt ever reported.
 */
export function sumUsage(
  attempts: ReadonlyArray<Pick<AgentAttempt, "usage">>,
): AgentUsage | null {
  let total: AgentUsage | null = null
  for (const attempt of attempts) {
    if (!attempt.usage) continue
    total = total ? addAgentUsage(total, attempt.usage) : { ...attempt.usage }
  }
  return total
}

async function resolveContext(params: {
  adapter?: AgentAdapter
  config: ProgrammersLoopConfig
  planPath: string
  requireReady?: boolean
  repoRoot: string
}): Promise<WorkflowContext> {
  const planPath = await resolveExistingRepoPath(
    params.repoRoot,
    params.planPath,
  )
  const issues =
    params.requireReady === false
      ? await lintExecPlan({ planPath, repoRoot: params.repoRoot })
      : await lintExecPlanReadiness({
          planPath,
          repoRoot: params.repoRoot,
        })
  if (issues.length > 0) {
    throw new UserInputError(
      `ExecPlan is invalid: ${issues[0]?.path}: ${issues[0]?.message}`,
    )
  }
  return {
    adapter: params.adapter ?? createAgentAdapter(params.config),
    config: params.config,
    planPath,
    repoRoot: params.repoRoot,
  }
}

async function runAgent(
  context: WorkflowContext,
  prompt: string,
  options?: { ephemeral?: boolean; sessionId?: string },
): Promise<AgentRunResult> {
  return context.adapter.run({
    cwd: context.repoRoot,
    ephemeral: options?.ephemeral ?? true,
    maxOutputBytes: context.config.agent.maxOutputBytes,
    model: context.config.agent.model,
    profile: context.config.agent.profile,
    prompt,
    reasoningEffort: context.config.agent.reasoningEffort ?? null,
    sandbox: "workspace-write",
    sessionId: options?.sessionId,
    timeoutMs: context.config.agent.runTimeoutMs,
  })
}

async function assertAgentSucceeded(result: AgentRunResult): Promise<void> {
  if (result.timedOut) throw new Error("Agent run timed out.")
  if (result.exitCode !== 0) {
    throw new Error(
      `Agent run failed with exit code ${result.exitCode}: ${result.stderr}`,
    )
  }
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback
}

/**
 * Lane moves never change a plan's identity, and they are legitimate in BOTH
 * directions: completing an ExecPlan relocates it from `exec-plans/active/` to
 * the sibling `exec-plans/completed/` lane (docs/contracts/exec-plan.md; the
 * execute prompt's final paragraph), and a validation pass that finds the work
 * incomplete may reopen a completed plan back into `active/` (observed live in
 * eval run grill-triage-001: the validate agent reported "Validation is
 * incomplete; I reopened the ExecPlan in its active lane", and the previous
 * one-way active->completed mapping then ENOENT'd on the stale completed
 * path). Track the plan by identity across either move: when the known path no
 * longer exists, prefer the matching sibling-lane path. Mirrors
 * locateProgramAfterTransition in program.ts.
 */
async function locatePlanAfterTransition(planPath: string): Promise<string> {
  if (await exists(planPath)) return planPath
  const active = `${path.sep}exec-plans${path.sep}active${path.sep}`
  const completed = `${path.sep}exec-plans${path.sep}completed${path.sep}`
  const candidate = planPath.includes(active)
    ? planPath.replace(active, completed)
    : planPath.replace(completed, active)
  if (candidate !== planPath && (await exists(candidate))) return candidate
  return planPath
}

async function assertPlanStillValid(context: WorkflowContext): Promise<void> {
  const issues = await lintExecPlan({
    planPath: context.planPath,
    repoRoot: context.repoRoot,
  })
  if (issues.length > 0) {
    throw new Error(
      `Agent left an invalid ExecPlan: ${issues[0]?.path}: ${issues[0]?.message}`,
    )
  }
}

async function assertPlanReady(context: WorkflowContext): Promise<void> {
  const issues = await lintExecPlanReadiness({
    planPath: context.planPath,
    repoRoot: context.repoRoot,
  })
  if (issues.length > 0) {
    throw new Error(
      `Agent left an execution-unready ExecPlan: ${issues[0]?.path}: ${issues[0]?.message}`,
    )
  }
}

function receiptRelativePath(runId: string): string {
  return path.join(".runtime", "workflows", "exec-plans", `${runId}.json`)
}

async function persistReceipt(
  repoRoot: string,
  receipt: Omit<WorkflowReceipt, "receiptPath">,
): Promise<WorkflowReceipt> {
  const relativePath = receiptRelativePath(receipt.runId)
  const complete: WorkflowReceipt = {
    ...receipt,
    receiptPath: relativePath.split(path.sep).join("/"),
  }
  await writeRuntimeJson({ relativePath, repoRoot, value: complete })
  return complete
}

/**
 * Mirrors the private run-id validation in program.ts: receipt ids become
 * runtime file names, so they must stay one conservative path token.
 */
function assertRunId(runId: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(runId)) {
    throw new UserInputError(
      "run-id must contain only letters, numbers, periods, underscores, and hyphens.",
    )
  }
}

/**
 * A caller-supplied run id pins each phase receipt to one deterministic path
 * (`<runId>.<phase>.json`); that determinism is what lets a fresh process
 * find the receipts a killed process left behind. Anonymous runs keep the
 * historical unique per-invocation ids.
 */
function phaseReceiptId(
  runId: string | undefined,
  phase: WorkflowReceipt["phase"],
): string {
  if (runId === undefined) return createRunId(phase)
  assertRunId(runId)
  return `${runId}.${phase}`
}

/**
 * The designed completion move relocates a plan from the active lane to the
 * sibling completed lane without changing its identity; compare plan paths
 * modulo that move.
 */
function planIdentityPath(planRepoPath: string): string {
  return planRepoPath.replace(
    /(^|\/)exec-plans\/completed\//,
    "$1exec-plans/active/",
  )
}

/**
 * Cross-process phase resumption: load the durable receipt a previous process
 * persisted under this deterministic receipt id. Callers return a completed
 * receipt idempotently before resolving or linting anything, so replays keep
 * succeeding even after the plan legitimately moved lanes or the worktree
 * changed; a non-completed receipt instead seeds the resumed phase's attempt
 * history so evidence from earlier attempts is appended to, never erased.
 * Progress inside an interrupted phase needs no receipt at all — it lives in
 * the durable plan (Progress checkboxes, Decision Log), which the resumed
 * phase's fresh agent session re-reads. Reusing a run id against a different
 * plan or phase is a caller error, exactly as in Program child-plan runs.
 */
async function readResumableReceipt(params: {
  phase: WorkflowReceipt["phase"]
  planPath: string
  receiptId: string
  repoRoot: string
}): Promise<WorkflowReceipt | null> {
  const prior = await readRuntimeJson<WorkflowReceipt>({
    relativePath: receiptRelativePath(params.receiptId),
    repoRoot: params.repoRoot,
  })
  if (!prior) return null
  const requestedPlanPath = toRepoPath(
    params.repoRoot,
    resolveRepoPath(params.repoRoot, params.planPath),
  )
  if (
    prior.phase !== params.phase ||
    planIdentityPath(prior.planPath) !== planIdentityPath(requestedPlanPath)
  ) {
    throw new UserInputError(
      "run-id already belongs to a different ExecPlan phase run.",
    )
  }
  return prior
}

const OUTLINE_HEADINGS = [
  "# Feature Outline",
  "## Goal",
  "## User-visible outcome",
  "## In Scope",
  "## Out Of Scope",
  "## Constraints",
  "## Relevant repository surfaces",
  "## Test Commands",
  "## Open Questions",
  "## Evidence Notes",
] as const

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath)
    return true
  } catch {
    return false
  }
}

function validateOutline(source: string): string | null {
  if (!source.trimStart().startsWith("# Feature Outline")) {
    return "Outline must contain only Markdown beginning with # Feature Outline."
  }
  const headings = source
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^#{1,2}\s+/.test(line))
  if (
    headings.length !== OUTLINE_HEADINGS.length ||
    headings.some((heading, index) => heading !== OUTLINE_HEADINGS[index])
  ) {
    return `Outline must use exactly these ordered headings: ${OUTLINE_HEADINGS.join(", ")}.`
  }
  for (const heading of OUTLINE_HEADINGS.slice(1)) {
    const content = extractSection(source, heading.slice(3))
    if (!content || content.trim() === "") {
      return `Outline section must not be empty: ${heading}.`
    }
  }
  return null
}

export async function distillExecPlanOutline(params: {
  adapter?: AgentAdapter
  config: ProgrammersLoopConfig
  inputPath?: string
  outputPath: string
  repoRoot: string
  sourceMaterial?: string
}): Promise<WorkflowReceipt> {
  if (
    (params.inputPath === undefined) ===
    (params.sourceMaterial === undefined)
  ) {
    throw new UserInputError(
      "Outline distillation requires exactly one inputPath or sourceMaterial.",
    )
  }
  const sourceMaterial =
    params.sourceMaterial ??
    (await readFile(
      await resolveExistingRepoPath(params.repoRoot, params.inputPath ?? ""),
      "utf8",
    ))
  const outputPath = resolveRepoPath(params.repoRoot, params.outputPath)
  await assertWritePathInRepo(params.repoRoot, outputPath)
  if (await exists(outputPath)) {
    throw new UserInputError(
      `Refusing to overwrite existing outline: ${toRepoPath(params.repoRoot, outputPath)}`,
    )
  }
  const startedAt = new Date().toISOString()
  const runId = createRunId("outline")
  const adapter = params.adapter ?? createAgentAdapter(params.config)
  const promptBase = await loadRuntimePrompt(
    params.repoRoot,
    "exec-plan.outline",
  )
  const result = await adapter.run({
    cwd: params.repoRoot,
    ephemeral: true,
    maxOutputBytes: params.config.agent.maxOutputBytes,
    model: params.config.agent.model,
    profile: params.config.agent.profile,
    prompt: renderPrompt(promptBase, {
      source_material: sourceMaterial,
    }),
    reasoningEffort: params.config.agent.reasoningEffort ?? null,
    sandbox: "read-only",
    timeoutMs: params.config.agent.runTimeoutMs,
  })
  const attempts = [
    attemptFromResult(1, result, params.config.agent.maxOutputBytes),
  ]
  try {
    await assertAgentSucceeded(result)
    const outlineIssue = validateOutline(result.lastMessage)
    if (outlineIssue) throw new Error(outlineIssue)
    await mkdir(path.dirname(outputPath), { recursive: true })
    await writeFile(outputPath, `${result.lastMessage.trim()}\n`, {
      encoding: "utf8",
      flag: "wx",
    })
    return persistReceipt(params.repoRoot, {
      schemaVersion: 1,
      runId,
      phase: "outline",
      planPath: toRepoPath(params.repoRoot, outputPath),
      startedAt,
      completedAt: new Date().toISOString(),
      status: "completed",
      attempts,
      proofReceipts: [],
      message: "Source material was distilled into a durable ExecPlan outline.",
    })
  } catch (error) {
    const receipt = await persistReceipt(params.repoRoot, {
      schemaVersion: 1,
      runId,
      phase: "outline",
      planPath: toRepoPath(params.repoRoot, outputPath),
      startedAt,
      completedAt: new Date().toISOString(),
      status: "failed",
      attempts,
      proofReceipts: [],
      message: errorMessage(error, "ExecPlan outline distillation failed."),
    })
    throw new WorkflowPhaseError(receipt, { cause: error })
  }
}

async function runSinglePhase(params: {
  adapter?: AgentAdapter
  blocks?: Record<string, string | undefined>
  config: ProgrammersLoopConfig
  phase: "write" | "execute"
  planPath: string
  repoRoot: string
  runId?: string
}): Promise<WorkflowReceipt> {
  const runId = phaseReceiptId(params.runId, params.phase)
  const prior =
    params.runId === undefined
      ? null
      : await readResumableReceipt({
          phase: params.phase,
          planPath: params.planPath,
          receiptId: runId,
          repoRoot: params.repoRoot,
        })
  if (prior?.status === "completed") return prior
  const context = await resolveContext({
    ...params,
    requireReady: params.phase !== "write",
  })
  const startedAt = prior?.startedAt ?? new Date().toISOString()
  const promptBase = await loadRuntimePrompt(
    params.repoRoot,
    params.phase === "write" ? "exec-plan.write" : "exec-plan.execute",
  )
  const skills = await curatedSkillsBlock({
    max: params.config.skills?.maxPerPhase,
    phase: params.phase,
    shape: EXEC_PLAN_SHAPE,
  })
  // Scope is made visible at execution time (the active-lane plan still exists
  // here; the completion move happens after this agent run).
  const scope =
    params.phase === "execute"
      ? await declaredScopeBlock(context.planPath)
      : undefined
  const result = await runAgent(
    context,
    renderPrompt(promptBase, {
      target_execplan_path: toRepoPath(params.repoRoot, context.planPath),
      ...params.blocks,
      declared_scope: scope,
      curated_skills: skills,
    }),
  )
  const attempts = [
    ...(prior?.attempts ?? []),
    attemptFromResult(
      (prior?.attempts.length ?? 0) + 1,
      result,
      params.config.agent.maxOutputBytes,
    ),
  ]
  // A successful execute may legitimately complete the plan and move it to the
  // completed lane; lint and receipts must follow the moved plan, not the
  // stale active path.
  if (params.phase === "execute") {
    context.planPath = await locatePlanAfterTransition(context.planPath)
  }
  try {
    await assertAgentSucceeded(result)
    await assertPlanStillValid(context)
    if (params.phase === "write") await assertPlanReady(context)
    return persistReceipt(params.repoRoot, {
      schemaVersion: 1,
      runId,
      phase: params.phase,
      planPath: toRepoPath(params.repoRoot, context.planPath),
      startedAt,
      completedAt: new Date().toISOString(),
      status: "completed",
      attempts,
      proofReceipts: [],
      message: `${params.phase} completed and the ExecPlan contract passed.`,
    })
  } catch (error) {
    const receipt = await persistReceipt(params.repoRoot, {
      schemaVersion: 1,
      runId,
      phase: params.phase,
      planPath: toRepoPath(params.repoRoot, context.planPath),
      startedAt,
      completedAt: new Date().toISOString(),
      status: "failed",
      attempts,
      proofReceipts: [],
      message: error instanceof Error ? error.message : "Agent phase failed.",
    })
    throw new WorkflowPhaseError(receipt, { cause: error })
  }
}

export async function writeExecPlan(params: {
  adapter?: AgentAdapter
  config: ProgrammersLoopConfig
  outline?: string
  planPath: string
  repoRoot: string
  runId?: string
}): Promise<WorkflowReceipt> {
  return runSinglePhase({
    ...params,
    blocks: { feature_outline: params.outline },
    phase: "write",
  })
}

export async function executeExecPlan(params: {
  adapter?: AgentAdapter
  config: ProgrammersLoopConfig
  planPath: string
  repoRoot: string
  runId?: string
}): Promise<WorkflowReceipt> {
  // A crash between the execute agent's designed completion move and receipt
  // persistence — or between execute and validate — leaves callers holding
  // the stale active-lane path; follow the move before resolving, exactly as
  // validation does.
  return runSinglePhase({
    ...params,
    phase: "execute",
    planPath: toRepoPath(
      params.repoRoot,
      await locatePlanAfterTransition(
        resolveRepoPath(params.repoRoot, params.planPath),
      ),
    ),
  })
}

type GrillFooter = {
  reply: string
  status: "question" | "complete" | "blocked"
}

export function parseGrillFooter(message: string): GrillFooter | null {
  const status = /^AUTOMATION_STATUS: (question|complete|blocked)\s*$/m.exec(
    message,
  )?.[1] as GrillFooter["status"] | undefined
  const reply = /^AUTOMATION_REPLY: (.+?)\s*$/m.exec(message)?.[1]
  return status && reply ? { status, reply } : null
}

function visibleGrillMessage(message: string): string {
  return message
    .replace(/^AUTOMATION_STATUS: (?:question|complete|blocked)\s*$/gm, "")
    .replace(/^AUTOMATION_REPLY: .+?\s*$/gm, "")
    .trim()
}

export async function grillExecPlan(params: {
  adapter?: AgentAdapter
  config: ProgrammersLoopConfig
  maxRounds?: number
  planPath: string
  repoRoot: string
  runId?: string
}): Promise<WorkflowReceipt> {
  const runId = phaseReceiptId(params.runId, "grill")
  // Cross-process grill resumption is durable-state-first: a resumed grill
  // never replays a persisted provider sessionId (provider session storage is
  // not guaranteed to survive between processes, and leaning on it would
  // reintroduce exactly the hidden chat history this runtime removes). It
  // starts a fresh session against the current plan, whose text already
  // absorbed every previously answered question, so the fallback path is
  // deliberately the primary path. The exact-session continuation below still
  // applies to rounds within one process run.
  const prior =
    params.runId === undefined
      ? null
      : await readResumableReceipt({
          phase: "grill",
          planPath: params.planPath,
          receiptId: runId,
          repoRoot: params.repoRoot,
        })
  if (prior?.status === "completed") return prior
  const context = await resolveContext(params)
  const startedAt = prior?.startedAt ?? new Date().toISOString()
  const priorRounds = prior?.attempts.length ?? 0
  const attempts: AgentAttempt[] = [...(prior?.attempts ?? [])]
  const promptBase = await loadRuntimePrompt(params.repoRoot, "exec-plan.grill")
  const skills = await curatedSkillsBlock({
    max: params.config.skills?.maxPerPhase,
    phase: "grill",
    shape: EXEC_PLAN_SHAPE,
  })
  let recommendedReply: string | undefined
  let sessionId: string | undefined
  const maxRounds = params.maxRounds ?? 5

  for (let round = 1; round <= maxRounds; round += 1) {
    const result = await runAgent(
      context,
      renderPrompt(promptBase, {
        target_execplan_path: toRepoPath(params.repoRoot, context.planPath),
        prior_recommended_reply: recommendedReply,
        curated_skills: skills,
      }),
      { ephemeral: false, sessionId },
    )
    sessionId = result.sessionId ?? sessionId
    attempts.push(
      attemptFromResult(
        priorRounds + round,
        result,
        params.config.agent.maxOutputBytes,
      ),
    )
    try {
      await assertAgentSucceeded(result)
      await assertPlanStillValid(context)
    } catch (error) {
      const receipt = await persistReceipt(params.repoRoot, {
        schemaVersion: 1,
        runId,
        phase: "grill",
        planPath: toRepoPath(params.repoRoot, context.planPath),
        startedAt,
        completedAt: new Date().toISOString(),
        status: "failed",
        attempts,
        proofReceipts: [],
        message: errorMessage(error, "ExecPlan grill failed."),
      })
      throw new WorkflowPhaseError(receipt, { cause: error })
    }
    const footer = parseGrillFooter(result.lastMessage)
    if (!footer) {
      const receipt = await persistReceipt(params.repoRoot, {
        schemaVersion: 1,
        runId,
        phase: "grill",
        planPath: toRepoPath(params.repoRoot, context.planPath),
        startedAt,
        completedAt: new Date().toISOString(),
        status: "failed",
        attempts,
        proofReceipts: [],
        message: "Grill response omitted the required automation footer.",
      })
      throw new WorkflowPhaseError(receipt)
    }
    if (footer.status === "complete") {
      return persistReceipt(params.repoRoot, {
        schemaVersion: 1,
        runId,
        phase: "grill",
        planPath: toRepoPath(params.repoRoot, context.planPath),
        startedAt,
        completedAt: new Date().toISOString(),
        status: "completed",
        attempts,
        proofReceipts: [],
        message: "ExecPlan grill completed.",
      })
    }
    if (footer.status === "blocked" || footer.reply === "none") {
      const visibleMessage = visibleGrillMessage(result.lastMessage)
      return persistReceipt(params.repoRoot, {
        schemaVersion: 1,
        runId,
        phase: "grill",
        planPath: toRepoPath(params.repoRoot, context.planPath),
        startedAt,
        completedAt: new Date().toISOString(),
        status: footer.status === "blocked" ? "blocked" : "question",
        attempts,
        proofReceipts: [],
        message:
          visibleMessage ||
          (footer.status === "blocked"
            ? "The ExecPlan grill is blocked."
            : "The ExecPlan grill requires owner input."),
      })
    }
    if (!sessionId) {
      const receipt = await persistReceipt(params.repoRoot, {
        schemaVersion: 1,
        runId,
        phase: "grill",
        planPath: toRepoPath(params.repoRoot, context.planPath),
        startedAt,
        completedAt: new Date().toISOString(),
        status: "failed",
        attempts,
        proofReceipts: [],
        message:
          "The agent adapter requested another grill round without returning an exact session id.",
      })
      throw new WorkflowPhaseError(receipt)
    }
    recommendedReply = footer.reply
  }

  return persistReceipt(params.repoRoot, {
    schemaVersion: 1,
    runId,
    phase: "grill",
    planPath: toRepoPath(params.repoRoot, context.planPath),
    startedAt,
    completedAt: new Date().toISOString(),
    status: "question",
    attempts,
    proofReceipts: [],
    message: "Grill exhausted its bounded automatic reply budget.",
  })
}

function proofFeedback(receipt: ProofReceipt): string {
  const failed = receipt.commands.find(
    (command) => command.exitCode !== 0 || command.timedOut,
  )
  if (!failed) return `Proof status: ${receipt.status}`
  return [
    `Proof status: ${receipt.status}`,
    `Command: ${failed.command}`,
    `Exit code: ${failed.exitCode}`,
    `Timed out: ${failed.timedOut}`,
    `stdout:\n${failed.stdout}`,
    `stderr:\n${failed.stderr}`,
  ].join("\n")
}

export async function validateExecPlan(params: {
  adapter?: AgentAdapter
  approvedProof?: ProofPreview
  config: ProgrammersLoopConfig
  executeProof?: typeof executeProof
  executeProofCommands?: boolean
  maxAttempts?: number
  planPath: string
  repoRoot: string
  runId?: string
}): Promise<WorkflowReceipt> {
  const runId = phaseReceiptId(params.runId, "validate")
  const prior =
    params.runId === undefined
      ? null
      : await readResumableReceipt({
          phase: "validate",
          planPath: params.planPath,
          receiptId: runId,
          repoRoot: params.repoRoot,
        })
  if (prior?.status === "completed") return prior
  // Validation may be handed the pre-completion path of a plan the execute
  // phase already moved to the completed lane; validate the moved plan.
  const context = await resolveContext({
    ...params,
    planPath: toRepoPath(
      params.repoRoot,
      await locatePlanAfterTransition(
        resolveRepoPath(params.repoRoot, params.planPath),
      ),
    ),
  })
  const startedAt = prior?.startedAt ?? new Date().toISOString()
  const priorRounds = prior?.attempts.length ?? 0
  const attempts: AgentAttempt[] = [...(prior?.attempts ?? [])]
  const proofReceipts: string[] = [...(prior?.proofReceipts ?? [])]
  const promptBase = await loadRuntimePrompt(
    params.repoRoot,
    "exec-plan.validate",
  )
  const skills = await curatedSkillsBlock({
    max: params.config.skills?.maxPerPhase,
    phase: "validate",
    shape: EXEC_PLAN_SHAPE,
  })
  let priorProofFailure: string | undefined
  const maxAttempts = params.maxAttempts ?? 3
  const approvedProof = params.executeProofCommands
    ? (params.approvedProof ??
      (await previewProof({
        config: params.config,
        planPath: context.planPath,
        repoRoot: params.repoRoot,
      })))
    : undefined
  if (approvedProof && !approvedProof.executable) {
    return persistReceipt(params.repoRoot, {
      schemaVersion: 1,
      runId,
      phase: "validate",
      planPath: toRepoPath(params.repoRoot, context.planPath),
      startedAt,
      completedAt: new Date().toISOString(),
      status: "blocked",
      attempts,
      proofReceipts,
      message:
        "Deterministic proof contains rejected commands; edit and preview the plan before validation.",
    })
  }

  for (let round = 1; round <= maxAttempts; round += 1) {
    const result = await runAgent(
      context,
      renderPrompt(promptBase, {
        deterministic_proof_owner:
          "The runtime, not the agent, executes approved proof commands after this repair pass.",
        prior_proof_failure: priorProofFailure,
        target_execplan_path: toRepoPath(params.repoRoot, context.planPath),
        curated_skills: skills,
      }),
    )
    attempts.push(
      attemptFromResult(
        priorRounds + round,
        result,
        params.config.agent.maxOutputBytes,
      ),
    )
    // A validation repair round may itself complete the plan into the
    // completed lane; keep following the plan across that designed move.
    context.planPath = await locatePlanAfterTransition(context.planPath)
    try {
      await assertAgentSucceeded(result)
      await assertPlanStillValid(context)
    } catch (error) {
      const receipt = await persistReceipt(params.repoRoot, {
        schemaVersion: 1,
        runId,
        phase: "validate",
        planPath: toRepoPath(params.repoRoot, context.planPath),
        startedAt,
        completedAt: new Date().toISOString(),
        status: "failed",
        attempts,
        proofReceipts,
        message: errorMessage(error, "ExecPlan validation failed."),
      })
      throw new WorkflowPhaseError(receipt, { cause: error })
    }

    if (!params.executeProofCommands) {
      return persistReceipt(params.repoRoot, {
        schemaVersion: 1,
        runId,
        phase: "validate",
        planPath: toRepoPath(params.repoRoot, context.planPath),
        startedAt,
        completedAt: new Date().toISOString(),
        status: "completed",
        attempts,
        proofReceipts,
        message:
          "Agent validation completed; deterministic proof was not requested.",
      })
    }

    const currentPreview = await previewProof({
      config: params.config,
      planPath: context.planPath,
      repoRoot: params.repoRoot,
    })
    if (
      JSON.stringify(currentPreview.commands) !==
      JSON.stringify(approvedProof?.commands)
    ) {
      return persistReceipt(params.repoRoot, {
        schemaVersion: 1,
        runId,
        phase: "validate",
        planPath: toRepoPath(params.repoRoot, context.planPath),
        startedAt,
        completedAt: new Date().toISOString(),
        status: "blocked",
        attempts,
        proofReceipts,
        message:
          "The agent changed the approved proof commands; preview them and grant fresh consent.",
      })
    }
    let proof: ProofReceipt
    try {
      proof = await (params.executeProof ?? executeProof)({
        approvedPreview: approvedProof,
        config: params.config,
        planPath: context.planPath,
        repoRoot: params.repoRoot,
      })
    } catch (error) {
      const receipt = await persistReceipt(params.repoRoot, {
        schemaVersion: 1,
        runId,
        phase: "validate",
        planPath: toRepoPath(params.repoRoot, context.planPath),
        startedAt,
        completedAt: new Date().toISOString(),
        status: "failed",
        attempts,
        proofReceipts,
        message: errorMessage(error, "Deterministic proof failed to run."),
      })
      if (error instanceof UserInputError) throw error
      throw new WorkflowPhaseError(receipt, { cause: error })
    }
    proofReceipts.push(proof.receiptPath)
    if (proof.status === "passed") {
      return persistReceipt(params.repoRoot, {
        schemaVersion: 1,
        runId,
        phase: "validate",
        planPath: toRepoPath(params.repoRoot, context.planPath),
        startedAt,
        completedAt: new Date().toISOString(),
        status: "completed",
        attempts,
        proofReceipts,
        message: "Agent validation and deterministic proof completed.",
      })
    }
    if (proof.status === "rejected") {
      return persistReceipt(params.repoRoot, {
        schemaVersion: 1,
        runId,
        phase: "validate",
        planPath: toRepoPath(params.repoRoot, context.planPath),
        startedAt,
        completedAt: new Date().toISOString(),
        status: "blocked",
        attempts,
        proofReceipts,
        message: "Deterministic proof rejected one or more commands.",
      })
    }
    priorProofFailure = proofFeedback(proof)
  }

  return persistReceipt(params.repoRoot, {
    schemaVersion: 1,
    runId,
    phase: "validate",
    planPath: toRepoPath(params.repoRoot, context.planPath),
    startedAt,
    completedAt: new Date().toISOString(),
    status: "failed",
    attempts,
    proofReceipts,
    message:
      "Deterministic proof still failed after the bounded repair budget.",
  })
}

/**
 * Runs write (when an outline is provided) → grill → execute → validate.
 *
 * Passing a runId makes the chain resumable across process death: every phase
 * persists its receipt at a deterministic runId-derived path, so a fresh
 * process re-running the same call returns completed phases' receipts
 * verbatim — zero agent invocations — and continues from the first phase
 * without a completed receipt. Progress inside an interrupted phase is
 * carried by the durable plan itself (Progress checkboxes, Decision Log, the
 * completion lane move), which the resumed phase's fresh agent session
 * re-reads; no hidden chat history is required. Re-running a fully completed
 * runId returns all receipts idempotently, and resuming must repeat the
 * original call shape (same plan, and the outline again when the run began
 * with one).
 */
export async function runExecPlanWorkflow(params: {
  adapter?: AgentAdapter
  approvedProof?: ProofPreview
  config: ProgrammersLoopConfig
  executeProofCommands?: boolean
  maxGrillRounds?: number
  maxValidationAttempts?: number
  outline?: string
  planPath: string
  repoRoot: string
  runId?: string
}): Promise<WorkflowReceipt[]> {
  const receipts: WorkflowReceipt[] = []
  if (params.outline !== undefined) {
    receipts.push(
      await writeExecPlan({
        adapter: params.adapter,
        config: params.config,
        outline: params.outline,
        planPath: params.planPath,
        repoRoot: params.repoRoot,
        runId: params.runId,
      }),
    )
  }
  const grill = await grillExecPlan({
    ...params,
    maxRounds: params.maxGrillRounds,
  })
  receipts.push(grill)
  if (grill.status !== "completed") return receipts
  receipts.push(await executeExecPlan(params))
  receipts.push(
    await validateExecPlan({
      ...params,
      maxAttempts: params.maxValidationAttempts,
    }),
  )
  return receipts
}

export async function readOutline(params: {
  outlinePath: string
  repoRoot: string
}): Promise<string> {
  const outlinePath = await resolveExistingRepoPath(
    params.repoRoot,
    params.outlinePath,
  )
  return readFile(outlinePath, "utf8")
}
