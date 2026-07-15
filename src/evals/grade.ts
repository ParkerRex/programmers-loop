import path from "node:path"
import process from "node:process"

import { runProcess } from "../process.js"
import type { EpisodeGrade } from "./manifest.js"
import {
  parseGraderSummary,
  type TaskGraderSummary,
  type TaskPackage,
} from "./task-package.js"

/**
 * Deterministic grading for one finished sandbox.
 *
 * The hidden grader is executed exactly as its contract requires: from the
 * package directory, as `node <command[0]> ...rest <sandboxDir>`, with the
 * grader tree left in place and never copied into the sandbox. It is run twice
 * against the same final sandbox; a deterministic grader must return the same
 * decision both times. Disagreement is treated as an infrastructure failure,
 * not a model result, and is never silently scored.
 */
export type GradeOutcome = {
  terminalState:
    | "verified_success"
    | "verified_failure"
    | "infrastructure_failure"
  grade: EpisodeGrade | null
  auditNotes: string[]
}

/**
 * CLI exit code for a grading outcome, following the CLI's conventions
 * (0 success, 1 the checked thing failed, 2 reserved for usage errors):
 * 0 `verified_success`, 1 `verified_failure` (a real graded failure), and
 * 3 `infrastructure_failure` (the grading machinery itself was unusable or
 * disagreed with itself), so scripts can distinguish a graded failure from a
 * grading fault without parsing JSON.
 */
export function gradeExitCode(
  terminalState: GradeOutcome["terminalState"],
): 0 | 1 | 3 {
  if (terminalState === "verified_success") return 0
  if (terminalState === "verified_failure") return 1
  return 3
}

type GraderRun = {
  usable: boolean
  exitCode: number
  timedOut: boolean
  summary: TaskGraderSummary | null
  detail: string
}

async function runGraderOnce(params: {
  pkg: TaskPackage
  sandboxDir: string
  maxOutputBytes: number
}): Promise<GraderRun> {
  const [entry, ...rest] = params.pkg.grader.command
  const graderPath = path.join(params.pkg.dir, entry ?? "")
  try {
    const result = await runProcess({
      args: [graderPath, ...rest, params.sandboxDir],
      command: process.execPath,
      cwd: params.pkg.dir,
      maxOutputBytes: params.maxOutputBytes,
      timeoutMs: params.pkg.grader.timeoutMs,
    })
    if (result.timedOut) {
      return {
        detail: "grader timed out",
        exitCode: result.exitCode,
        summary: null,
        timedOut: true,
        usable: false,
      }
    }
    const { issues, summary } = parseGraderSummary(result.stdout)
    if (summary === null) {
      return {
        detail: `grader output was not a valid summary: ${issues.join("; ")}`,
        exitCode: result.exitCode,
        summary: null,
        timedOut: false,
        usable: false,
      }
    }
    // A grader whose exit code disagrees with its own components is a defective
    // grader, not a model result.
    const componentsPass =
      summary.functional && summary.regression && summary.scope
    if ((result.exitCode === 0) !== componentsPass) {
      return {
        detail: `grader exit code ${result.exitCode} contradicts its components`,
        exitCode: result.exitCode,
        summary,
        timedOut: false,
        usable: false,
      }
    }
    return {
      detail: "ok",
      exitCode: result.exitCode,
      summary,
      timedOut: false,
      usable: true,
    }
  } catch (error) {
    return {
      detail: `grader failed to run: ${error instanceof Error ? error.message : String(error)}`,
      exitCode: 1,
      summary: null,
      timedOut: false,
      usable: false,
    }
  }
}

function decisionTuple(run: GraderRun): string {
  const s = run.summary
  return [
    run.exitCode === 0 ? "pass" : "fail",
    s ? s.functional : "?",
    s ? s.regression : "?",
    s ? s.scope : "?",
  ].join("/")
}

/**
 * Grade a sandbox by running the task grader twice and requiring agreement.
 *
 * - Either run crashing or timing out -> `infrastructure_failure`.
 * - The two runs disagreeing on the scored decision -> `infrastructure_failure`
 *   with an audit note; the grade records `agreement: false`.
 * - Agreement and exit 0 -> `verified_success`; agreement and non-zero exit ->
 *   `verified_failure`.
 */
export async function gradeEpisode(params: {
  pkg: TaskPackage
  sandboxDir: string
  maxOutputBytes: number
}): Promise<GradeOutcome> {
  const first = await runGraderOnce(params)
  const second = await runGraderOnce(params)

  if (!first.usable || !second.usable) {
    const unusable = !first.usable ? first : second
    return {
      auditNotes: [`grader run unusable: ${unusable.detail}`],
      grade: null,
      terminalState: "infrastructure_failure",
    }
  }

  const summary = first.summary as TaskGraderSummary
  if (decisionTuple(first) !== decisionTuple(second)) {
    return {
      auditNotes: [
        `grader disagreed across two runs: ${decisionTuple(first)} then ${decisionTuple(second)}`,
      ],
      grade: {
        agreement: false,
        functional: summary.functional,
        notes: summary.notes,
        regression: summary.regression,
        scope: summary.scope,
      },
      terminalState: "infrastructure_failure",
    }
  }

  const passed = first.exitCode === 0
  return {
    auditNotes: [],
    grade: {
      agreement: true,
      functional: summary.functional,
      notes: summary.notes,
      regression: summary.regression,
      scope: summary.scope,
    },
    terminalState: passed ? "verified_success" : "verified_failure",
  }
}
