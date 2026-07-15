import { readFile } from "node:fs/promises"
import path from "node:path"

import type { EpisodeRecord } from "./manifest.js"

/**
 * Tool-call-sequence diversity for an evaluation run.
 *
 * The "Better Harnesses, Smaller Models" method (arXiv 2607.08938) diagnoses
 * failures from FULL raw trajectories and adapts the harness statically. A
 * static adaptation that helps one trajectory generalizes to its siblings only
 * when those trajectories are SIMILAR: the paper reports a strong negative
 * correlation (rho = -0.96) between a task's tool-call-sequence diversity and
 * the success of a single static harness edit applied across its episodes. High
 * diversity therefore predicts that one curated guidance block is unlikely to
 * generalize — this statistic contextualizes every proposal an adapt report
 * makes, which is why {@link buildDiversityReport} runs on every report.
 *
 * Diversity here is the mean pairwise NORMALIZED Levenshtein distance between
 * the ordered tool-name sequences of episodes: 0 when every episode drove the
 * same tools in the same order, approaching 1 as the sequences share nothing.
 * Episodes whose transcript could not be read (a clean-mode run kept no
 * sandbox) carry no sequence and are excluded from the pairwise set entirely
 * rather than folded in as an empty sequence, which would score 1.0 against
 * everything and silently inflate the statistic.
 */

/** Correlation the paper reports between per-task diversity and static-edit success. */
export const DIVERSITY_SUCCESS_RHO = -0.96

/** Codex event `item.type` values that represent a tool/command action. */
const CODEX_TOOL_ITEM_TYPES = new Set([
  "command_execution",
  "file_change",
  "function_call",
  "mcp_tool_call",
  "patch_apply",
  "web_search",
])

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

/**
 * Extract the ordered tool/command names an agent drove from one raw event
 * transcript. The two supported streams are self-describing by their per-line
 * `type` field, so no adapter hint is needed:
 *
 * - Claude Code: `assistant` events carry a `message.content[]` array whose
 *   `tool_use` items name each tool call.
 * - Codex: `item.completed` events carry an `item.type` naming the action; the
 *   action types (not narration like `agent_message`/`reasoning`) are the tools.
 *
 * Unparseable or unrecognized lines are skipped, so a truncated or
 * partially-written transcript still yields the calls it did record.
 */
export function extractToolNames(jsonlText: string): string[] {
  const names: string[] = []
  for (const line of jsonlText.split("\n")) {
    const trimmed = line.trim()
    if (trimmed === "") continue
    let event: unknown
    try {
      event = JSON.parse(trimmed)
    } catch {
      continue
    }
    if (!isRecord(event)) continue
    if (event.type === "assistant" && isRecord(event.message)) {
      const content = event.message.content
      if (Array.isArray(content)) {
        for (const item of content) {
          if (
            isRecord(item) &&
            item.type === "tool_use" &&
            typeof item.name === "string"
          ) {
            names.push(item.name)
          }
        }
      }
      continue
    }
    if (event.type === "item.completed" && isRecord(event.item)) {
      const kind = event.item.type
      if (typeof kind === "string" && CODEX_TOOL_ITEM_TYPES.has(kind)) {
        names.push(kind)
      }
    }
  }
  return names
}

/**
 * Normalized Levenshtein distance between two token sequences, in [0, 1]:
 * edit distance divided by the longer length. Two empty sequences are
 * identical (0); exactly one empty is maximally different (1). Computed with a
 * rolling two-row DP so the cost is O(len_a * len_b) time and O(len_b) space.
 */
export function normalizedLevenshtein(
  a: readonly string[],
  b: readonly string[],
): number {
  const la = a.length
  const lb = b.length
  if (la === 0 && lb === 0) return 0
  if (la === 0 || lb === 0) return 1
  let prev: number[] = []
  for (let j = 0; j <= lb; j += 1) prev[j] = j
  for (let i = 1; i <= la; i += 1) {
    const curr: number[] = [i]
    for (let j = 1; j <= lb; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      const deletion = (prev[j] ?? 0) + 1
      const insertion = (curr[j - 1] ?? 0) + 1
      const substitution = (prev[j - 1] ?? 0) + cost
      curr[j] = Math.min(deletion, insertion, substitution)
    }
    prev = curr
  }
  return (prev[lb] ?? 0) / Math.max(la, lb)
}

/** One episode's extracted tool-call sequence, keyed for grouping. */
export type EpisodeToolSequence = {
  episodeId: string
  taskId: string
  system: string
  tools: string[]
}

/**
 * A diversity input row: like {@link EpisodeToolSequence} but `tools` may be
 * null when the episode's transcript could not be read. Null rows are reported
 * as excluded rather than compared.
 */
export type EpisodeToolSequenceInput = Omit<EpisodeToolSequence, "tools"> & {
  tools: string[] | null
}

/** Pairwise-distance summary over a set of comparable episodes. */
export type PairwiseDiversity = {
  /** Episodes with a usable (readable) transcript that entered the pairwise set. */
  episodeCount: number
  /** Number of unordered episode pairs compared. */
  pairCount: number
  /** Mean pairwise normalized distance, or null when fewer than two episodes. */
  meanDistance: number | null
  /** Smallest pairwise distance, or null when fewer than two episodes. */
  minDistance: number | null
  /** Largest pairwise distance, or null when fewer than two episodes. */
  maxDistance: number | null
}

export type TaskDiversity = PairwiseDiversity & { taskId: string }

export type DiversityReport = {
  /** Diversity across every comparable episode in the corpus. */
  corpus: PairwiseDiversity
  /** Per-task diversity, sorted by task id. */
  perTask: TaskDiversity[]
  /** Episode ids that entered the computation, sorted. */
  includedEpisodes: string[]
  /** Episode ids skipped for lack of a readable transcript, sorted. */
  excludedEpisodes: string[]
}

function summarize(sequences: readonly string[][]): PairwiseDiversity {
  if (sequences.length < 2) {
    return {
      episodeCount: sequences.length,
      maxDistance: null,
      meanDistance: null,
      minDistance: null,
      pairCount: 0,
    }
  }
  let total = 0
  let pairs = 0
  let min = Number.POSITIVE_INFINITY
  let max = Number.NEGATIVE_INFINITY
  for (let i = 0; i < sequences.length; i += 1) {
    for (let j = i + 1; j < sequences.length; j += 1) {
      const distance = normalizedLevenshtein(
        sequences[i] ?? [],
        sequences[j] ?? [],
      )
      total += distance
      pairs += 1
      if (distance < min) min = distance
      if (distance > max) max = distance
    }
  }
  return {
    episodeCount: sequences.length,
    maxDistance: max,
    meanDistance: total / pairs,
    minDistance: min,
    pairCount: pairs,
  }
}

/**
 * Compute corpus-wide and per-task tool-sequence diversity. Only episodes with
 * a non-null tool sequence participate; episodes given `tools: null` (no
 * readable transcript) are reported as excluded. Iteration is over sorted task
 * ids and sorted episode ids, so the report is deterministic.
 */
export function buildDiversityReport(
  sequences: readonly EpisodeToolSequenceInput[],
): DiversityReport {
  const included = sequences
    .filter((entry): entry is EpisodeToolSequence => Array.isArray(entry.tools))
    .toSorted((left, right) => (left.episodeId < right.episodeId ? -1 : 1))
  const excluded = sequences
    .filter((entry) => !Array.isArray(entry.tools))
    .map((entry) => entry.episodeId)
    .toSorted()

  const byTask = new Map<string, string[][]>()
  for (const entry of included) {
    const bucket = byTask.get(entry.taskId) ?? []
    bucket.push(entry.tools)
    byTask.set(entry.taskId, bucket)
  }
  const perTask: TaskDiversity[] = [...byTask.keys()]
    .toSorted()
    .map((taskId) => ({
      taskId,
      ...summarize(byTask.get(taskId) ?? []),
    }))

  return {
    corpus: summarize(included.map((entry) => entry.tools)),
    excludedEpisodes: excluded,
    includedEpisodes: included.map((entry) => entry.episodeId),
    perTask,
  }
}

/**
 * Resolve and read every event transcript an episode produced, returning the
 * concatenated ordered tool-call sequence across its harness phases. Transcript
 * `receiptPath`s are sandbox-relative and only resolvable when the sandbox was
 * retained ({@link EpisodeRecord.sandboxPath} non-null); a clean-mode episode,
 * or one whose transcript file is missing, yields `null` so the caller can
 * exclude it from diversity honestly rather than treat it as an empty run.
 */
export async function readEpisodeToolSequence(params: {
  record: EpisodeRecord
  repoRoot: string
}): Promise<string[] | null> {
  const { record, repoRoot } = params
  if (record.sandboxPath === null) return null
  const receiptPaths = record.harness.phases
    .map((phase) => phase.receiptPath)
    .filter((value): value is string => typeof value === "string")
  if (receiptPaths.length === 0) return null
  const tools: string[] = []
  let readAny = false
  for (const receiptPath of receiptPaths) {
    const abs = path.resolve(repoRoot, record.sandboxPath, receiptPath)
    let text: string
    try {
      text = await readFile(abs, "utf8")
    } catch {
      continue
    }
    readAny = true
    tools.push(...extractToolNames(text))
  }
  return readAny ? tools : null
}
