import assert from "node:assert/strict"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import test from "node:test"

import {
  buildAdaptReport,
  classifyTerminal,
  FAILURE_CLASSES,
  PROPOSALS_ONLY_BANNER,
  renderAdaptReportMarkdown,
  scanTranscriptSignals,
} from "../src/evals/adapt.js"
import {
  buildDiversityReport,
  extractToolNames,
  normalizedLevenshtein,
} from "../src/evals/diversity.js"
import type {
  EpisodeGrade,
  EpisodeRecord,
  EpisodeTerminalState,
  EvalSystem,
  RunManifest,
} from "../src/evals/manifest.js"

const REAL_REPO_ROOT = path.resolve(import.meta.dirname, "..")

// ---------------------------------------------------------------------------
// Synthetic-fixture helpers
// ---------------------------------------------------------------------------

type EpisodeSpec = {
  taskId: string
  system: EvalSystem
  rep: number
  terminalState: EpisodeTerminalState
  grade: EpisodeGrade | null
  /** Ordered tool names to synthesize a Claude transcript from, or null for no sandbox. */
  tools: string[] | null
  /** Inject a tool_result is_error after this many tool calls (creates a tool-error signal). */
  toolErrorAfter?: number
  /** Verbatim transcript content; overrides the generated one when set. */
  rawTranscript?: string
  harnessNotes?: string[]
  completedAt: string
}

/** Build a minimal but schema-shaped Claude event transcript from a tool list. */
function claudeTranscript(
  tools: readonly string[],
  toolErrorAfter?: number,
): string {
  const lines: string[] = [
    JSON.stringify({ type: "system", subtype: "init", tools: [...tools] }),
  ]
  tools.forEach((name, index) => {
    lines.push(
      JSON.stringify({
        type: "assistant",
        message: {
          content: [
            { type: "thinking", thinking: "" },
            { type: "tool_use", id: `t${index}`, name, input: {} },
          ],
        },
      }),
    )
    if (toolErrorAfter !== undefined && index + 1 === toolErrorAfter) {
      lines.push(
        JSON.stringify({
          type: "user",
          message: {
            content: [
              { type: "tool_result", tool_use_id: `t${index}`, is_error: true },
            ],
          },
        }),
      )
    }
  })
  lines.push(
    JSON.stringify({ type: "result", subtype: "success", is_error: false }),
  )
  return `${lines.join("\n")}\n`
}

function makeRecord(runId: string, spec: EpisodeSpec): EpisodeRecord {
  const episodeId = `${spec.taskId}-${spec.system}-r${spec.rep}`
  const hasSandbox = spec.tools !== null
  const sandboxPath = hasSandbox
    ? path.posix.join(".runtime", "evals", "sandboxes", runId, episodeId)
    : null
  const receiptPath = hasSandbox
    ? path.posix.join(".runtime", "agent-events", "ev.jsonl")
    : null
  const graded =
    spec.terminalState === "verified_success" ||
    spec.terminalState === "verified_failure"
  return {
    agentsMdPaths: [],
    budget: null,
    completedAt: spec.completedAt,
    episode: {
      episodeId,
      rep: spec.rep,
      seed: spec.rep,
      system: spec.system,
      taskId: spec.taskId,
    },
    grade: spec.grade,
    harness: {
      disposition: graded ? "grade" : spec.terminalState,
      notes: spec.harnessNotes ?? [],
      phases:
        receiptPath === null
          ? []
          : [{ phase: "p", receiptPath, status: "exit 0" }],
      system: spec.system,
    },
    runId,
    sandbox: null,
    sandboxPath,
    schemaVersion: 1,
    setup: null,
    startedAt: spec.completedAt,
    taskPackageDir: `evals/tasks/${spec.taskId}`,
    terminalState: spec.terminalState,
    treatment: null,
    usage: null,
    workspaceFingerprint: null,
  }
}

/** Write a synthetic run (manifest + episode records + transcripts) under repoRoot. */
async function writeSyntheticRun(params: {
  repoRoot: string
  runId: string
  model: string | null
  specs: EpisodeSpec[]
}): Promise<void> {
  const { repoRoot, runId, model, specs } = params
  const records = specs.map((spec) => makeRecord(runId, spec))
  const runDir = path.join(repoRoot, ".runtime", "evals", "runs", runId)
  await mkdir(path.join(runDir, "episodes"), { recursive: true })

  const systems = [...new Set(specs.map((spec) => spec.system))] as EvalSystem[]
  const manifest: RunManifest = {
    adapterVersion: null,
    baseSeed: 1,
    budgetSemanticsVersion: 1,
    configHash: "testhash",
    configInputs: {
      adapterId: "claude",
      model,
      promptDirHash: "prompthash",
      curatedSkillsHash: "skillhash",
      reasoningEffort: null,
      repoGitSha: null,
    },
    episodes: records.map((record) => record.episode),
    reps: Math.max(...specs.map((spec) => spec.rep)),
    runId,
    schemaVersion: 1,
    systems,
    tasksDir: "evals/tasks",
  }
  await writeFile(
    path.join(runDir, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  )

  for (let index = 0; index < records.length; index += 1) {
    const record = records[index]
    const spec = specs[index]
    if (record === undefined || spec === undefined) continue
    await writeFile(
      path.join(runDir, "episodes", `${record.episode.episodeId}.json`),
      `${JSON.stringify(record, null, 2)}\n`,
      "utf8",
    )
    if (record.sandboxPath !== null && spec.tools !== null) {
      const transcriptDir = path.join(
        repoRoot,
        record.sandboxPath,
        ".runtime",
        "agent-events",
      )
      await mkdir(transcriptDir, { recursive: true })
      await writeFile(
        path.join(transcriptDir, "ev.jsonl"),
        spec.rawTranscript ?? claudeTranscript(spec.tools, spec.toolErrorAfter),
        "utf8",
      )
    }
  }
}

async function withTempRepo(
  fn: (repoRoot: string) => Promise<void>,
): Promise<void> {
  const repoRoot = await mkdtemp(path.join(tmpdir(), "adapt-"))
  try {
    await fn(repoRoot)
  } finally {
    await rm(repoRoot, { force: true, recursive: true })
  }
}

/** A run spanning grade-derived AND terminal-derived failure classes, plus a success. */
function multiClassSpecs(): EpisodeSpec[] {
  return [
    {
      completedAt: "2026-07-15T10:00:00.000Z",
      grade: {
        agreement: true,
        functional: true,
        notes: [],
        regression: true,
        scope: true,
      },
      system: "direct",
      taskId: "task-a",
      terminalState: "verified_success",
      tools: ["Bash", "Read", "Edit"],
      rep: 1,
    },
    {
      completedAt: "2026-07-15T10:05:00.000Z",
      grade: {
        agreement: true,
        functional: true,
        notes: ["scope: only allowed files"],
        regression: true,
        scope: false,
      },
      system: "loop",
      taskId: "task-a",
      terminalState: "verified_failure",
      tools: ["Bash", "Read", "Bash"],
      rep: 1,
    },
    {
      completedAt: "2026-07-15T10:10:00.000Z",
      grade: {
        agreement: true,
        functional: false,
        notes: ["functional: expected 2 got 3"],
        regression: true,
        scope: true,
      },
      system: "direct",
      taskId: "task-b",
      terminalState: "verified_failure",
      tools: ["Bash", "Edit", "Bash"],
      toolErrorAfter: 1,
      rep: 1,
    },
    {
      completedAt: "2026-07-15T10:15:00.000Z",
      grade: null,
      harnessNotes: ["phase ceiling reached"],
      system: "loop",
      taskId: "task-b",
      terminalState: "budget_exhausted",
      tools: ["Bash", "Bash", "Bash", "Read"],
      rep: 1,
    },
    {
      completedAt: "2026-07-15T10:20:00.000Z",
      grade: null,
      harnessNotes: ["asked the owner a question"],
      system: "direct",
      taskId: "task-c",
      terminalState: "owner_blocked",
      tools: null,
      rep: 1,
    },
    {
      completedAt: "2026-07-15T10:25:00.000Z",
      grade: null,
      harnessNotes: ["adapter crashed"],
      system: "loop",
      taskId: "task-c",
      terminalState: "harness_failure",
      tools: ["Bash"],
      rep: 1,
    },
  ]
}

// ---------------------------------------------------------------------------
// Diversity unit tests (known sequences)
// ---------------------------------------------------------------------------

test("normalizedLevenshtein returns hand-computed distances", () => {
  assert.equal(normalizedLevenshtein(["a", "b", "c"], ["a", "b", "c"]), 0)
  assert.equal(normalizedLevenshtein(["a", "b", "c"], ["a", "x", "c"]), 1 / 3)
  assert.equal(normalizedLevenshtein(["a"], ["b"]), 1)
  assert.equal(normalizedLevenshtein([], ["a", "b"]), 1)
  assert.equal(normalizedLevenshtein([], []), 0)
  // One deletion out of the longer length four.
  assert.equal(
    normalizedLevenshtein(["a", "b", "c", "d"], ["b", "c", "d"]),
    1 / 4,
  )
})

test("extractToolNames reads ordered tools from both event streams", () => {
  const claude = [
    JSON.stringify({ type: "system", subtype: "init" }),
    JSON.stringify({
      type: "assistant",
      message: {
        content: [{ type: "thinking" }, { type: "tool_use", name: "Bash" }],
      },
    }),
    JSON.stringify({
      type: "assistant",
      message: { content: [{ type: "tool_use", name: "Read" }] },
    }),
    JSON.stringify({ type: "result", subtype: "success" }),
  ].join("\n")
  assert.deepEqual(extractToolNames(claude), ["Bash", "Read"])

  const codex = [
    JSON.stringify({ type: "thread.started" }),
    JSON.stringify({
      type: "item.completed",
      item: { type: "command_execution", command: "ls" },
    }),
    JSON.stringify({
      type: "item.completed",
      item: { type: "agent_message", text: "hi" },
    }),
    JSON.stringify({ type: "item.completed", item: { type: "file_change" } }),
  ].join("\n")
  assert.deepEqual(extractToolNames(codex), [
    "command_execution",
    "file_change",
  ])
})

test("buildDiversityReport averages pairwise distances and excludes empty transcripts", () => {
  const report = buildDiversityReport([
    { episodeId: "e1", system: "direct", taskId: "t", tools: ["x", "y"] },
    { episodeId: "e2", system: "loop", taskId: "t", tools: ["x", "y"] },
    { episodeId: "e3", system: "direct", taskId: "t", tools: ["x", "z"] },
    { episodeId: "e4", system: "loop", taskId: "t", tools: null },
  ])
  // d(e1,e2)=0, d(e1,e3)=0.5, d(e2,e3)=0.5 -> mean 1/3 over 3 pairs.
  assert.equal(report.corpus.episodeCount, 3)
  assert.equal(report.corpus.pairCount, 3)
  assert.equal(report.corpus.meanDistance, 1 / 3)
  assert.equal(report.corpus.minDistance, 0)
  assert.equal(report.corpus.maxDistance, 0.5)
  assert.deepEqual(report.excludedEpisodes, ["e4"])
  assert.deepEqual(report.includedEpisodes, ["e1", "e2", "e3"])
  assert.equal(report.perTask.length, 1)
  assert.equal(report.perTask[0]?.taskId, "t")
  assert.equal(report.perTask[0]?.meanDistance, 1 / 3)
})

// ---------------------------------------------------------------------------
// Classification unit tests
// ---------------------------------------------------------------------------

test("classifyTerminal maps terminal states and grade components to the taxonomy", () => {
  assert.equal(classifyTerminal("verified_success", null).failureClass, null)
  assert.equal(
    classifyTerminal("timeout", null).failureClass,
    "budget-or-timeout",
  )
  assert.equal(
    classifyTerminal("budget_exhausted", null).failureClass,
    "budget-or-timeout",
  )
  assert.equal(
    classifyTerminal("owner_blocked", null).failureClass,
    "owner-blocked",
  )
  assert.equal(
    classifyTerminal("harness_failure", null).failureClass,
    "harness",
  )
  assert.equal(
    classifyTerminal("infrastructure_failure", null).failureClass,
    "infrastructure",
  )
  const scopeFail: EpisodeGrade = {
    agreement: true,
    functional: true,
    notes: [],
    regression: true,
    scope: false,
  }
  assert.equal(
    classifyTerminal("verified_failure", scopeFail).failureClass,
    "regression-or-scope",
  )
  const regressionFail: EpisodeGrade = {
    agreement: true,
    functional: true,
    notes: [],
    regression: false,
    scope: true,
  }
  assert.equal(
    classifyTerminal("verified_failure", regressionFail).failureClass,
    "regression-or-scope",
  )
  const functionalFail: EpisodeGrade = {
    agreement: true,
    functional: false,
    notes: [],
    regression: true,
    scope: true,
  }
  assert.equal(
    classifyTerminal("verified_failure", functionalFail).failureClass,
    "validation-or-proof",
  )
  // A graded failure with no components recorded is honestly unclassified.
  assert.equal(
    classifyTerminal("verified_failure", null).failureClass,
    "unclassified",
  )
})

test("scanTranscriptSignals tags tool_result errors with their line", () => {
  const text = claudeTranscript(["Bash", "Read"], 1)
  const signals = scanTranscriptSignals(text, "t.jsonl")
  assert.equal(signals.length, 1)
  assert.equal(signals[0]?.kind, "tool-error")
  assert.equal(signals[0]?.transcript, "t.jsonl")
  // system(1), assistant Bash(2), tool_result error(3) -> line 3.
  assert.equal(signals[0]?.line, 3)
})

// ---------------------------------------------------------------------------
// Report integration tests
// ---------------------------------------------------------------------------

test("buildAdaptReport classifies a multi-class run and proposes one edit per class", async () => {
  await withTempRepo(async (repoRoot) => {
    await writeSyntheticRun({
      model: "test-model",
      repoRoot,
      runId: "mini-001",
      specs: multiClassSpecs(),
    })
    const report = await buildAdaptReport({ repoRoot, runIds: ["mini-001"] })

    assert.equal(report.totals.episodes, 6)
    assert.equal(report.totals.successes, 1)
    assert.equal(report.totals.failures, 5)

    // Every represented failure class is classified as expected.
    const classOf = (episodeId: string) =>
      report.classifications.find((c) => c.episodeId === episodeId)
        ?.failureClass
    assert.equal(classOf("task-a-loop-r1"), "regression-or-scope")
    assert.equal(classOf("task-b-direct-r1"), "validation-or-proof")
    assert.equal(classOf("task-b-loop-r1"), "budget-or-timeout")
    assert.equal(classOf("task-c-direct-r1"), "owner-blocked")
    assert.equal(classOf("task-c-loop-r1"), "harness")

    // One proposal per DISTINCT represented class, each with evidence links.
    const representedClasses = new Set(
      report.classifications
        .filter(
          (c) => c.outcome === "failure" && c.failureClass !== "unclassified",
        )
        .map((c) => c.failureClass),
    )
    assert.equal(report.proposals.length, representedClasses.size)
    for (const proposal of report.proposals) {
      assert.ok(representedClasses.has(proposal.failureClass))
      assert.ok(proposal.episodeIds.length >= 1, "proposal cites episodes")
      assert.ok(proposal.evidence.length >= 1, "proposal carries evidence")
      assert.ok(proposal.suggestion.length > 0)
    }
    // Proposals only for classes that actually occurred (no manufactured ones).
    assert.ok(
      report.proposals.every((p) => FAILURE_CLASSES.includes(p.failureClass)),
    )
    assert.ok(
      !report.proposals.some((p) => p.failureClass === "infrastructure"),
    )

    // The functional-false failure carries a transcript line-ref (tool-error signal).
    const validation = report.proposals.find(
      (p) => p.failureClass === "validation-or-proof",
    )
    assert.ok(validation)
    assert.ok(
      validation.evidence.some(
        (ref) => ref.transcript !== null && ref.lines.length > 0,
      ),
      "validation proposal cites an event line ref",
    )

    // Determinism: generation date is the newest episode completedAt, not the clock.
    assert.equal(report.generatedFromEpisodeDate, "2026-07-15T10:25:00.000Z")

    // Mandatory banner is present in the rendered document.
    const markdown = renderAdaptReportMarkdown(report)
    assert.ok(markdown.includes(PROPOSALS_ONLY_BANNER))
    assert.ok(
      markdown.includes("Failure-class → adaptation reference (all 13)"),
    )
  })
})

test("buildAdaptReport is deterministic: two runs render byte-identically", async () => {
  await withTempRepo(async (repoRoot) => {
    await writeSyntheticRun({
      model: "test-model",
      repoRoot,
      runId: "mini-001",
      specs: multiClassSpecs(),
    })
    const first = renderAdaptReportMarkdown(
      await buildAdaptReport({ repoRoot, runIds: ["mini-001"] }),
    )
    const second = renderAdaptReportMarkdown(
      await buildAdaptReport({ repoRoot, runIds: ["mini-001"] }),
    )
    assert.equal(first, second)
  })
})

test("buildAdaptReport handles a zero-failure run without proposals or divide-by-zero", async () => {
  await withTempRepo(async (repoRoot) => {
    await writeSyntheticRun({
      model: "test-model",
      repoRoot,
      runId: "clean-001",
      specs: [
        {
          completedAt: "2026-07-15T11:00:00.000Z",
          grade: {
            agreement: true,
            functional: true,
            notes: [],
            regression: true,
            scope: true,
          },
          system: "direct",
          taskId: "task-a",
          terminalState: "verified_success",
          tools: ["Bash", "Read"],
          rep: 1,
        },
        {
          completedAt: "2026-07-15T11:05:00.000Z",
          grade: {
            agreement: true,
            functional: true,
            notes: [],
            regression: true,
            scope: true,
          },
          system: "loop",
          taskId: "task-a",
          terminalState: "verified_success",
          tools: ["Bash", "Read", "Edit"],
          rep: 1,
        },
      ],
    })
    const report = await buildAdaptReport({ repoRoot, runIds: ["clean-001"] })
    assert.equal(report.totals.failures, 0)
    assert.equal(report.proposals.length, 0)
    assert.equal(
      report.classifications.every((c) => c.outcome === "success"),
      true,
    )
    // Aggregation success rate is a clean 100%, never NaN.
    assert.ok(report.aggregation.every((row) => row.successRate === 1))
    // Diversity still computes across the two comparable episodes.
    assert.equal(report.diversity.corpus.episodeCount, 2)
    const markdown = renderAdaptReportMarkdown(report)
    assert.ok(markdown.includes("No unsuccessful episodes"))
  })
})

test("buildAdaptReport records a missing run instead of throwing", async () => {
  await withTempRepo(async (repoRoot) => {
    const report = await buildAdaptReport({
      repoRoot,
      runIds: ["does-not-exist"],
    })
    assert.deepEqual(report.missingRuns, ["does-not-exist"])
    assert.equal(report.totals.episodes, 0)
    assert.equal(report.proposals.length, 0)
    // Renders without crashing on an empty corpus.
    const markdown = renderAdaptReportMarkdown(report)
    assert.ok(markdown.includes(PROPOSALS_ONLY_BANNER))
  })
})

test("buildAdaptReport enriches failures with audit-module signals", async () => {
  // A Bash call whose tool_result reports "command not found" -> exit-127 audit
  // signal (the sibling audit module's validation-hook family).
  const exit127Transcript =
    [
      JSON.stringify({ type: "system", subtype: "init" }),
      JSON.stringify({
        type: "assistant",
        message: {
          content: [
            {
              type: "tool_use",
              id: "t0",
              name: "Bash",
              input: { command: "programmers-loop --version" },
            },
          ],
        },
      }),
      JSON.stringify({
        type: "user",
        message: {
          content: [
            {
              type: "tool_result",
              tool_use_id: "t0",
              is_error: true,
              content: "zsh: command not found: programmers-loop",
            },
          ],
        },
      }),
      JSON.stringify({ type: "result", subtype: "success", is_error: false }),
    ].join("\n") + "\n"

  await withTempRepo(async (repoRoot) => {
    await writeSyntheticRun({
      model: "test-model",
      repoRoot,
      runId: "audit-001",
      specs: [
        {
          completedAt: "2026-07-15T12:00:00.000Z",
          grade: {
            agreement: true,
            functional: false,
            notes: [],
            regression: true,
            scope: true,
          },
          rawTranscript: exit127Transcript,
          system: "direct",
          taskId: "task-x",
          terminalState: "verified_failure",
          tools: ["Bash"],
          rep: 1,
        },
      ],
    })
    const report = await buildAdaptReport({ repoRoot, runIds: ["audit-001"] })

    const failure = report.classifications.find((c) => c.outcome === "failure")
    assert.ok(failure)
    assert.ok(
      failure.auditSignals.some((signal) => signal.kind === "exit-127"),
      "classification carries the exit-127 audit signal",
    )
    assert.equal(report.totals.byAuditSignal["exit-127"], 1)

    const proposal = report.proposals.find(
      (p) => p.failureClass === "validation-or-proof",
    )
    assert.ok(proposal)
    assert.ok(
      proposal.evidence.some((ref) => ref.detail.includes("audit exit-127")),
      "proposal evidence cites the audit signal",
    )
    const markdown = renderAdaptReportMarkdown(report)
    assert.ok(markdown.includes("Audit signals: exit-127:1"))
  })
})

// ---------------------------------------------------------------------------
// Real-data smoke test (read-only)
// ---------------------------------------------------------------------------

test("buildAdaptReport runs against the real smoke-003 records", async () => {
  const report = await buildAdaptReport({
    repoRoot: REAL_REPO_ROOT,
    runIds: ["smoke-003"],
  })
  assert.equal(report.runIds[0], "smoke-003")
  assert.equal(report.totals.episodes, 8)
  // smoke-003 has exactly one failure: smoke-retry-flag-direct-r2 (scope=false).
  assert.equal(report.totals.failures, 1)
  const failure = report.classifications.find((c) => c.outcome === "failure")
  assert.equal(failure?.episodeId, "smoke-retry-flag-direct-r2")
  assert.equal(failure?.failureClass, "regression-or-scope")
  assert.equal(report.proposals.length, 1)
  assert.equal(report.proposals[0]?.failureClass, "regression-or-scope")
  // The diverse task shows materially higher tool-sequence diversity.
  const retryFlag = report.diversity.perTask.find(
    (t) => t.taskId === "smoke-retry-flag",
  )
  const jsonLines = report.diversity.perTask.find(
    (t) => t.taskId === "smoke-json-lines",
  )
  assert.ok(retryFlag && jsonLines)
  assert.ok((retryFlag.meanDistance ?? 0) > (jsonLines.meanDistance ?? 0))
})
