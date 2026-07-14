import { access, mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"

import { createAgentAdapter } from "../agents/index.js"
import type { AgentAdapter, AgentRunResult } from "../agents/types.js"
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
import { extractSection } from "../markdown/frontmatter.js"
import { createRunId, writeRuntimeJson } from "../runtime/store.js"
import { loadRuntimePrompt, renderPrompt } from "./prompts.js"

export type AgentAttempt = {
  exitCode: number
  lastMessage: string
  round: number
  sessionId: string | null
  stderr: string
  stderrTruncated: boolean
  timedOut: boolean
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
    exitCode: result.exitCode,
    lastMessage: bounded(result.lastMessage, maxBytes),
    round,
    sessionId: result.sessionId ?? null,
    stderr: bounded(result.stderr, maxBytes),
    stderrTruncated: result.stderrTruncated,
    timedOut: result.timedOut,
  }
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

async function persistReceipt(
  repoRoot: string,
  receipt: Omit<WorkflowReceipt, "receiptPath">,
): Promise<WorkflowReceipt> {
  const relativePath = path.join(
    ".runtime",
    "workflows",
    "exec-plans",
    `${receipt.runId}.json`,
  )
  const complete: WorkflowReceipt = {
    ...receipt,
    receiptPath: relativePath.split(path.sep).join("/"),
  }
  await writeRuntimeJson({ relativePath, repoRoot, value: complete })
  return complete
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
    await persistReceipt(params.repoRoot, {
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
    throw error
  }
}

async function runSinglePhase(params: {
  adapter?: AgentAdapter
  blocks?: Record<string, string | undefined>
  config: ProgrammersLoopConfig
  phase: "write" | "execute"
  planPath: string
  repoRoot: string
}): Promise<WorkflowReceipt> {
  const context = await resolveContext({
    ...params,
    requireReady: params.phase !== "write",
  })
  const startedAt = new Date().toISOString()
  const runId = createRunId(params.phase)
  const promptBase = await loadRuntimePrompt(
    params.repoRoot,
    params.phase === "write" ? "exec-plan.write" : "exec-plan.execute",
  )
  const result = await runAgent(
    context,
    renderPrompt(promptBase, {
      target_execplan_path: toRepoPath(params.repoRoot, context.planPath),
      ...params.blocks,
    }),
  )
  const attempts = [
    attemptFromResult(1, result, params.config.agent.maxOutputBytes),
  ]
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
    await persistReceipt(params.repoRoot, {
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
    throw error
  }
}

export async function writeExecPlan(params: {
  adapter?: AgentAdapter
  config: ProgrammersLoopConfig
  outline?: string
  planPath: string
  repoRoot: string
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
}): Promise<WorkflowReceipt> {
  return runSinglePhase({ ...params, phase: "execute" })
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
}): Promise<WorkflowReceipt> {
  const context = await resolveContext(params)
  const startedAt = new Date().toISOString()
  const runId = createRunId("grill")
  const attempts: AgentAttempt[] = []
  const promptBase = await loadRuntimePrompt(params.repoRoot, "exec-plan.grill")
  let recommendedReply: string | undefined
  let sessionId: string | undefined
  const maxRounds = params.maxRounds ?? 5

  for (let round = 1; round <= maxRounds; round += 1) {
    const result = await runAgent(
      context,
      renderPrompt(promptBase, {
        target_execplan_path: toRepoPath(params.repoRoot, context.planPath),
        prior_recommended_reply: recommendedReply,
      }),
      { ephemeral: false, sessionId },
    )
    sessionId = result.sessionId ?? sessionId
    attempts.push(
      attemptFromResult(round, result, params.config.agent.maxOutputBytes),
    )
    try {
      await assertAgentSucceeded(result)
      await assertPlanStillValid(context)
    } catch (error) {
      await persistReceipt(params.repoRoot, {
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
      throw error
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
      throw new Error(receipt.message)
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
      throw new Error(receipt.message)
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
}): Promise<WorkflowReceipt> {
  const context = await resolveContext(params)
  const startedAt = new Date().toISOString()
  const runId = createRunId("validate")
  const attempts: AgentAttempt[] = []
  const proofReceipts: string[] = []
  const promptBase = await loadRuntimePrompt(
    params.repoRoot,
    "exec-plan.validate",
  )
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
      }),
    )
    attempts.push(
      attemptFromResult(round, result, params.config.agent.maxOutputBytes),
    )
    try {
      await assertAgentSucceeded(result)
      await assertPlanStillValid(context)
    } catch (error) {
      await persistReceipt(params.repoRoot, {
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
      throw error
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
      await persistReceipt(params.repoRoot, {
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
      throw error
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
