import { createHash } from "node:crypto"
import { access, readdir, readFile, readlink } from "node:fs/promises"
import path from "node:path"

import { createAgentAdapter } from "../agents/index.js"
import type { AgentAdapter } from "../agents/types.js"
import type { ProgrammersLoopConfig } from "../config.js"
import {
  lintProgram,
  lintProgramReadiness,
  lintProgramTransitionReadiness,
  PROGRAM_PLACEHOLDER_MARKER,
} from "../contracts/program.js"
import {
  extractSection,
  parseMarkdownFrontmatter,
} from "../markdown/frontmatter.js"
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
  schemaVersion: 2
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
  transition: string | null
  changedPaths: string[]
}

export type ProgramChildPlanReceipt = {
  schemaVersion: 2
  runId: string
  programPath: string
  planPath: string
  planningBriefPath: string
  planningBriefSha256: string
  planningBriefSnapshotPath: string
  planSnapshotPath: string
  milestoneCount: number | null
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

function countMilestones(planSource: string): number {
  const milestones = extractSection(
    parseMarkdownFrontmatter(planSource).body,
    "Milestones",
  )
  if (!milestones) return 0
  const headings = [...milestones.matchAll(/^### Milestone\b/gm)].length
  if (headings > 0) return headings
  return [...milestones.matchAll(/^\d+\.\s+\S/gm)].length
}

async function resolveProgram(params: {
  programPath: string
  repoRoot: string
  requireReady?: boolean
}): Promise<{
  briefPath: string
  briefSource: string
  programPath: string
}> {
  const programPath = await resolveExistingRepoPath(
    params.repoRoot,
    params.programPath,
  )
  const issues = params.requireReady
    ? await lintProgramReadiness({
        programRoot: programPath,
        repoRoot: params.repoRoot,
      })
    : await lintProgram({
        programRoot: programPath,
        repoRoot: params.repoRoot,
      })
  if (issues.length > 0) {
    throw new UserInputError(
      `Program ${params.requireReady ? "is not execution-ready" : "is invalid"}: ${issues[0]?.path}: ${issues[0]?.message}`,
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
  const program = await resolveProgram({ ...params, requireReady: true })
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
  const planSnapshotPath = path
    .join(".runtime", "workflows", "programs", runId, "exec-plan.md")
    .split(path.sep)
    .join("/")
  return {
    schemaVersion: 2,
    runId,
    programPath: relativeProgram,
    planPath,
    planningBriefPath: toRepoPath(params.repoRoot, program.briefPath),
    planningBriefSha256: createHash("sha256")
      .update(program.briefSource)
      .digest("hex"),
    planningBriefSnapshotPath,
    planSnapshotPath,
    milestoneCount: null,
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

  const program = await resolveProgram({ ...params, requireReady: true })
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
    const planSource = await readFile(absolutePlanPath, "utf8")
    const parsed = parseMarkdownFrontmatter(planSource)
    if (parsed.metadata.planning_brief !== receipt.planningBriefPath) {
      throw new Error(
        "Child ExecPlan did not preserve the pinned planning brief.",
      )
    }
    await writeRuntimeText({
      relativePath: receipt.planSnapshotPath,
      repoRoot: params.repoRoot,
      text: planSource,
    })
    receipt = {
      ...receipt,
      updatedAt: new Date().toISOString(),
      status: "completed",
      childWorkflowReceipt: child.receiptPath,
      milestoneCount: countMilestones(planSource),
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

type SnapshotEntry = {
  hash: string
  kind: "directory" | "file" | "symlink"
  source: string
}

type ProgramSnapshot = Map<string, SnapshotEntry>

async function snapshotProgram(programRoot: string): Promise<ProgramSnapshot> {
  const snapshot: ProgramSnapshot = new Map()
  async function visit(directory: string): Promise<void> {
    const entries = (
      await readdir(directory, { withFileTypes: true })
    ).toSorted((left, right) => left.name.localeCompare(right.name))
    for (const entry of entries) {
      const absolutePath = path.join(directory, entry.name)
      if (entry.isDirectory()) {
        snapshot.set(`${toRepoPath(programRoot, absolutePath)}/`, {
          hash: "directory",
          kind: "directory",
          source: "",
        })
        await visit(absolutePath)
      } else if (entry.isFile()) {
        const contents = await readFile(absolutePath)
        snapshot.set(toRepoPath(programRoot, absolutePath), {
          hash: createHash("sha256").update(contents).digest("hex"),
          kind: "file",
          source: contents.toString("utf8"),
        })
      } else if (entry.isSymbolicLink()) {
        const target = await readlink(absolutePath)
        snapshot.set(toRepoPath(programRoot, absolutePath), {
          hash: createHash("sha256").update(target).digest("hex"),
          kind: "symlink",
          source: target,
        })
      }
    }
  }
  await visit(programRoot)
  return snapshot
}

function transitionStage(relativePath: string): string | null {
  if (relativePath === "README.md") return "program-document"
  if (/^packet\/(?:research-pass-|track-[1-9]\d*-)/.test(relativePath)) {
    return "research"
  }
  if (
    /^packet\/(?:normalized-pass-|normalized-track-[1-9]\d*\.md$)/.test(
      relativePath,
    )
  ) {
    return "normalize"
  }
  if (relativePath === "packet/converged-decision-packet.md") {
    return "converge"
  }
  if (relativePath === "packet/dependency-graph.md") return "dependency"
  if (relativePath === "packet/plan-split-recommendation.md") return "split"
  if (relativePath === "packet/cross-repo-review.md") return "review"
  if (
    relativePath === "briefs/current.txt" ||
    /^briefs\/planning-brief-[1-9]\d*\.md$/.test(relativePath)
  ) {
    return "brief"
  }
  return null
}

function normalizedMetadata(source: string): string {
  const parsed = parseMarkdownFrontmatter(source)
  return JSON.stringify(
    Object.entries(parsed.metadata)
      .filter(([key]) => key !== "status")
      .toSorted(([left], [right]) => left.localeCompare(right)),
  )
}

function validHistoricalBriefChange(before: string, after: string): boolean {
  if (before.includes(PROGRAM_PLACEHOLDER_MARKER)) return true
  const beforeParsed = parseMarkdownFrontmatter(before)
  const afterParsed = parseMarkdownFrontmatter(after)
  return (
    beforeParsed.metadata.status === "current" &&
    afterParsed.metadata.status === "superseded" &&
    beforeParsed.body === afterParsed.body &&
    normalizedMetadata(before) === normalizedMetadata(after)
  )
}

function inspectTransition(params: {
  after: ProgramSnapshot
  before: ProgramSnapshot
  moved: boolean
}): {
  changedPaths: string[]
  issue: string | null
  transition: string | null
} {
  const changedPaths = [
    ...new Set([...params.before.keys(), ...params.after.keys()]),
  ]
    .filter(
      (filePath) =>
        params.before.get(filePath)?.hash !== params.after.get(filePath)?.hash,
    )
    .toSorted()
  const removed = changedPaths.filter(
    (filePath) => params.before.has(filePath) && !params.after.has(filePath),
  )
  if (removed.length > 0) {
    return {
      changedPaths,
      issue: `Program transitions must not delete durable artifacts: ${removed.join(", ")}.`,
      transition: null,
    }
  }
  if (params.moved) {
    const unexpected = changedPaths.filter(
      (filePath) => filePath !== "README.md",
    )
    if (unexpected.length > 0 || !changedPaths.includes("README.md")) {
      return {
        changedPaths,
        issue:
          "A Program completion move may only change README.md completion metadata and retrospective content.",
        transition: null,
      }
    }
    return { changedPaths, issue: null, transition: "completion" }
  }
  if (changedPaths.length === 0) {
    return {
      changedPaths,
      issue:
        "The agent reported success without making a durable Program transition.",
      transition: null,
    }
  }
  const stages = new Set<string>()
  for (const filePath of changedPaths) {
    const afterEntry = params.after.get(filePath)
    if (afterEntry && afterEntry.kind !== "file") {
      return {
        changedPaths,
        issue: `Program advance created or changed a non-file artifact: ${filePath}.`,
        transition: null,
      }
    }
    const stage = transitionStage(filePath)
    if (!stage) {
      return {
        changedPaths,
        issue: `Program advance changed a path outside the transition contract: ${filePath}.`,
        transition: null,
      }
    }
    stages.add(stage)
    if (
      filePath.startsWith("briefs/planning-brief-") &&
      params.before.has(filePath) &&
      !validHistoricalBriefChange(
        params.before.get(filePath)?.source ?? "",
        params.after.get(filePath)?.source ?? "",
      )
    ) {
      return {
        changedPaths,
        issue: `Historical planning brief changed beyond current-to-superseded metadata: ${filePath}.`,
        transition: null,
      }
    }
  }
  const stageList = [...stages].toSorted()
  const isRefresh =
    stageList.length === 2 &&
    stageList[0] === "brief" &&
    stageList[1] === "program-document"
  if (stageList.length > 1 && !isRefresh) {
    return {
      changedPaths,
      issue: `Program advance crossed multiple durable transitions: ${stageList.join(", ")}.`,
      transition: null,
    }
  }
  if (
    stageList.length === 1 &&
    (stageList[0] === "research" || stageList[0] === "normalize") &&
    changedPaths.length !== 1
  ) {
    return {
      changedPaths,
      issue: `Program ${stageList[0]} transitions must change exactly one pass artifact.`,
      transition: null,
    }
  }
  const newBriefs = changedPaths.filter(
    (filePath) =>
      filePath.startsWith("briefs/planning-brief-") &&
      !params.before.has(filePath),
  )
  if (newBriefs.length > 1) {
    return {
      changedPaths,
      issue: "A Program brief transition may publish only one new brief.",
      transition: null,
    }
  }
  if (newBriefs.length > 0 && !changedPaths.includes("briefs/current.txt")) {
    return {
      changedPaths,
      issue:
        "Publishing a planning brief must update briefs/current.txt in the same transition.",
      transition: null,
    }
  }
  return {
    changedPaths,
    issue: null,
    transition: isRefresh ? "planning-refresh" : (stageList[0] ?? null),
  }
}

async function locateProgramAfterTransition(
  programPath: string,
): Promise<string> {
  if (await exists(programPath)) return programPath
  const candidate = programPath.replace(
    `${path.sep}programs${path.sep}active${path.sep}`,
    `${path.sep}programs${path.sep}completed${path.sep}`,
  )
  if (candidate !== programPath && (await exists(candidate))) return candidate
  return programPath
}

export async function advanceProgram(params: {
  adapter?: AgentAdapter
  config: ProgrammersLoopConfig
  programPath: string
  repoRoot: string
}): Promise<ProgramAdvanceReceipt> {
  const program = await resolveProgram(params)
  const before = await snapshotProgram(program.programPath)
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
  let changedPaths: string[] = []
  let transition: string | null = null
  const finalProgramPath = await locateProgramAfterTransition(
    program.programPath,
  )
  if (result.timedOut || result.exitCode !== 0) {
    status = "failed"
    message = result.timedOut
      ? "Program agent run timed out."
      : `Program agent run failed with exit code ${result.exitCode}.`
  }
  if (!(await exists(finalProgramPath))) {
    status = "failed"
    message =
      "Program agent removed the Program without a valid completion move."
  } else {
    const after = await snapshotProgram(finalProgramPath)
    const inspection = inspectTransition({
      after,
      before,
      moved: finalProgramPath !== program.programPath,
    })
    changedPaths = inspection.changedPaths
    if (status === "completed" && inspection.issue) {
      status = "failed"
      message = inspection.issue
    } else if (status === "completed") {
      transition = inspection.transition
    }
  }
  if (status === "completed") {
    const issues =
      transition === "completion"
        ? await lintProgram({
            programRoot: finalProgramPath,
            repoRoot: params.repoRoot,
          })
        : await lintProgramTransitionReadiness({
            changedPaths,
            programRoot: finalProgramPath,
            repoRoot: params.repoRoot,
          })
    if (issues.length > 0) {
      status = "failed"
      transition = null
      message = `Program transition broke the contract: ${issues[0]?.message}`
    }
  }
  const finalBriefPath = (await exists(finalProgramPath))
    ? path.join(
        finalProgramPath,
        "briefs",
        (
          await readFile(
            path.join(finalProgramPath, "briefs/current.txt"),
            "utf8",
          )
        ).trim(),
      )
    : program.briefPath
  const receipt: ProgramAdvanceReceipt = {
    schemaVersion: 2,
    agentMessage: bounded(
      result.lastMessage,
      params.config.agent.maxOutputBytes,
    ),
    runId,
    programPath: toRepoPath(params.repoRoot, finalProgramPath),
    planningBriefPath: toRepoPath(params.repoRoot, finalBriefPath),
    startedAt,
    completedAt: new Date().toISOString(),
    status,
    exitCode: result.exitCode,
    timedOut: result.timedOut,
    message,
    receiptPath: relativeReceiptPath.split(path.sep).join("/"),
    sessionId: result.sessionId ?? null,
    stderr: bounded(result.stderr, params.config.agent.maxOutputBytes),
    transition,
    changedPaths,
  }
  await writeRuntimeJson({
    relativePath: relativeReceiptPath,
    repoRoot: params.repoRoot,
    value: receipt,
  })
  return receipt
}
