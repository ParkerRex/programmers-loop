import { readFile } from "node:fs/promises"
import path from "node:path"

// The audit module is authored by a sibling workstream and is consumed here IF
// present: it exposes the paper's "validation-hook family" of anti-loop /
// constraint signals (exit-127, repeated-failing-command, out-of-declared-network)
// designed, per its own header, to be wired from the report/adapt tooling. If it
// is ever removed, drop this import and the `auditSignals` enrichment; the
// classification, proposals, and line-ref'd transcript signals stand on their own.
import { auditEpisode, type AuditSignal } from "./audit.js"
import {
  buildDiversityReport,
  DIVERSITY_SUCCESS_RHO,
  type DiversityReport,
  readEpisodeToolSequence,
} from "./diversity.js"
import {
  type EpisodeGrade,
  type EpisodeRecord,
  type EpisodeTerminalState,
  EVAL_SYSTEMS,
  type EvalSystem,
  readEpisodeRecord,
  readManifest,
} from "./manifest.js"

/**
 * Failure-driven harness adaptation for an evaluation run.
 *
 * This implements the diagnostic half of "Better Harnesses, Smaller Models"
 * (arXiv 2607.08938): read finished episodes, classify each unsuccessful one
 * into the 13-category taxonomy of `docs/MODEL-OVERHANG-EVAL.md`, and map every
 * represented failure class to the paper's adaptation strategies (context
 * additions covered 86% of their fixes, tool creation 43%, tool filtering 29%;
 * instruction-following plus knowledge fixes covered 81%). The output is a set
 * of concrete, evidence-linked EDIT SUGGESTIONS.
 *
 * It PROPOSES and never applies. SkillsBench (arXiv 2602.12670) found that
 * self-generated guidance scored −8.1 to −11.3pp below the no-skills baseline:
 * adopted guidance must be human-curated.
 * Every report therefore leads with {@link PROPOSALS_ONLY_BANNER} and stops at
 * suggestions.
 *
 * v1 is fully mechanical — no model calls. Classification is derived only from
 * evidence already in the durable records: grading components (functional /
 * regression / scope) give the regression/scope/validation classes, terminal
 * states give the budget/owner/harness/infra classes, and raw event transcripts
 * give secondary tool-use signals. Anything not mechanically derivable is left
 * honestly "unclassified".
 */

/** Mandatory report header. Adoption requires human curation (SkillsBench). */
export const PROPOSALS_ONLY_BANNER =
  "PROPOSALS ONLY — human curation required before adoption " +
  "(SkillsBench: self-generated guidance −8.1 to −11.3pp below the " +
  "no-skills baseline)."

export const ADAPT_REPORT_SCHEMA_VERSION = 1

/**
 * The 13 primary failure categories, in the order of
 * `docs/MODEL-OVERHANG-EVAL.md`. Slugs are stable identifiers; {@link
 * FAILURE_CLASS_LABEL} carries the human phrasing from the spec.
 */
export const FAILURE_CLASSES = [
  "task-understanding",
  "research-or-convergence",
  "decomposition-or-ordering",
  "plan-readiness",
  "implementation",
  "regression-or-scope",
  "validation-or-proof",
  "false-completion",
  "owner-blocked",
  "context-recovery",
  "budget-or-timeout",
  "harness",
  "infrastructure",
] as const

export type FailureClass = (typeof FAILURE_CLASSES)[number]

export const FAILURE_CLASS_LABEL: Record<FailureClass, string> = {
  "budget-or-timeout": "budget or timeout exhaustion",
  "context-recovery": "context-recovery failure",
  "decomposition-or-ordering": "decomposition or ordering failure",
  "false-completion": "false completion",
  harness: "harness failure",
  implementation: "implementation failure",
  infrastructure: "infrastructure failure",
  "owner-blocked": "owner-blocked",
  "plan-readiness": "plan-readiness failure",
  "regression-or-scope": "regression or scope failure",
  "research-or-convergence": "research or convergence failure",
  "task-understanding": "task-understanding failure",
  "validation-or-proof": "validation or proof failure",
}

/** How the paper's strategies map to a concrete, human-reviewable edit. */
export type AdaptationKind =
  | "curated-skill"
  | "prompt-block"
  | "tool-policy"
  | "contract-lint-gate"
  | "harness-fix"
  | "infra-fix"

type AdaptationTemplate = {
  paperStrategy: string
  kind: AdaptationKind
  suggestion: string
}

/**
 * Static mapping from failure class to the paper's adaptation strategy and a
 * concrete edit template. Used both for the emitted proposals (represented
 * classes only) and for the full-13 reference table. The suggestions are
 * deliberately specific to this repository's surfaces (curated skills, prompt
 * blocks, `tool_policy`, and the contract lint gates) so a human curator can
 * act or reject, never adopt blindly.
 */
export const ADAPTATION_MAP: Record<FailureClass, AdaptationTemplate> = {
  "budget-or-timeout": {
    kind: "tool-policy",
    paperStrategy: "tool filtering (29%)",
    suggestion:
      "Filter slow or redundant tools out of the arm and right-size the task " +
      "budgets (max_wall_ms / max_turns / max_phases); add a budget-awareness " +
      "prompt-block so the agent front-loads the decisive action.",
  },
  "context-recovery": {
    kind: "curated-skill",
    paperStrategy: "context addition (86%)",
    suggestion:
      "Add a human-curated durable-state recovery skill so an interrupted " +
      "episode resumes from checked-in artifacts (Assignment / ExecPlan / " +
      "receipts) instead of lost in-memory history.",
  },
  "decomposition-or-ordering": {
    kind: "prompt-block",
    paperStrategy: "context addition (86%)",
    suggestion:
      "Add a decomposition prompt-block that requires an explicit ordered " +
      "slice list (dependencies first) before any execution phase.",
  },
  "false-completion": {
    kind: "contract-lint-gate",
    paperStrategy: "instruction-following fix",
    suggestion:
      "Make a passing deterministic proof receipt the completion contract: " +
      "reject a self-reported 'done' that carries no proof evidence.",
  },
  harness: {
    kind: "harness-fix",
    paperStrategy: "harness defect (not model guidance)",
    suggestion:
      "This is an orchestration/harness defect, not a model-guidance gap. File " +
      "a harness fix; do NOT add agent guidance to paper over it.",
  },
  implementation: {
    kind: "curated-skill",
    paperStrategy: "context addition (86%) + tool creation (43%)",
    suggestion:
      "Add a human-curated skill covering the failing implementation area, and " +
      "consider a scoped helper tool for the recurring operation the episodes " +
      "struggled with.",
  },
  infrastructure: {
    kind: "infra-fix",
    paperStrategy: "infrastructure defect (excluded from scoring)",
    suggestion:
      "Infrastructure failure — excluded from scored model results per " +
      "MODEL-OVERHANG-EVAL. Repair the environment and re-run; do not treat as " +
      "a model failure or a guidance gap.",
  },
  "owner-blocked": {
    kind: "prompt-block",
    paperStrategy: "context addition (86%)",
    suggestion:
      "Inject the symmetric autonomous-decision prompt-block (no human is " +
      "available; decide and record the decision) from the DECISIONS.md " +
      "owner-question policy so the episode does not stall.",
  },
  "plan-readiness": {
    kind: "contract-lint-gate",
    paperStrategy: "instruction-following fix",
    suggestion:
      "Gate execution on `exec-plan lint --ready`: a plan must pass the " +
      "readiness contract before the executor phase is allowed to run.",
  },
  "regression-or-scope": {
    kind: "contract-lint-gate",
    paperStrategy: "instruction-following fix",
    suggestion:
      "Add a scope-boundary lint gate over the task's forbidden_paths and a " +
      "regression proof step before completion, so out-of-scope or regressing " +
      "edits are caught deterministically.",
  },
  "research-or-convergence": {
    kind: "prompt-block",
    paperStrategy: "context addition (86%)",
    suggestion:
      "Add a bounded research/convergence prompt-block: enumerate the unknowns " +
      "and inspect the relevant files before editing anything.",
  },
  "task-understanding": {
    kind: "curated-skill",
    paperStrategy: "context addition (86%)",
    suggestion:
      "Add a human-curated skill or prompt-block that restates the task's " +
      "domain contract and acceptance shape, so the agent grounds the request " +
      "before acting.",
  },
  "validation-or-proof": {
    kind: "tool-policy",
    paperStrategy: "tool creation (43%) + instruction-following fix",
    suggestion:
      "Ensure the deterministic proof/test command is present and REQUIRED as " +
      "a tool-policy step before the episode may terminate successfully, so a " +
      "functional gap is caught by proof rather than shipped.",
  },
}

/** One evidence citation: an episode id plus optional raw-event line refs. */
export type EvidenceRef = {
  episodeId: string
  /** Repository-relative transcript path when derivable, else null. */
  transcript: string | null
  /** 1-based event-line references within {@link transcript}, sorted; [] when none. */
  lines: number[]
  detail: string
}

/** A secondary tool-use / instruction signal read from a raw event transcript. */
export type TranscriptSignal = {
  kind: "tool-error" | "permission-denied" | "api-error" | "agent-error"
  transcript: string
  line: number
  detail: string
}

export type EpisodeClassification = {
  runId: string
  episodeId: string
  taskId: string
  system: EvalSystem
  model: string
  terminalState: EpisodeTerminalState
  outcome: "success" | "failure"
  /** Primary failure class, "unclassified" when a failure is not mechanically derivable, or null for success. */
  failureClass: FailureClass | "unclassified" | null
  rationale: string
  evidence: EvidenceRef[]
  /** Secondary transcript-derived signals (tool errors, denials), sorted by line. */
  signals: TranscriptSignal[]
  /** Anti-loop / constraint audit signals from the sibling audit module (validation-hook family). */
  auditSignals: AuditSignal[]
}

export type AggregationRow = {
  taskId: string
  system: EvalSystem
  model: string
  episodes: number
  successes: number
  failures: number
  byTerminalState: Partial<Record<EpisodeTerminalState, number>>
  successRate: number
}

export type Proposal = {
  failureClass: FailureClass
  label: string
  paperStrategy: string
  kind: AdaptationKind
  suggestion: string
  episodeIds: string[]
  evidence: EvidenceRef[]
}

export type AdaptReport = {
  schemaVersion: typeof ADAPT_REPORT_SCHEMA_VERSION
  runIds: string[]
  /** Newest episode `completedAt` across the corpus (never the wall clock), or "unknown". */
  generatedFromEpisodeDate: string
  models: string[]
  arms: EvalSystem[]
  totals: {
    episodes: number
    successes: number
    failures: number
    byTerminalState: Partial<Record<EpisodeTerminalState, number>>
    byFailureClass: Partial<Record<FailureClass | "unclassified", number>>
    /** Audit signal counts by kind across the corpus, sorted-key rendered. */
    byAuditSignal: Record<string, number>
  }
  aggregation: AggregationRow[]
  classifications: EpisodeClassification[]
  proposals: Proposal[]
  diversity: DiversityReport
  /** Runs named on the command line that had no readable manifest, sorted. */
  missingRuns: string[]
  /** Episode ids whose transcript could not be read, sorted. */
  episodesWithoutTranscript: string[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

/**
 * Map a terminal state (and, for a graded failure, its components) to the
 * single primary failure class. Success returns null. The grade-derived
 * mapping is transparent: `functional=false` is a validation/proof failure (the
 * deterministic proof caught a functional gap the agent shipped), while a
 * failing `scope` or `regression` component is a regression-or-scope failure.
 */
export function classifyTerminal(
  terminalState: EpisodeTerminalState,
  grade: EpisodeGrade | null,
): { failureClass: FailureClass | "unclassified" | null; rationale: string } {
  switch (terminalState) {
    case "verified_success":
      return { failureClass: null, rationale: "verified success" }
    case "timeout":
      return {
        failureClass: "budget-or-timeout",
        rationale: "terminal state timeout (wall budget spent)",
      }
    case "budget_exhausted":
      return {
        failureClass: "budget-or-timeout",
        rationale: "terminal state budget_exhausted (phase ceiling reached)",
      }
    case "owner_blocked":
      return {
        failureClass: "owner-blocked",
        rationale: "terminal state owner_blocked (asked instead of deciding)",
      }
    case "harness_failure":
      return {
        failureClass: "harness",
        rationale: "terminal state harness_failure (orchestration defect)",
      }
    case "infrastructure_failure":
      return {
        failureClass: "infrastructure",
        rationale:
          "terminal state infrastructure_failure (environment/grading fault)",
      }
    case "verified_failure": {
      if (grade === null) {
        return {
          failureClass: "unclassified",
          rationale:
            "verified_failure without recorded grade components; classify by hand",
        }
      }
      if (!grade.functional) {
        return {
          failureClass: "validation-or-proof",
          rationale:
            "graded functional=false (deterministic proof caught a functional gap)",
        }
      }
      if (!grade.scope) {
        return {
          failureClass: "regression-or-scope",
          rationale: "graded scope=false (out-of-scope change)",
        }
      }
      if (!grade.regression) {
        return {
          failureClass: "regression-or-scope",
          rationale: "graded regression=false (introduced a regression)",
        }
      }
      return {
        failureClass: "unclassified",
        rationale:
          "verified_failure but all grade components pass; classify by hand",
      }
    }
    default:
      return {
        failureClass: "unclassified",
        rationale: "unrecognized terminal state",
      }
  }
}

/**
 * Scan one raw event transcript for secondary tool-use / instruction signals,
 * tagging each with its 1-based line. Handles both the Claude Code stream
 * (`tool_result` items flagged `is_error`, non-empty `permission_denials`,
 * error `result` events) and the Codex stream (`error` items).
 */
export function scanTranscriptSignals(
  jsonlText: string,
  transcript: string,
): TranscriptSignal[] {
  const signals: TranscriptSignal[] = []
  const lines = jsonlText.split("\n")
  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index] ?? ""
    if (raw.trim() === "") continue
    let event: unknown
    try {
      event = JSON.parse(raw)
    } catch {
      continue
    }
    if (!isRecord(event)) continue
    const line = index + 1
    if (event.type === "user" && isRecord(event.message)) {
      const content = event.message.content
      if (Array.isArray(content)) {
        for (const item of content) {
          if (
            isRecord(item) &&
            item.type === "tool_result" &&
            item.is_error === true
          ) {
            signals.push({
              detail: "tool_result reported is_error",
              kind: "tool-error",
              line,
              transcript,
            })
          }
        }
      }
      continue
    }
    if (
      Array.isArray(event.permission_denials) &&
      event.permission_denials.length > 0
    ) {
      signals.push({
        detail: `${event.permission_denials.length} permission denial(s)`,
        kind: "permission-denied",
        line,
        transcript,
      })
      continue
    }
    if (event.type === "result" && event.is_error === true) {
      const subtype =
        typeof event.subtype === "string" ? event.subtype : "error"
      signals.push({
        detail: `result event is_error (${subtype})`,
        kind: "api-error",
        line,
        transcript,
      })
      continue
    }
    if (
      event.type === "item.completed" &&
      isRecord(event.item) &&
      event.item.type === "error"
    ) {
      const message =
        typeof event.item.message === "string"
          ? event.item.message.slice(0, 80)
          : "codex error item"
      signals.push({ detail: message, kind: "agent-error", line, transcript })
    }
  }
  return signals
}

type CollectedEpisode = {
  runId: string
  model: string
  record: EpisodeRecord
}

/** Repository-relative display path for an episode's first transcript, or null. */
function firstTranscriptPath(record: EpisodeRecord): string | null {
  if (record.sandboxPath === null) return null
  const receipt = record.harness.phases
    .map((phase) => phase.receiptPath)
    .find((value): value is string => typeof value === "string")
  if (receipt === undefined) return null
  return path.posix.join(record.sandboxPath, receipt)
}

async function classifyEpisode(params: {
  collected: CollectedEpisode
  repoRoot: string
}): Promise<{
  classification: EpisodeClassification
  transcriptRead: boolean
}> {
  const { collected, repoRoot } = params
  const { record } = collected
  const { failureClass, rationale } = classifyTerminal(
    record.terminalState,
    record.grade,
  )
  const outcome: "success" | "failure" =
    record.terminalState === "verified_success" ? "success" : "failure"

  // Primary evidence: the grade components or the harness notes that produced
  // the terminal state (no transcript line refs — this is record-level).
  const evidence: EvidenceRef[] = []
  const transcript = firstTranscriptPath(record)
  if (outcome === "failure") {
    let detail: string
    if (record.grade !== null) {
      detail = `grade functional=${record.grade.functional} regression=${record.grade.regression} scope=${record.grade.scope}`
      if (record.grade.notes.length > 0) {
        detail += `; notes: ${record.grade.notes.join(" | ")}`
      }
    } else if (record.harness.notes.length > 0) {
      detail = `harness: ${record.harness.notes.join(" | ")}`
    } else {
      detail = `terminal state ${record.terminalState}`
    }
    evidence.push({
      detail,
      episodeId: record.episode.episodeId,
      lines: [],
      transcript,
    })
  }

  // Secondary evidence: transcript-derived tool-use / instruction signals. The
  // per-phase JSONL is parsed once into events for the audit detectors (which
  // want the whole episode concatenated) and scanned for line-ref'd signals.
  const signals: TranscriptSignal[] = []
  const events: unknown[] = []
  let transcriptRead = false
  if (record.sandboxPath !== null) {
    for (const phase of record.harness.phases) {
      if (phase.receiptPath === null) continue
      const abs = path.resolve(repoRoot, record.sandboxPath, phase.receiptPath)
      const display = path.posix.join(record.sandboxPath, phase.receiptPath)
      let text: string
      try {
        text = await readFile(abs, "utf8")
      } catch {
        continue
      }
      transcriptRead = true
      signals.push(...scanTranscriptSignals(text, display))
      for (const line of text.split("\n")) {
        if (line.trim() === "") continue
        try {
          events.push(JSON.parse(line))
        } catch {
          // A malformed line is skipped; the audit detectors tolerate gaps.
        }
      }
    }
  }
  // Anti-loop / constraint audit over the whole episode (scope/diff omitted: no
  // git diff is available here, so the forbidden-path detector is skipped).
  const auditSignals = auditEpisode({ events })
  signals.sort((left, right) =>
    left.transcript === right.transcript
      ? left.line - right.line
      : left.transcript < right.transcript
        ? -1
        : 1,
  )
  if (outcome === "failure" && signals.length > 0) {
    // Group signal line refs by transcript into compact evidence entries.
    const byTranscript = new Map<string, number[]>()
    for (const signal of signals) {
      const bucket = byTranscript.get(signal.transcript) ?? []
      bucket.push(signal.line)
      byTranscript.set(signal.transcript, bucket)
    }
    for (const key of [...byTranscript.keys()].toSorted()) {
      const kinds = [
        ...new Set(
          signals.filter((s) => s.transcript === key).map((s) => s.kind),
        ),
      ].toSorted()
      evidence.push({
        detail: `transcript signals: ${kinds.join(", ")}`,
        episodeId: record.episode.episodeId,
        lines: (byTranscript.get(key) ?? []).toSorted((a, b) => a - b),
        transcript: key,
      })
    }
  }

  // Fold the audit module's semantic signals (validation-hook family) into the
  // evidence so proposals cite them; they carry no line ref but name the pattern.
  if (outcome === "failure") {
    for (const signal of auditSignals) {
      evidence.push({
        detail: `audit ${signal.kind}${signal.heuristic ? " (heuristic)" : ""}: ${signal.detail}`,
        episodeId: record.episode.episodeId,
        lines: [],
        transcript,
      })
    }
  }

  return {
    classification: {
      auditSignals,
      episodeId: record.episode.episodeId,
      evidence,
      failureClass,
      model: collected.model,
      outcome,
      rationale,
      runId: collected.runId,
      signals,
      system: record.episode.system,
      taskId: record.episode.taskId,
      terminalState: record.terminalState,
    },
    transcriptRead,
  }
}

function buildAggregation(
  classifications: readonly EpisodeClassification[],
): AggregationRow[] {
  const rows = new Map<string, AggregationRow>()
  for (const item of classifications) {
    const key = `${item.taskId} ${item.system} ${item.model}`
    const row =
      rows.get(key) ??
      ({
        byTerminalState: {},
        episodes: 0,
        failures: 0,
        model: item.model,
        successes: 0,
        successRate: 0,
        system: item.system,
        taskId: item.taskId,
      } satisfies AggregationRow)
    row.episodes += 1
    if (item.outcome === "success") row.successes += 1
    else row.failures += 1
    row.byTerminalState[item.terminalState] =
      (row.byTerminalState[item.terminalState] ?? 0) + 1
    rows.set(key, row)
  }
  for (const row of rows.values()) {
    row.successRate = row.episodes === 0 ? 0 : row.successes / row.episodes
  }
  return [...rows.values()].toSorted((left, right) => {
    if (left.taskId !== right.taskId) return left.taskId < right.taskId ? -1 : 1
    if (left.system !== right.system)
      return (
        EVAL_SYSTEMS.indexOf(left.system) - EVAL_SYSTEMS.indexOf(right.system)
      )
    return left.model < right.model ? -1 : 1
  })
}

function buildProposals(
  classifications: readonly EpisodeClassification[],
): Proposal[] {
  const byClass = new Map<FailureClass, EpisodeClassification[]>()
  for (const item of classifications) {
    if (item.failureClass === null || item.failureClass === "unclassified") {
      continue
    }
    const bucket = byClass.get(item.failureClass) ?? []
    bucket.push(item)
    byClass.set(item.failureClass, bucket)
  }
  const proposals: Proposal[] = []
  for (const failureClass of FAILURE_CLASSES) {
    const members = byClass.get(failureClass)
    if (members === undefined || members.length === 0) continue
    const template = ADAPTATION_MAP[failureClass]
    const episodeIds = members.map((member) => member.episodeId).toSorted()
    const evidence = members
      .flatMap((member) => member.evidence)
      .toSorted((left, right) =>
        left.episodeId < right.episodeId
          ? -1
          : left.episodeId > right.episodeId
            ? 1
            : 0,
      )
    proposals.push({
      episodeIds,
      evidence,
      failureClass,
      kind: template.kind,
      label: FAILURE_CLASS_LABEL[failureClass],
      paperStrategy: template.paperStrategy,
      suggestion: template.suggestion,
    })
  }
  return proposals
}

/**
 * Read the named runs' manifests, episode records, and raw event transcripts,
 * then classify every episode, aggregate outcomes, generate per-class proposals,
 * and compute tool-sequence diversity. Fully deterministic for fixed inputs:
 * runs and episodes are visited in sorted / manifest order, the generation date
 * is the newest episode `completedAt` (never the clock), and a missing manifest
 * or unreadable transcript degrades to a recorded note rather than throwing.
 */
export async function buildAdaptReport(params: {
  runIds: readonly string[]
  repoRoot: string
}): Promise<AdaptReport> {
  const runIds = [...new Set(params.runIds)].toSorted()
  const collected: CollectedEpisode[] = []
  const missingRuns: string[] = []
  for (const runId of runIds) {
    const manifest = await readManifest({ repoRoot: params.repoRoot, runId })
    if (manifest === null) {
      missingRuns.push(runId)
      continue
    }
    const model = manifest.configInputs.model ?? "default"
    for (const episode of manifest.episodes) {
      const record = await readEpisodeRecord({
        episodeId: episode.episodeId,
        repoRoot: params.repoRoot,
        runId,
      })
      if (record === null) continue
      collected.push({ model, record, runId })
    }
  }

  const classifications: EpisodeClassification[] = []
  const episodesWithoutTranscript: string[] = []
  const sequences: {
    episodeId: string
    taskId: string
    system: string
    tools: string[] | null
  }[] = []
  let newestDate = ""
  for (const item of collected) {
    const { classification, transcriptRead } = await classifyEpisode({
      collected: item,
      repoRoot: params.repoRoot,
    })
    classifications.push(classification)
    if (!transcriptRead) {
      episodesWithoutTranscript.push(item.record.episode.episodeId)
    }
    const tools = await readEpisodeToolSequence({
      record: item.record,
      repoRoot: params.repoRoot,
    })
    sequences.push({
      episodeId: item.record.episode.episodeId,
      system: item.record.episode.system,
      taskId: item.record.episode.taskId,
      tools,
    })
    if (item.record.completedAt > newestDate)
      newestDate = item.record.completedAt
  }
  classifications.sort((left, right) =>
    left.episodeId < right.episodeId
      ? -1
      : left.episodeId > right.episodeId
        ? 1
        : 0,
  )

  const byTerminalState: Partial<Record<EpisodeTerminalState, number>> = {}
  const byFailureClass: Partial<Record<FailureClass | "unclassified", number>> =
    {}
  const byAuditSignal: Record<string, number> = {}
  let successes = 0
  for (const item of classifications) {
    byTerminalState[item.terminalState] =
      (byTerminalState[item.terminalState] ?? 0) + 1
    if (item.outcome === "success") successes += 1
    if (item.failureClass !== null) {
      byFailureClass[item.failureClass] =
        (byFailureClass[item.failureClass] ?? 0) + 1
    }
    for (const signal of item.auditSignals) {
      byAuditSignal[signal.kind] = (byAuditSignal[signal.kind] ?? 0) + 1
    }
  }

  const models = [...new Set(collected.map((item) => item.model))].toSorted()
  const arms = EVAL_SYSTEMS.filter((system) =>
    collected.some((item) => item.record.episode.system === system),
  )

  return {
    aggregation: buildAggregation(classifications),
    arms,
    classifications,
    diversity: buildDiversityReport(sequences),
    episodesWithoutTranscript: episodesWithoutTranscript.toSorted(),
    generatedFromEpisodeDate: newestDate === "" ? "unknown" : newestDate,
    missingRuns: missingRuns.toSorted(),
    models,
    proposals: buildProposals(classifications),
    runIds,
    schemaVersion: ADAPT_REPORT_SCHEMA_VERSION,
    totals: {
      byAuditSignal,
      byFailureClass,
      byTerminalState,
      episodes: classifications.length,
      failures: classifications.length - successes,
      successes,
    },
  }
}

/** Escape a value destined for a Markdown table cell: pipes and newlines break rows. */
function escapeCell(text: string): string {
  return text.replaceAll("|", "\\|").replaceAll(/\r?\n/g, " ")
}

function fmtDistance(value: number | null): string {
  return value === null ? "n/a" : value.toFixed(4)
}

function fmtPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`
}

function citeEvidence(evidence: readonly EvidenceRef[]): string {
  return evidence
    .map((ref) => {
      const where =
        ref.transcript !== null && ref.lines.length > 0
          ? ` (${ref.transcript}:${ref.lines.join(",")})`
          : ""
      return `\`${ref.episodeId}\`${where} — ${ref.detail}`
    })
    .join("; ")
}

/** Render the tool-sequence diversity section (reused by the standalone mode). */
export function renderDiversitySection(diversity: DiversityReport): string {
  const lines: string[] = []
  lines.push("## Tool-call-sequence diversity")
  lines.push("")
  lines.push(
    `Mean pairwise normalized Levenshtein distance between episodes' ordered ` +
      `tool-call sequences (0 = identical, 1 = disjoint). The paper reports ` +
      `rho = ${DIVERSITY_SUCCESS_RHO} between a task's diversity and the success ` +
      `of a single static harness edit across its episodes: the higher these ` +
      `numbers, the less any one proposal below is expected to generalize.`,
  )
  lines.push("")
  lines.push(
    `Corpus: ${diversity.corpus.episodeCount} comparable episode(s), ` +
      `${diversity.corpus.pairCount} pair(s), mean ` +
      `${fmtDistance(diversity.corpus.meanDistance)} ` +
      `(min ${fmtDistance(diversity.corpus.minDistance)}, ` +
      `max ${fmtDistance(diversity.corpus.maxDistance)}).`,
  )
  lines.push("")
  if (diversity.perTask.length > 0) {
    lines.push("| Task | Episodes | Pairs | Mean | Min | Max |")
    lines.push("| ---- | -------- | ----- | ---- | --- | --- |")
    for (const task of diversity.perTask) {
      lines.push(
        `| ${escapeCell(task.taskId)} | ${task.episodeCount} | ${task.pairCount} | ` +
          `${fmtDistance(task.meanDistance)} | ${fmtDistance(task.minDistance)} | ` +
          `${fmtDistance(task.maxDistance)} |`,
      )
    }
    lines.push("")
  }
  if (diversity.excludedEpisodes.length > 0) {
    lines.push(
      `Excluded (no readable transcript): ${diversity.excludedEpisodes
        .map((id) => `\`${id}\``)
        .join(", ")}.`,
    )
    lines.push("")
  }
  return lines.join("\n")
}

/**
 * Render an {@link AdaptReport} as deterministic Markdown (the ADAPT-REPORT.md
 * body). Contains no wall-clock timestamps — the only date is the corpus's
 * newest episode `completedAt` — so identical inputs yield a byte-identical
 * document.
 */
export function renderAdaptReportMarkdown(report: AdaptReport): string {
  const out: string[] = []
  out.push("# Adapt report")
  out.push("")
  out.push(`> ${PROPOSALS_ONLY_BANNER}`)
  out.push("")
  out.push(
    `- Runs: ${report.runIds.map((id) => `\`${id}\``).join(", ") || "(none)"}`,
  )
  out.push(
    `- Generated from episode data as of: ${report.generatedFromEpisodeDate}`,
  )
  out.push(`- Models: ${report.models.join(", ") || "(none)"}`)
  out.push(`- Arms: ${report.arms.join(", ") || "(none)"}`)
  out.push(
    `- Episodes: ${report.totals.episodes} ` +
      `(${report.totals.successes} verified success, ${report.totals.failures} unsuccessful)`,
  )
  const auditKinds = Object.keys(report.totals.byAuditSignal).toSorted()
  if (auditKinds.length > 0) {
    out.push(
      `- Audit signals: ${auditKinds
        .map((kind) => `${kind}:${report.totals.byAuditSignal[kind]}`)
        .join(", ")}`,
    )
  }
  if (report.missingRuns.length > 0) {
    out.push(
      `- Missing runs (no manifest): ${report.missingRuns
        .map((id) => `\`${id}\``)
        .join(", ")}`,
    )
  }
  out.push("")
  out.push(
    "This report is mechanical (no model calls): classes are derived from " +
      "grading components, terminal states, and raw event signals only. " +
      "Anything not derivable is left `unclassified`.",
  )
  out.push("")

  // Outcome aggregation.
  out.push("## Outcome aggregation (task × arm × model)")
  out.push("")
  if (report.aggregation.length === 0) {
    out.push("_No episodes found._")
    out.push("")
  } else {
    out.push(
      "| Task | Arm | Model | Episodes | Success | Fail | Success rate | Terminal states |",
    )
    out.push(
      "| ---- | --- | ----- | -------- | ------- | ---- | ------------ | --------------- |",
    )
    for (const row of report.aggregation) {
      const terminals = Object.keys(row.byTerminalState)
        .toSorted()
        .map(
          (state) =>
            `${state}:${row.byTerminalState[state as EpisodeTerminalState]}`,
        )
        .join(", ")
      out.push(
        `| ${escapeCell(row.taskId)} | ${row.system} | ${escapeCell(row.model)} | ${row.episodes} | ` +
          `${row.successes} | ${row.failures} | ${fmtPercent(row.successRate)} | ${terminals} |`,
      )
    }
    out.push("")
  }

  // Failure classification.
  const failures = report.classifications.filter(
    (item) => item.outcome === "failure",
  )
  out.push("## Failure classification")
  out.push("")
  if (failures.length === 0) {
    out.push("_No unsuccessful episodes — nothing to classify, no proposals._")
    out.push("")
  } else {
    out.push("| Episode | Arm | Terminal | Class | Rationale | Evidence |")
    out.push("| ------- | --- | -------- | ----- | --------- | -------- |")
    for (const item of failures) {
      const label =
        item.failureClass === null
          ? "—"
          : item.failureClass === "unclassified"
            ? "unclassified"
            : `${item.failureClass} (${FAILURE_CLASS_LABEL[item.failureClass]})`
      out.push(
        `| \`${escapeCell(item.episodeId)}\` | ${item.system} | ${item.terminalState} | ` +
          `${escapeCell(label)} | ${escapeCell(item.rationale)} | ${escapeCell(citeEvidence(item.evidence)) || "—"} |`,
      )
    }
    out.push("")
  }

  // Proposals.
  out.push("## Proposed adaptations")
  out.push("")
  out.push(
    "One proposal per failure class actually observed. Paper mapping: context " +
      "additions covered 86% of fixes, tool creation 43%, tool filtering 29%; " +
      "instruction-following + knowledge fixes covered 81% (arXiv 2607.08938).",
  )
  out.push("")
  if (report.proposals.length === 0) {
    out.push("_No represented failure classes — no proposals._")
    out.push("")
  } else {
    for (const proposal of report.proposals) {
      out.push(
        `### ${proposal.failureClass} — ${proposal.label} (${proposal.episodeIds.length} episode(s))`,
      )
      out.push("")
      out.push(`- Paper strategy: ${proposal.paperStrategy}`)
      out.push(`- Adaptation kind: ${proposal.kind}`)
      out.push(`- Suggestion: ${proposal.suggestion}`)
      out.push(
        `- Episodes: ${proposal.episodeIds.map((id) => `\`${id}\``).join(", ")}`,
      )
      out.push(`- Evidence: ${citeEvidence(proposal.evidence) || "—"}`)
      out.push("")
    }
  }

  // Full mapping reference.
  out.push("## Failure-class → adaptation reference (all 13)")
  out.push("")
  out.push(
    "Complete taxonomy mapping for human curation. Only classes with observed " +
      "failures above carry evidence; this table is the reference for the rest.",
  )
  out.push("")
  out.push("| # | Class | Label | Paper strategy | Adaptation kind |")
  out.push("| - | ----- | ----- | -------------- | --------------- |")
  FAILURE_CLASSES.forEach((failureClass, index) => {
    const template = ADAPTATION_MAP[failureClass]
    out.push(
      `| ${index + 1} | ${failureClass} | ${FAILURE_CLASS_LABEL[failureClass]} | ` +
        `${template.paperStrategy} | ${template.kind} |`,
    )
  })
  out.push("")

  // Diversity.
  out.push(renderDiversitySection(report.diversity))

  return `${out.join("\n").trimEnd()}\n`
}
