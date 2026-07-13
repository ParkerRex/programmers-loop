import { createHash } from "node:crypto"
import { access, readFile } from "node:fs/promises"
import path from "node:path"

import { createAgentAdapter } from "../agents/index.js"
import type { AgentAdapter } from "../agents/types.js"
import type { ProgrammersLoopConfig } from "../config.js"
import { lintProgram } from "../contracts/program.js"
import { parseMarkdownFrontmatter } from "../markdown/frontmatter.js"
import {
  assertIsoDate,
  assertKebabCase,
  resolveExistingRepoPath,
  toRepoPath,
  UserInputError,
} from "../repo-path.js"
import { createExecPlanScaffold } from "../scaffold.js"
import {
  createRunId,
  readRuntimeJson,
  writeRuntimeJson,
  writeRuntimeText,
} from "../runtime/store.js"
import { writeExecPlan } from "./exec-plan.js"
import { loadRuntimePrompt, renderPrompt } from "./prompts.js"

export type ProgramAdvanceReceipt = {
  schemaVersion: 1
  agentMessage: string
  runId: string
  programPath: string
  planningBriefPath: string
  startedAt: string
  completedAt: string
  status: "completed" | "failed"
  exitCode: number
  timedOut: boolean
  message: string
  receiptPath: string
  sessionId: string | null
  stderr: string
}

export type ProgramChildPlanReceipt = {
  schemaVersion: 1
  runId: string
  programPath: string
  planPath: string
  planningBriefPath: string
  planningBriefSha256: string
  planningBriefSnapshotPath: string
  startedAt: string
  updatedAt: string
  status: "writing" | "completed" | "failed"
  title: string
  slug: string
  childWorkflowReceipt: string | null
  message: string
  receiptPath: string
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath)
    return true
  } catch {
    return false
  }
}

function assertRunId(runId: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(runId)) {
    throw new UserInputError(
      "run-id must contain only letters, numbers, periods, underscores, and hyphens.",
    )
  }
}

function bounded(value: string, maxBytes: number): string {
  const buffer = Buffer.from(value)
  if (buffer.length <= maxBytes) return value
  return `${buffer.subarray(0, maxBytes).toString("utf8")}\n[truncated]`
}

async function resolveProgram(params: {
  programPath: string
  repoRoot: string
}): Promise<{
  briefPath: string
  briefSource: string
  programPath: string
}> {
  const programPath = await resolveExistingRepoPath(
    params.repoRoot,
    params.programPath,
  )
  const issues = await lintProgram({
    programRoot: programPath,
    repoRoot: params.repoRoot,
  })
  if (issues.length > 0) {
    throw new UserInputError(
      `Program is invalid: ${issues[0]?.path}: ${issues[0]?.message}`,
    )
  }
  const briefName = (
    await readFile(path.join(programPath, "briefs", "current.txt"), "utf8")
  ).trim()
  const briefPath = path.join(programPath, "briefs", briefName)
  return {
    briefPath,
    briefSource: await readFile(briefPath, "utf8"),
    programPath,
  }
}

function childReceiptPath(runId: string): string {
  return path.join(".runtime", "workflows", "programs", `${runId}.json`)
}

async function persistChildReceipt(
  repoRoot: string,
  receipt: ProgramChildPlanReceipt,
): Promise<ProgramChildPlanReceipt> {
  await writeRuntimeJson({
    relativePath: childReceiptPath(receipt.runId),
    repoRoot,
    value: receipt,
  })
  return receipt
}

export async function previewProgramChildPlan(params: {
  config: ProgrammersLoopConfig
  date?: string
  programPath: string
  repoRoot: string
  runId?: string
  slug: string
  summary?: string
  title: string
}): Promise<ProgramChildPlanReceipt> {
  const program = await resolveProgram(params)
  const relativeProgram = toRepoPath(params.repoRoot, program.programPath)
  if (
    !relativeProgram.startsWith(`${params.config.planningRoot}/active/`) ||
    !relativeProgram.includes("/programs/active/")
  ) {
    throw new UserInputError("Child plans require an active Program.")
  }
  assertKebabCase(params.slug, "slug")
  if (params.title.trim() === "") {
    throw new UserInputError("title must not be empty.")
  }
  const date = params.date ?? new Date().toISOString().slice(0, 10)
  assertIsoDate(date)
  const runId = params.runId ?? createRunId("program-child-plan")
  assertRunId(runId)
  const planPath = toRepoPath(
    params.repoRoot,
    path.join(
      program.programPath,
      "exec-plans",
      "active",
      `${date}-${params.slug}.md`,
    ),
  )
  const startedAt = new Date().toISOString()
  const planningBriefSnapshotPath = path
    .join(".runtime", "workflows", "programs", runId, "planning-brief.md")
    .split(path.sep)
    .join("/")
  return {
    schemaVersion: 1,
    runId,
    programPath: relativeProgram,
    planPath,
    planningBriefPath: toRepoPath(params.repoRoot, program.briefPath),
    planningBriefSha256: createHash("sha256")
      .update(program.briefSource)
      .digest("hex"),
    planningBriefSnapshotPath,
    startedAt,
    updatedAt: startedAt,
    status: "writing",
    title: params.title,
    slug: params.slug,
    childWorkflowReceipt: null,
    message: "Preview only; no files or agent runs have been created.",
    receiptPath: childReceiptPath(runId).split(path.sep).join("/"),
  }
}

export async function runProgramChildPlan(params: {
  adapter?: AgentAdapter
  config: ProgrammersLoopConfig
  date?: string
  outline?: string
  programPath: string
  repoRoot: string
  runId?: string
  slug: string
  summary?: string
  title: string
}): Promise<ProgramChildPlanReceipt> {
  const preview = await previewProgramChildPlan(params)
  const existing = await readRuntimeJson<ProgramChildPlanReceipt>({
    relativePath: childReceiptPath(preview.runId),
    repoRoot: params.repoRoot,
  })
  if (existing) {
    if (
      existing.programPath !== preview.programPath ||
      existing.planPath !== preview.planPath ||
      existing.slug !== preview.slug ||
      existing.title !== preview.title
    ) {
      throw new UserInputError(
        "run-id already belongs to a different Program child-plan request.",
      )
    }
    if (existing.status === "completed") return existing
    if (existing.planningBriefSha256 !== preview.planningBriefSha256) {
      throw new UserInputError(
        "The pinned planning brief changed after this run began; use a new run-id.",
      )
    }
  }

  const program = await resolveProgram(params)
  const currentBriefPath = toRepoPath(params.repoRoot, program.briefPath)
  const currentBriefSha256 = createHash("sha256")
    .update(program.briefSource)
    .digest("hex")
  if (
    currentBriefPath !== preview.planningBriefPath ||
    currentBriefSha256 !== preview.planningBriefSha256
  ) {
    throw new UserInputError(
      "The current planning brief changed while this run was starting; retry with a new run-id.",
    )
  }
  let receipt: ProgramChildPlanReceipt = {
    ...(existing ?? preview),
    updatedAt: new Date().toISOString(),
    status: "writing",
    message:
      "Pinned the current planning brief and started child-plan writing.",
  }
  await persistChildReceipt(params.repoRoot, receipt)
  await writeRuntimeText({
    relativePath: receipt.planningBriefSnapshotPath,
    repoRoot: params.repoRoot,
    text: program.briefSource,
  })

  try {
    const absolutePlanPath = path.join(params.repoRoot, receipt.planPath)
    const planExists = await exists(absolutePlanPath)
    if (planExists && !existing) {
      throw new UserInputError(
        `Refusing to overwrite existing child plan: ${receipt.planPath}`,
      )
    }
    if (!planExists) {
      await createExecPlanScaffold({
        config: params.config,
        date: params.date,
        ownerPath: program.programPath,
        planningBriefPath: receipt.planningBriefPath,
        repoRoot: params.repoRoot,
        slug: params.slug,
        summary: params.summary,
        title: params.title,
      })
    } else {
      const parsed = parseMarkdownFrontmatter(
        await readFile(absolutePlanPath, "utf8"),
      )
      if (
        parsed.metadata.program_id !== path.basename(program.programPath) ||
        parsed.metadata.planning_brief !== receipt.planningBriefPath
      ) {
        throw new UserInputError(
          "Existing retry plan does not match the Program run's pinned brief.",
        )
      }
    }
    const child = await writeExecPlan({
      adapter: params.adapter,
      config: params.config,
      outline: params.outline,
      planPath: receipt.planPath,
      repoRoot: params.repoRoot,
    })
    const parsed = parseMarkdownFrontmatter(
      await readFile(absolutePlanPath, "utf8"),
    )
    if (parsed.metadata.planning_brief !== receipt.planningBriefPath) {
      throw new Error(
        "Child ExecPlan did not preserve the pinned planning brief.",
      )
    }
    receipt = {
      ...receipt,
      updatedAt: new Date().toISOString(),
      status: "completed",
      childWorkflowReceipt: child.receiptPath,
      message: "Child ExecPlan was written from the pinned planning brief.",
    }
    return persistChildReceipt(params.repoRoot, receipt)
  } catch (error) {
    receipt = {
      ...receipt,
      updatedAt: new Date().toISOString(),
      status: "failed",
      message:
        error instanceof Error ? error.message : "Child-plan writing failed.",
    }
    await persistChildReceipt(params.repoRoot, receipt)
    throw error
  }
}

export async function advanceProgram(params: {
  adapter?: AgentAdapter
  config: ProgrammersLoopConfig
  programPath: string
  repoRoot: string
}): Promise<ProgramAdvanceReceipt> {
  const program = await resolveProgram(params)
  const runId = createRunId("program-advance")
  const startedAt = new Date().toISOString()
  const relativeReceiptPath = childReceiptPath(runId)
  const adapter = params.adapter ?? createAgentAdapter(params.config)
  const promptBase = await loadRuntimePrompt(
    params.repoRoot,
    "program.orchestrate",
  )
  const result = await adapter.run({
    cwd: params.repoRoot,
    ephemeral: true,
    maxOutputBytes: params.config.agent.maxOutputBytes,
    model: params.config.agent.model,
    profile: params.config.agent.profile,
    prompt: renderPrompt(promptBase, {
      current_planning_brief: toRepoPath(params.repoRoot, program.briefPath),
      program_path: toRepoPath(params.repoRoot, program.programPath),
    }),
    sandbox: "workspace-write",
    timeoutMs: params.config.agent.runTimeoutMs,
  })
  let status: ProgramAdvanceReceipt["status"] = "completed"
  let message = "Program advanced by one durable transition."
  if (result.timedOut || result.exitCode !== 0) {
    status = "failed"
    message = result.timedOut
      ? "Program agent run timed out."
      : `Program agent run failed with exit code ${result.exitCode}.`
  } else {
    const issues = await lintProgram({
      programRoot: program.programPath,
      repoRoot: params.repoRoot,
    })
    if (issues.length > 0) {
      status = "failed"
      message = `Program transition broke the contract: ${issues[0]?.message}`
    }
  }
  const receipt: ProgramAdvanceReceipt = {
    schemaVersion: 1,
    agentMessage: bounded(
      result.lastMessage,
      params.config.agent.maxOutputBytes,
    ),
    runId,
    programPath: toRepoPath(params.repoRoot, program.programPath),
    planningBriefPath: toRepoPath(params.repoRoot, program.briefPath),
    startedAt,
    completedAt: new Date().toISOString(),
    status,
    exitCode: result.exitCode,
    timedOut: result.timedOut,
    message,
    receiptPath: relativeReceiptPath.split(path.sep).join("/"),
    sessionId: result.sessionId ?? null,
    stderr: bounded(result.stderr, params.config.agent.maxOutputBytes),
  }
  await writeRuntimeJson({
    relativePath: relativeReceiptPath,
    repoRoot: params.repoRoot,
    value: receipt,
  })
  return receipt
}
