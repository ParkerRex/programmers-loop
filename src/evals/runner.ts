import { readdir, readFile, rm } from "node:fs/promises"
import path from "node:path"

import { ClaudeAdapter } from "../agents/claude.js"
import { CodexAdapter } from "../agents/codex.js"
import { estimateCostUsd, MODEL_LIST_PRICES } from "../agents/index.js"
import type { AgentAdapter, AgentUsage } from "../agents/types.js"
import type { ProgrammersLoopConfig } from "../config.js"
import { toRepoPath, UserInputError } from "../repo-path.js"
import { gradeEpisode, type GradeOutcome } from "./grade.js"
import {
  prepareSandbox,
  runDirectHarness,
  runLoopHarness,
  SetupCommandError,
  type HarnessOutcome,
} from "./harnesses.js"
import {
  buildManifest,
  type Episode,
  type EpisodeRecord,
  type EpisodeTerminalState,
  type EpisodeUsage,
  type EvalSystem,
  readEpisodeRecord,
  readManifest,
  type RunManifest,
  sandboxRelativePath,
  writeEpisodeRecord,
  writeManifest,
  resolveConfigInputs,
} from "./manifest.js"
import { loadTaskPackage, type TaskPackage } from "./task-package.js"

export type EvalPlanRequest = {
  adapterId?: string
  config: ProgrammersLoopConfig
  repoRoot: string
  runId: string
  tasksDir: string
  systems: EvalSystem[]
  reps: number
  baseSeed?: number
}

export type EvalRunRequest = EvalPlanRequest & {
  adapter?: AgentAdapter
  retainSandboxes?: boolean
}

export type EvalRunSummary = {
  runId: string
  manifestPath: string
  executed: number
  skipped: number
  episodes: {
    episodeId: string
    system: EvalSystem
    taskId: string
    terminalState: EpisodeTerminalState
    recordPath: string
  }[]
}

function nowIso(): string {
  return new Date().toISOString()
}

/** Absolute task-package root plus the sorted ids of the packages it contains. */
async function discoverTasks(tasksAbsDir: string): Promise<{ ids: string[] }> {
  let entries
  try {
    entries = await readdir(tasksAbsDir, { withFileTypes: true })
  } catch {
    throw new UserInputError(`Task directory not found: ${tasksAbsDir}`)
  }
  const ids: string[] = []
  for (const entry of entries
    .filter((e) => e.isDirectory())
    .toSorted((l, r) => (l.name < r.name ? -1 : 1))) {
    const loaded = await loadTaskPackage(path.join(tasksAbsDir, entry.name))
    if (loaded.pkg === null) {
      throw new UserInputError(
        `Task package ${entry.name} is invalid: ${loaded.issues[0] ?? "unknown issue"}`,
      )
    }
    ids.push(loaded.pkg.id)
  }
  if (ids.length === 0) {
    throw new UserInputError(`No task packages found in ${tasksAbsDir}`)
  }
  return { ids }
}

function resolveTasksDir(
  repoRoot: string,
  tasksDir: string,
): { abs: string; relative: string } {
  const abs = path.isAbsolute(tasksDir)
    ? tasksDir
    : path.resolve(repoRoot, tasksDir)
  return { abs, relative: toRepoPath(repoRoot, abs) }
}

/**
 * Deterministically compute the run manifest for the given matrix. No spend:
 * task packages are loaded only to enumerate ids and the configuration inputs
 * are hashed. Pure with respect to the same repository state.
 */
export async function planEvalRun(
  request: EvalPlanRequest,
): Promise<RunManifest> {
  const tasks = resolveTasksDir(request.repoRoot, request.tasksDir)
  const { ids } = await discoverTasks(tasks.abs)
  const configInputs = await resolveConfigInputs({
    adapterId: request.adapterId ?? request.config.agent.adapter,
    config: request.config,
    repoRoot: request.repoRoot,
  })
  return buildManifest({
    baseSeed: request.baseSeed ?? 1,
    configInputs,
    reps: request.reps,
    runId: request.runId,
    systems: request.systems,
    taskIds: ids,
    tasksDir: tasks.relative,
  })
}

function rollupUsage(
  usage: AgentUsage | null,
  model: string | null,
): EpisodeUsage | null {
  if (usage === null) return null
  let repricedCostUsd: number | null = null
  if (model !== null && model in MODEL_LIST_PRICES.models) {
    repricedCostUsd = estimateCostUsd(usage, MODEL_LIST_PRICES.models[model])
  }
  return {
    authMode: usage.authMode,
    cachedInputTokens: usage.cachedInputTokens,
    costUsd: usage.costUsd,
    inputTokens: usage.inputTokens,
    modelCalls: usage.modelCalls,
    outputTokens: usage.outputTokens,
    reasoningTokens: usage.reasoningTokens,
    repricedCostUsd,
    toolCalls: usage.toolCalls,
  }
}

/**
 * Construct the live agent adapter for a `--execute` run from configuration.
 * `agent.adapter` selects the CLI (`codex` drives the native Codex CLI for the
 * 0.1 same-family study; `claude` drives Claude Code for smoke and future
 * arms) and `agent.command` is the executable. The subject model itself is
 * threaded per run from `agent.model` by the harnesses, not fixed here.
 */
export function liveAdapter(config: ProgrammersLoopConfig): AgentAdapter {
  return config.agent.adapter === "codex"
    ? new CodexAdapter(config.agent.command)
    : new ClaudeAdapter(config.agent.command)
}

async function runOneEpisode(params: {
  adapter: AgentAdapter
  config: ProgrammersLoopConfig
  episode: Episode
  manifest: RunManifest
  repoRoot: string
  retainSandboxes: boolean
  tasksAbsDir: string
}): Promise<EpisodeRecord> {
  const { episode, manifest, repoRoot } = params
  const startedAt = nowIso()
  const sandboxRel = sandboxRelativePath(manifest.runId, episode.episodeId)
  const sandboxAbs = path.resolve(repoRoot, sandboxRel)
  const taskPackageRel = path.posix.join(manifest.tasksDir, episode.taskId)

  const base = {
    completedAt: startedAt,
    episode,
    runId: manifest.runId,
    sandboxPath: null,
    schemaVersion: 1 as const,
    setup: null,
    startedAt,
    taskPackageDir: taskPackageRel,
    workspaceFingerprint: null,
  }

  const loaded = await loadTaskPackage(
    path.join(params.tasksAbsDir, episode.taskId),
  )
  if (loaded.pkg === null) {
    return {
      ...base,
      completedAt: nowIso(),
      grade: null,
      harness: {
        disposition: "infrastructure_failure",
        notes: [`task package invalid: ${loaded.issues[0] ?? "unknown"}`],
        phases: [],
        system: episode.system,
      },
      terminalState: "infrastructure_failure",
      usage: null,
    }
  }
  const pkg: TaskPackage = loaded.pkg

  let fingerprint: string | null = null
  let setup: EpisodeRecord["setup"] = null
  let harness: HarnessOutcome
  try {
    const prepared = await prepareSandbox({
      config: params.config,
      pkg,
      sandboxDir: sandboxAbs,
      system: episode.system,
    })
    fingerprint = prepared.fingerprint
    setup = prepared.setup
    if (episode.system === "direct") {
      harness = await runDirectHarness({
        adapter: params.adapter,
        config: params.config,
        pkg,
        sandboxDir: sandboxAbs,
      })
    } else {
      if (prepared.planPath === null) {
        throw new Error("Loop treatment did not scaffold an ExecPlan")
      }
      harness = await runLoopHarness({
        adapter: params.adapter,
        config: params.config,
        pkg,
        planPath: prepared.planPath,
        sandboxDir: sandboxAbs,
      })
    }
  } catch (error) {
    // Sandbox setup or an unexpected harness fault is a runner/infrastructure
    // problem, never a scored model result. A failed setup_command carries its
    // evidence on the error; persist it so the record still shows what ran.
    if (error instanceof SetupCommandError) setup = error.setup
    const record: EpisodeRecord = {
      ...base,
      completedAt: nowIso(),
      grade: null,
      harness: {
        disposition: "infrastructure_failure",
        notes: [
          `episode setup failed: ${error instanceof Error ? error.message : String(error)}`,
        ],
        phases: [],
        system: episode.system,
      },
      setup,
      terminalState: "infrastructure_failure",
      usage: null,
      workspaceFingerprint: fingerprint,
    }
    if (!params.retainSandboxes) {
      await rm(sandboxAbs, { force: true, recursive: true })
    }
    return record
  }

  let terminalState: EpisodeTerminalState
  let grade: EpisodeRecord["grade"] = null
  const auditNotes: string[] = []
  if (harness.disposition === "grade") {
    const outcome: GradeOutcome = await gradeEpisode({
      maxOutputBytes: params.config.agent.maxOutputBytes,
      pkg,
      sandboxDir: sandboxAbs,
    })
    terminalState = outcome.terminalState
    grade = outcome.grade
    auditNotes.push(...outcome.auditNotes)
  } else {
    terminalState = harness.disposition
  }

  const sandboxPath = params.retainSandboxes ? sandboxRel : null
  if (!params.retainSandboxes) {
    await rm(sandboxAbs, { force: true, recursive: true })
  }

  return {
    ...base,
    completedAt: nowIso(),
    grade,
    harness: {
      disposition: harness.disposition,
      notes: [...harness.notes, ...auditNotes],
      phases: harness.phases,
      system: episode.system,
    },
    sandboxPath,
    setup,
    terminalState,
    usage: rollupUsage(harness.usage, params.config.agent.model),
    workspaceFingerprint: fingerprint,
  }
}

/**
 * Execute (or resume) a run. Episodes that already have a durable terminal
 * record under the same runId are skipped without any adapter call, so
 * re-running a runId is idempotent and only fills the gaps.
 */
export async function runEvalRun(
  request: EvalRunRequest,
): Promise<EvalRunSummary> {
  const existing = await readManifest({
    repoRoot: request.repoRoot,
    runId: request.runId,
  })
  const manifest = existing ?? (await planEvalRun(request))
  const manifestPath = await writeManifest({
    manifest,
    repoRoot: request.repoRoot,
  })
  const tasks = resolveTasksDir(request.repoRoot, manifest.tasksDir)
  const adapter = request.adapter ?? liveAdapter(request.config)

  const summary: EvalRunSummary = {
    episodes: [],
    executed: 0,
    manifestPath,
    runId: manifest.runId,
    skipped: 0,
  }

  for (const episode of manifest.episodes) {
    const prior = await readEpisodeRecord({
      episodeId: episode.episodeId,
      repoRoot: request.repoRoot,
      runId: manifest.runId,
    })
    if (prior !== null) {
      summary.skipped += 1
      summary.episodes.push({
        episodeId: episode.episodeId,
        recordPath: "",
        system: episode.system,
        taskId: episode.taskId,
        terminalState: prior.terminalState,
      })
      continue
    }
    const record = await runOneEpisode({
      adapter,
      config: request.config,
      episode,
      manifest,
      repoRoot: request.repoRoot,
      retainSandboxes: request.retainSandboxes ?? false,
      tasksAbsDir: tasks.abs,
    })
    const recordPath = await writeEpisodeRecord({
      record,
      repoRoot: request.repoRoot,
    })
    summary.executed += 1
    summary.episodes.push({
      episodeId: episode.episodeId,
      recordPath,
      system: episode.system,
      taskId: episode.taskId,
      terminalState: record.terminalState,
    })
  }
  return summary
}

export type RegradeResult = {
  episodeId: string
  previousState: EpisodeTerminalState
  outcome: GradeOutcome
}

/**
 * Re-run deterministic grading against a retained sandbox for one episode
 * record. Fails clearly when the sandbox was not retained.
 */
export async function regradeEpisode(params: {
  config: ProgrammersLoopConfig
  episodePath: string
  repoRoot: string
}): Promise<RegradeResult> {
  const recordAbs = path.isAbsolute(params.episodePath)
    ? params.episodePath
    : path.resolve(params.repoRoot, params.episodePath)
  let record: EpisodeRecord
  try {
    record = JSON.parse(await readFile(recordAbs, "utf8")) as EpisodeRecord
  } catch {
    throw new UserInputError(`Could not read episode record: ${recordAbs}`)
  }
  if (record.sandboxPath === null) {
    throw new UserInputError(
      `Episode ${record.episode.episodeId} kept no sandbox; re-run with sandbox retention to regrade.`,
    )
  }
  const sandboxAbs = path.resolve(params.repoRoot, record.sandboxPath)
  const loaded = await loadTaskPackage(
    path.resolve(params.repoRoot, record.taskPackageDir),
  )
  if (loaded.pkg === null) {
    throw new UserInputError(
      `Task package invalid for regrade: ${loaded.issues[0] ?? "unknown"}`,
    )
  }
  const outcome = await gradeEpisode({
    maxOutputBytes: params.config.agent.maxOutputBytes,
    pkg: loaded.pkg,
    sandboxDir: sandboxAbs,
  })
  return {
    episodeId: record.episode.episodeId,
    outcome,
    previousState: record.terminalState,
  }
}
