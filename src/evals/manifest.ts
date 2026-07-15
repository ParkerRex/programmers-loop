import { createHash } from "node:crypto"
import path from "node:path"

import type { AgentAuthMode } from "../agents/types.js"
import type { ProgrammersLoopConfig } from "../config.js"
import { runProcess } from "../process.js"
import { readRuntimeJson, writeRuntimeJson } from "../runtime/store.js"
import { curatedSkillsHash as computeCuratedSkillsHash } from "../workflows/curated-skills.js"
import { workspaceFingerprint } from "./task-package.js"

/**
 * Durable evaluation run model for the minimal episode runner (workstream E4).
 *
 * An {@link Episode} is one immutable cell of the run matrix: one task, one
 * harness system, one repetition, plus a deterministic seed. A
 * {@link RunManifest} is the ordered episode list plus the frozen configuration
 * inputs (adapter id, model, reasoning-effort level, prompt-directory hash, and
 * this repository's git SHA) that make a run reproducible and comparable.
 *
 * Everything an episode needs to be planned and resumed is a pure function of
 * its inputs: {@link buildManifest} never reads a clock or a random source, so
 * two calls with identical inputs are byte-identical. Wall-clock timestamps
 * live only on the per-episode {@link EpisodeRecord}s that the runner writes as
 * it executes.
 */
export const EVAL_MANIFEST_SCHEMA_VERSION = 1

/**
 * Version of the cross-arm budget semantics enforced by the harnesses. Bumped
 * when the meaning of `max_wall_ms` / `max_turns` / `max_phases` changes so
 * runs enforced under different semantics are not silently compared.
 *
 * Semantics v1 (issue #7, smoke-report defect E2): `max_wall_ms` is a
 * per-EPISODE total in BOTH arms (the direct single call is bounded by it; the
 * loop spine threads the running remainder to each phase and terminates
 * `timeout` when the episode budget is spent), and `max_turns` is a
 * per-agent-CALL cap in BOTH arms (the single direct call; each loop phase
 * call). Loop phases are additionally bounded by `max_phases`; exhausting that
 * ceiling terminates `budget_exhausted`.
 */
export const BUDGET_SEMANTICS_VERSION = 1

/** The two harness conditions compared by the evaluation. */
export const EVAL_SYSTEMS = ["direct", "loop"] as const

export type EvalSystem = (typeof EVAL_SYSTEMS)[number]

/**
 * The complete, closed set of terminal episode states. `verified_success` and
 * `verified_failure` come from deterministic grading; the remaining five are
 * pre-grading terminals produced by the harness or the runner itself.
 */
export const EPISODE_TERMINAL_STATES = [
  "verified_success",
  "verified_failure",
  "timeout",
  "budget_exhausted",
  "owner_blocked",
  "harness_failure",
  "infrastructure_failure",
] as const

export type EpisodeTerminalState = (typeof EPISODE_TERMINAL_STATES)[number]

export type Episode = {
  episodeId: string
  taskId: string
  system: EvalSystem
  rep: number
  seed: number
}

/**
 * Frozen configuration inputs hashed into {@link RunManifest.configHash}. A
 * change to any field means episodes are no longer comparable to a prior run.
 */
export type RunConfigInputs = {
  adapterId: string
  model: string | null
  /**
   * Reasoning-effort level pinned for the run (Decision D3), or null when left
   * on the CLI's ambient default. Part of model identity, so it is hashed into
   * {@link RunManifest.configHash}: two runs at different efforts are not
   * comparable.
   */
  reasoningEffort: string | null
  /** Stable fingerprint of this repository's `prompts/` tree. */
  promptDirHash: string
  /**
   * Stable fingerprint of the curated skill pack (`skills/curated/`) — the Loop
   * treatment surface `promptDirHash` does not cover. Decision D15 makes curated
   * skills part of the treatment as shipped, versioned by hash; two runs whose
   * packs differ are not comparable, so it is hashed into {@link
   * RunManifest.configHash} exactly like the prompt-directory hash.
   */
  curatedSkillsHash: string
  /** This repository's HEAD commit, or null when git is unavailable. */
  repoGitSha: string | null
}

export type RunManifest = {
  schemaVersion: typeof EVAL_MANIFEST_SCHEMA_VERSION
  runId: string
  /** Repository-relative path of the task-package directory. */
  tasksDir: string
  systems: EvalSystem[]
  reps: number
  baseSeed: number
  configInputs: RunConfigInputs
  configHash: string
  /**
   * Budget-semantics version enforced across both arms ({@link
   * BUDGET_SEMANTICS_VERSION}). Recorded but deliberately NOT hashed into
   * `configHash`: it is identical for both arms within a run, so it does not
   * affect cross-arm comparability, only cross-run interpretation.
   */
  budgetSemanticsVersion: number
  /**
   * Adapter binary version resolved once (via `adapter.doctor()`) when the run
   * executes, pinning the baseline/treatment CLI identity (issue #7). Null on a
   * planned-but-not-yet-executed manifest, since planning does no spend.
   */
  adapterVersion: string | null
  episodes: Episode[]
}

/**
 * Per-phase evidence recorded by a harness.
 *
 * `receiptPath` (and the direct arm's agent-event path) is written by the
 * underlying workflow/adapter relative to the run's cwd, which is the SANDBOX,
 * not the repository root. It is therefore resolvable only against
 * {@link EpisodeRecord.sandboxPath} and only when the sandbox was retained
 * (`--retain`); in clean mode the sandbox is removed and these paths dangle by
 * design. This differs from `sandboxPath` and `taskPackageDir`, which are
 * repository-root-relative.
 */
export type HarnessPhaseRecord = {
  phase: string
  receiptPath: string | null
  status: string
}

/** Component grading result mirroring {@link TaskGraderSummary}. */
export type EpisodeGrade = {
  functional: boolean
  regression: boolean
  scope: boolean
  notes: string[]
  /** True when both deterministic grader runs agreed. */
  agreement: boolean
}

/**
 * Per-episode usage and cost rollup. Token and call fields are summed from the
 * agent's {@link AgentUsage}; `costUsd` is the provider-advisory figure and
 * `repricedCostUsd` is the list-price recomputation, null when the model has no
 * pinned price row.
 */
export type EpisodeUsage = {
  inputTokens: number | null
  outputTokens: number | null
  cachedInputTokens: number | null
  reasoningTokens: number | null
  modelCalls: number | null
  toolCalls: number | null
  costUsd: number | null
  repricedCostUsd: number | null
  authMode: AgentAuthMode | null
}

/**
 * Durable record of the one `setup_command` run during sandbox preparation.
 * Setup runs BEFORE the baseline commit and before any agent: its outputs
 * (installed dependencies, generated fixtures) belong to the task's starting
 * state, never to the evaluated agent's diff. `networkCarveOut` is always
 * true and recorded distinctly because setup is exempt from the task's
 * declared `tool_policy.network: "deny"` — installs may reach a package
 * registry — so network-deny audits can attribute any setup-phase traffic to
 * the runner's carve-out rather than to an agent phase.
 */
export type EpisodeSetupRecord = {
  command: string
  exitCode: number
  timedOut: boolean
  wallMs: number
  networkCarveOut: true
}

/**
 * The budget caps enforced for an episode and the cross-arm semantics under
 * which they were applied ({@link BUDGET_SEMANTICS_VERSION}, issue #7). Recorded
 * on every graded/harness episode so a scored comparison can prove both arms
 * were bounded identically: `max_wall_ms` per-episode-total, `max_turns`
 * per-agent-call, and (loop only) `max_phases` phases.
 */
export type EpisodeBudgetRecord = {
  semanticsVersion: number
  /** Per-episode total wall budget; exceeding it terminates `timeout`. */
  maxWallMs: number
  wallScope: "per-episode-total"
  /** Per-agent-call turn cap (the single direct call; each loop phase call). */
  maxTurns: number
  turnsScope: "per-agent-call"
  /** Loop phase ceiling; exceeding it terminates `budget_exhausted`. */
  maxPhases: number
}

/**
 * What the runner materialized into the sandbox as the Loop treatment surface
 * (issue #8: "which files are injected, and how" — specified AND recorded). The
 * direct arm receives none of this: `loopCliShimPresent` is false and
 * `injectedPaths` is empty, which is itself the recorded fact that the baseline
 * carries no Loop treatment.
 */
export type EpisodeTreatmentRecord = {
  /**
   * True only for the loop arm: a `programmers-loop` executable shim is placed
   * on the episode's PATH so the write/grill prompts' focused-linter
   * instruction is satisfiable inside the sandbox (grill exit-127 finding).
   */
  loopCliShimPresent: boolean
  /** Sandbox-relative shim path, or null when absent (direct arm). */
  loopCliShimPath: string | null
  /** Version reported by the CLI the shim targets, or null when absent. */
  loopCliTargetVersion: string | null
  /** Sandbox-relative treatment files injected by the runner (sorted); [] for direct. */
  injectedPaths: string[]
}

/**
 * The isolation posture an episode actually ran under, recorded per episode so
 * a scored run is auditable (issue #4; ADR option i). Written honestly: the
 * `network.enforcement` string states what the kernel actually enforced versus
 * what is only declared, `imageDigest` is the local image CONFIG id (not a
 * registry digest), and `envForwarded` lists env-var NAMES only — a value is
 * never placed on argv or in this record. Host mode records `mode: "host"` with
 * the container fields null/empty, which is itself the audit fact that the
 * episode ran under the looser macOS sandbox (acceptable for unscored smoke
 * only, per D11).
 */
export type EpisodeSandboxRecord = {
  mode: "host" | "container"
  /** Pinned image tag (container mode), else null. */
  image: string | null
  /** Local image config id `sha256:…` (container mode), else null. NOT a registry digest. */
  imageDigest: string | null
  network: {
    policy: "none" | "allowlist"
    /** Honest description of what is machine-enforced vs. only declared. */
    enforcement: string
    allowlist: string[]
    /** False until a live model call has actually been driven through this policy. */
    liveValidated: boolean
  } | null
  /** The identity bind-mount path (container mode), else null. */
  workspaceMount: string | null
  /** Env-var NAMES forwarded into the container (never values); [] in host mode. */
  envForwarded: string[]
}

export type EpisodeRecord = {
  schemaVersion: typeof EVAL_MANIFEST_SCHEMA_VERSION
  runId: string
  episode: Episode
  terminalState: EpisodeTerminalState
  startedAt: string
  completedAt: string
  /** Machine-enforced isolation posture the episode ran under, or null before a task loads. */
  sandbox: EpisodeSandboxRecord | null
  /** Fingerprint of the pristine materialized workspace, before any agent ran. */
  workspaceFingerprint: string | null
  /** Repository-relative task-package directory, for self-contained regrading. */
  taskPackageDir: string
  /** Repository-relative sandbox path when retained, else null. */
  sandboxPath: string | null
  /** Evidence of the setup_command run, or null when the task declares none. */
  setup: EpisodeSetupRecord | null
  /** Enforced budget caps and their cross-arm semantics, or null before a task loads. */
  budget: EpisodeBudgetRecord | null
  /** Loop treatment materialization recorded for audit, or null before a task loads. */
  treatment: EpisodeTreatmentRecord | null
  /**
   * Sandbox-relative paths of any `AGENTS.md` the materialized workspace
   * contained (sorted), or [] for none. Documents the baseline/treatment
   * workspace's ambient agent instructions (issue #7).
   */
  agentsMdPaths: string[]
  harness: {
    system: EvalSystem
    disposition: string
    phases: HarnessPhaseRecord[]
    notes: string[]
  }
  grade: EpisodeGrade | null
  usage: EpisodeUsage | null
}

function stableHash(parts: readonly string[]): string {
  const hash = createHash("sha256")
  for (const part of parts) hash.update(`${part} `)
  return hash.digest("hex")
}

/** Deterministic, filesystem-safe episode id, unique within a run. */
export function computeEpisodeId(
  taskId: string,
  system: EvalSystem,
  rep: number,
): string {
  return `${taskId}-${system}-r${rep}`
}

/**
 * Build the ordered episode list and configuration hash. Pure: episodes are
 * generated in a fixed order (task, then system in the given order, then
 * repetition 1..reps), and every seed is `baseSeed + index`.
 */
export function buildManifest(params: {
  runId: string
  tasksDir: string
  taskIds: string[]
  systems: EvalSystem[]
  reps: number
  baseSeed: number
  configInputs: RunConfigInputs
}): RunManifest {
  const episodes: Episode[] = []
  let index = 0
  for (const taskId of params.taskIds) {
    for (const system of params.systems) {
      for (let rep = 1; rep <= params.reps; rep += 1) {
        episodes.push({
          episodeId: computeEpisodeId(taskId, system, rep),
          rep,
          seed: params.baseSeed + index,
          system,
          taskId,
        })
        index += 1
      }
    }
  }
  const configHash = stableHash([
    params.configInputs.adapterId,
    params.configInputs.model ?? " null",
    params.configInputs.reasoningEffort ?? " null",
    params.configInputs.promptDirHash,
    params.configInputs.curatedSkillsHash,
    params.configInputs.repoGitSha ?? " null",
  ]).slice(0, 32)
  return {
    adapterVersion: null,
    baseSeed: params.baseSeed,
    budgetSemanticsVersion: BUDGET_SEMANTICS_VERSION,
    configHash,
    configInputs: params.configInputs,
    episodes,
    reps: params.reps,
    runId: params.runId,
    schemaVersion: EVAL_MANIFEST_SCHEMA_VERSION,
    systems: params.systems,
    tasksDir: params.tasksDir,
  }
}

/** HEAD commit of `repoRoot`, or null when git is unavailable. */
export async function gitHeadSha(repoRoot: string): Promise<string | null> {
  try {
    const result = await runProcess({
      args: ["-C", repoRoot, "rev-parse", "HEAD"],
      command: "git",
      timeoutMs: 10_000,
      cwd: repoRoot,
    })
    if (result.exitCode !== 0) return null
    const sha = result.stdout.trim()
    return sha === "" ? null : sha
  } catch {
    return null
  }
}

/**
 * Resolve the IO-bound configuration inputs: the adapter id and model come from
 * the caller, the prompt-directory hash from this repository's `prompts/`, and
 * the git SHA from `repoRoot` (degrading to null rather than throwing).
 */
export async function resolveConfigInputs(params: {
  adapterId: string
  config: ProgrammersLoopConfig
  repoRoot: string
}): Promise<RunConfigInputs> {
  const packageRoot = path.resolve(import.meta.dirname, "..", "..")
  const promptDirHash = await workspaceFingerprint(
    path.join(packageRoot, "prompts"),
  )
  return {
    adapterId: params.adapterId,
    model: params.config.agent.model,
    reasoningEffort: params.config.agent.reasoningEffort ?? null,
    promptDirHash,
    // Defaults to the package's `skills/curated/`, mirroring promptDirHash over
    // `prompts/`, so the frozen inputs fingerprint the whole treatment surface.
    curatedSkillsHash: await computeCuratedSkillsHash(),
    repoGitSha: await gitHeadSha(params.repoRoot),
  }
}

function runDir(runId: string): string {
  return path.posix.join(".runtime", "evals", "runs", runId)
}

export function manifestRelativePath(runId: string): string {
  return path.posix.join(runDir(runId), "manifest.json")
}

export function episodeRelativePath(runId: string, episodeId: string): string {
  return path.posix.join(runDir(runId), "episodes", `${episodeId}.json`)
}

/** Repository-relative sandbox directory for one episode of one run. */
export function sandboxRelativePath(runId: string, episodeId: string): string {
  return path.posix.join(".runtime", "evals", "sandboxes", runId, episodeId)
}

export async function writeManifest(params: {
  manifest: RunManifest
  repoRoot: string
}): Promise<string> {
  return writeRuntimeJson({
    relativePath: manifestRelativePath(params.manifest.runId),
    repoRoot: params.repoRoot,
    value: params.manifest,
  })
}

export async function readManifest(params: {
  runId: string
  repoRoot: string
}): Promise<RunManifest | null> {
  return readRuntimeJson<RunManifest>({
    relativePath: manifestRelativePath(params.runId),
    repoRoot: params.repoRoot,
  })
}

export async function writeEpisodeRecord(params: {
  record: EpisodeRecord
  repoRoot: string
}): Promise<string> {
  return writeRuntimeJson({
    relativePath: episodeRelativePath(
      params.record.runId,
      params.record.episode.episodeId,
    ),
    repoRoot: params.repoRoot,
    value: params.record,
  })
}

export async function readEpisodeRecord(params: {
  runId: string
  episodeId: string
  repoRoot: string
}): Promise<EpisodeRecord | null> {
  return readRuntimeJson<EpisodeRecord>({
    relativePath: episodeRelativePath(params.runId, params.episodeId),
    repoRoot: params.repoRoot,
  })
}
