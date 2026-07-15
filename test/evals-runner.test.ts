import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import {
  access,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import test from "node:test"

import type {
  AgentAdapter,
  AgentRunRequest,
  AgentRunResult,
  AgentUsage,
} from "../src/agents/types.js"
import type { ProgrammersLoopConfig } from "../src/config.js"
import { lintExecPlan } from "../src/contracts/exec-plan.js"
import { gradeEpisode, gradeExitCode } from "../src/evals/grade.js"
import {
  EVAL_GITIGNORE,
  gitStatusPorcelain,
  mergeEvalGitignore,
  prepareSandbox,
  runDirectHarness,
  runLoopHarness,
  type RoutedPhaseRecord,
} from "../src/evals/harnesses.js"
import {
  BUDGET_SEMANTICS_VERSION,
  buildManifest,
  computeEpisodeId,
  readEpisodeRecord,
  readManifest,
  type RunConfigInputs,
} from "../src/evals/manifest.js"
import { planEvalRun, runEvalRun } from "../src/evals/runner.js"
import { loadTaskPackage, type TaskPackage } from "../src/evals/task-package.js"
import { makeExecPlanReady } from "./planning-fixtures.js"

const REAL_TASKS = path.resolve(import.meta.dirname, "..", "evals", "tasks")

const config: ProgrammersLoopConfig = {
  schemaVersion: 1,
  planningRoot: "docs/assignments",
  agent: {
    adapter: "claude",
    command: "claude",
    maxOutputBytes: 65_536,
    model: null,
    profile: null,
    runTimeoutMs: 30_000,
  },
  github: { repository: null },
  proof: {
    allowedCommandPrefixes: ["node --test"],
    commandTimeoutMs: 30_000,
    maxOutputBytes: 65_536,
  },
}

// The known-correct fix and the false-completion naive fix, mirrored from the
// task-package fixture so the runner is exercised against real acceptance.
const CORRECT_FIX = String.raw`export function parseJsonLines(text) {
  return text
    .split("\n")
    .map((line) => (line.endsWith("\r") ? line.slice(0, -1) : line))
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line))
}

export function stringifyJsonLines(records) {
  return records.map((record) => JSON.stringify(record)).join("\n")
}
`

const NAIVE_FIX = String.raw`export function parseJsonLines(text) {
  if (text === "") return []
  const records = []
  for (const line of text.split(/\n+/)) {
    try {
      records.push(JSON.parse(line))
    } catch {
      // Skip lines that fail to parse.
    }
  }
  return records
}

export function stringifyJsonLines(records) {
  return records.map((record) => JSON.stringify(record)).join("\n")
}
`

function usage(): AgentUsage {
  return {
    authMode: "api-key",
    cachedInputTokens: null,
    costUsd: null,
    inputTokens: 100,
    modelCalls: 1,
    outputTokens: 50,
    reasoningTokens: null,
    toolCalls: 1,
  }
}

function baseResult(over: Partial<AgentRunResult>): AgentRunResult {
  return {
    events: [],
    eventsPath: null,
    exitCode: 0,
    lastMessage: "done",
    stderr: "",
    stderrTruncated: false,
    timedOut: false,
    usage: null,
    ...over,
  }
}

type MockBehavior = (
  request: AgentRunRequest,
) => Promise<AgentRunResult> | AgentRunResult

class MockAdapter implements AgentAdapter {
  readonly id = "mock"
  calls = 0
  requests: AgentRunRequest[] = []

  constructor(private readonly behavior: MockBehavior) {}

  async doctor() {
    return { available: true, detail: "mock" }
  }

  async run(request: AgentRunRequest): Promise<AgentRunResult> {
    this.calls += 1
    this.requests.push(request)
    return this.behavior(request)
  }
}

/** Mock that writes a json-lines fix into the sandbox and finishes cleanly. */
function writingBehavior(fix: string): MockBehavior {
  return async (request) => {
    await writeFile(path.join(request.cwd, "json-lines.mjs"), fix)
    return baseResult({ usage: usage() })
  }
}

async function newRepo(taskNames: string[]): Promise<string> {
  const repoRoot = await mkdtemp(path.join(tmpdir(), "evals-runner-"))
  const tasksDir = path.join(repoRoot, "tasks")
  await mkdir(tasksDir)
  for (const name of taskNames) {
    await cp(path.join(REAL_TASKS, name), path.join(tasksDir, name), {
      recursive: true,
    })
  }
  return repoRoot
}

test("direct episode grades a real sandbox: correct fix passes, naive fix fails", async () => {
  for (const scenario of [
    { fix: CORRECT_FIX, functional: true, state: "verified_success" },
    { fix: NAIVE_FIX, functional: false, state: "verified_failure" },
  ]) {
    const repoRoot = await newRepo(["smoke-json-lines"])
    try {
      const mock = new MockAdapter(writingBehavior(scenario.fix))
      const summary = await runEvalRun({
        adapter: mock,
        config,
        repoRoot,
        reps: 1,
        runId: "direct-grade",
        systems: ["direct"],
        tasksDir: "tasks",
      })
      assert.equal(mock.calls, 1)
      assert.equal(summary.executed, 1)
      assert.equal(summary.episodes[0]?.terminalState, scenario.state)

      const record = await readEpisodeRecord({
        episodeId: "smoke-json-lines-direct-r1",
        repoRoot,
        runId: "direct-grade",
      })
      assert.ok(record, "expected a durable episode record")
      assert.equal(record.terminalState, scenario.state)
      assert.equal(record.grade?.functional, scenario.functional)
      assert.equal(record.grade?.regression, true)
      assert.equal(record.grade?.scope, true)
      assert.equal(record.grade?.agreement, true)
      // Usage rollup is preserved from the agent run.
      assert.equal(record.usage?.inputTokens, 100)
      assert.equal(record.usage?.authMode, "api-key")
      // The direct prompt carries the symmetric no-human preamble.
      assert.match(
        mock.requests[0]?.prompt ?? "",
        /No human operator is available/,
      )
      assert.equal(mock.requests[0]?.sandbox, "workspace-write")
    } finally {
      await rm(repoRoot, { force: true, recursive: true })
    }
  }
})

test("a timed-out direct run maps to the timeout terminal state without grading", async () => {
  const repoRoot = await newRepo(["smoke-json-lines"])
  try {
    const mock = new MockAdapter(() =>
      baseResult({ exitCode: 143, timedOut: true, usage: usage() }),
    )
    const summary = await runEvalRun({
      adapter: mock,
      config,
      repoRoot,
      reps: 1,
      runId: "timeout-run",
      systems: ["direct"],
      tasksDir: "tasks",
    })
    assert.equal(mock.calls, 1)
    assert.equal(summary.episodes[0]?.terminalState, "timeout")
    const record = await readEpisodeRecord({
      episodeId: "smoke-json-lines-direct-r1",
      repoRoot,
      runId: "timeout-run",
    })
    assert.equal(record?.terminalState, "timeout")
    assert.equal(record?.grade, null)
  } finally {
    await rm(repoRoot, { force: true, recursive: true })
  }
})

test("resuming a run skips episodes that already have a terminal record", async () => {
  const repoRoot = await newRepo(["smoke-json-lines"])
  try {
    const first = new MockAdapter(writingBehavior(CORRECT_FIX))
    const firstSummary = await runEvalRun({
      adapter: first,
      config,
      repoRoot,
      reps: 1,
      runId: "resume-run",
      systems: ["direct"],
      tasksDir: "tasks",
    })
    assert.equal(firstSummary.executed, 1)
    assert.equal(first.calls, 1)

    const second = new MockAdapter(writingBehavior(CORRECT_FIX))
    const secondSummary = await runEvalRun({
      adapter: second,
      config,
      repoRoot,
      reps: 1,
      runId: "resume-run",
      systems: ["direct"],
      tasksDir: "tasks",
    })
    assert.equal(second.calls, 0, "resume must not call the adapter again")
    assert.equal(secondSummary.executed, 0)
    assert.equal(secondSummary.skipped, 1)
    assert.equal(secondSummary.episodes[0]?.terminalState, "verified_success")
  } finally {
    await rm(repoRoot, { force: true, recursive: true })
  }
})

async function buildStubGrader(source: string): Promise<TaskPackage> {
  const dir = await mkdtemp(path.join(tmpdir(), "stub-grader-"))
  await mkdir(path.join(dir, "graders"))
  await writeFile(path.join(dir, "graders", "grade.mjs"), source)
  return {
    budgets: { maxPhases: 3, maxTurns: 10, maxWallMs: 60_000 },
    dir,
    expectedStratum: null,
    grader: { command: ["graders/grade.mjs"], timeoutMs: 10_000 },
    id: "stub",
    provenance: {
      canary: "00000000-0000-4000-8000-000000000000",
      contaminationNotes: "stub",
      source: "synthetic-public",
    },
    request: "stub",
    schemaVersion: 1,
    scope: { allowedPaths: ["*"], forbiddenPaths: [] },
    setupCommand: null,
    title: "stub",
    toolPolicy: { network: "deny" },
    version: 1,
    workflowShape: "skip",
  }
}

// Flips its functional verdict between consecutive process invocations via a
// state file next to itself, so the runner's double-run disagreement guard
// fires deterministically.
const NONDETERMINISTIC_GRADER = String.raw`import { existsSync, writeFileSync } from "node:fs"
const stateFile = new URL("./state.tmp", import.meta.url)
const seen = existsSync(stateFile)
if (!seen) writeFileSync(stateFile, "x")
const functional = !seen
process.stdout.write(
  JSON.stringify({ functional, regression: true, scope: true, notes: ["toggle"] }) + "\n",
)
process.exitCode = functional ? 0 : 1
`

const DETERMINISTIC_GRADER = String.raw`process.stdout.write(
  JSON.stringify({ functional: true, regression: true, scope: true, notes: [] }) + "\n",
)
process.exitCode = 0
`

test("a grader that disagrees across the double run is an infrastructure failure", async () => {
  const sandbox = await mkdtemp(path.join(tmpdir(), "stub-sandbox-"))
  const pkg = await buildStubGrader(NONDETERMINISTIC_GRADER)
  try {
    const outcome = await gradeEpisode({
      maxOutputBytes: 65_536,
      pkg,
      sandboxDir: sandbox,
    })
    assert.equal(outcome.terminalState, "infrastructure_failure")
    assert.equal(outcome.grade?.agreement, false)
    assert.ok(
      outcome.auditNotes.some((note) => note.includes("disagreed")),
      outcome.auditNotes.join(" | "),
    )
  } finally {
    await rm(sandbox, { force: true, recursive: true })
    await rm(pkg.dir, { force: true, recursive: true })
  }
})

test("a deterministic grader that agrees yields verified success", async () => {
  const sandbox = await mkdtemp(path.join(tmpdir(), "stub-sandbox-"))
  const pkg = await buildStubGrader(DETERMINISTIC_GRADER)
  try {
    const outcome = await gradeEpisode({
      maxOutputBytes: 65_536,
      pkg,
      sandboxDir: sandbox,
    })
    assert.equal(outcome.terminalState, "verified_success")
    assert.equal(outcome.grade?.agreement, true)
  } finally {
    await rm(sandbox, { force: true, recursive: true })
    await rm(pkg.dir, { force: true, recursive: true })
  }
})

test("manifest construction is deterministic and seeds are pure", () => {
  const configInputs: RunConfigInputs = {
    adapterId: "mock",
    model: null,
    reasoningEffort: null,
    promptDirHash: "abc123",
    repoGitSha: null,
  }
  const params = {
    baseSeed: 1,
    configInputs,
    reps: 2,
    runId: "det",
    systems: ["direct", "loop"] as const,
    taskIds: ["alpha", "beta"],
    tasksDir: "tasks",
  }
  const first = buildManifest({ ...params, systems: [...params.systems] })
  const second = buildManifest({ ...params, systems: [...params.systems] })
  assert.deepEqual(first, second)
  assert.equal(first.episodes.length, 8)
  assert.equal(
    first.episodes[0]?.episodeId,
    computeEpisodeId("alpha", "direct", 1),
  )
  // Seeds are baseSeed + ordinal index, in matrix order.
  assert.deepEqual(
    first.episodes.map((episode) => episode.seed),
    [1, 2, 3, 4, 5, 6, 7, 8],
  )
})

test("planEvalRun is deterministic across repeated calls", async () => {
  const repoRoot = await newRepo(["smoke-json-lines", "smoke-retry-flag"])
  try {
    const request = {
      config,
      repoRoot,
      reps: 3,
      runId: "plan-det",
      systems: ["direct", "loop"] as const,
      tasksDir: "tasks",
    }
    const first = await planEvalRun({
      ...request,
      systems: [...request.systems],
    })
    const second = await planEvalRun({
      ...request,
      systems: [...request.systems],
    })
    assert.deepEqual(first.episodes, second.episodes)
    assert.equal(first.configHash, second.configHash)
    assert.equal(first.episodes.length, 12)
  } finally {
    await rm(repoRoot, { force: true, recursive: true })
  }
})

test("reasoning effort is a frozen manifest input and changes the config hash", () => {
  const base: RunConfigInputs = {
    adapterId: "codex",
    model: "gpt-5.6-terra",
    reasoningEffort: "high",
    promptDirHash: "abc123",
    repoGitSha: "sha",
  }
  const params = {
    baseSeed: 1,
    reps: 1,
    runId: "effort",
    taskIds: ["alpha"],
    tasksDir: "tasks",
  }
  const high = buildManifest({
    ...params,
    systems: ["direct"],
    configInputs: base,
  })
  const low = buildManifest({
    ...params,
    systems: ["direct"],
    configInputs: { ...base, reasoningEffort: "low" },
  })
  const nulled = buildManifest({
    ...params,
    systems: ["direct"],
    configInputs: { ...base, reasoningEffort: null },
  })
  // Effort survives onto the frozen inputs (D3 is part of model identity)...
  assert.equal(high.configInputs.reasoningEffort, "high")
  // ...and any change to it makes episodes non-comparable via the hash.
  assert.notEqual(high.configHash, low.configHash)
  assert.notEqual(high.configHash, nulled.configHash)
})

test("planEvalRun threads reasoning effort from config into the manifest", async () => {
  const repoRoot = await newRepo(["smoke-json-lines"])
  try {
    const manifest = await planEvalRun({
      config: {
        ...config,
        agent: { ...config.agent, reasoningEffort: "high" },
      },
      repoRoot,
      reps: 1,
      runId: "effort-plan",
      systems: ["direct"],
      tasksDir: "tasks",
    })
    assert.equal(manifest.configInputs.reasoningEffort, "high")
  } finally {
    await rm(repoRoot, { force: true, recursive: true })
  }
})

test("a failed loop phase still contributes its receipt and usage to the episode record", async () => {
  // smoke-retry-flag is workflow_shape "exec-plan", so the loop harness drives
  // the write -> grill -> execute spine (the skip-shaped smoke-json-lines would
  // route to a single direct-style run instead).
  const repoRoot = await newRepo(["smoke-retry-flag"])
  try {
    const mock = new MockAdapter(async (request) => {
      if (request.prompt.startsWith("# Write an ExecPlan")) {
        const planPath =
          /<target_execplan_path>\n([^\n]+)\n<\/target_execplan_path>/.exec(
            request.prompt,
          )?.[1]
        assert.ok(planPath, "write prompt must carry the plan path")
        await makeExecPlanReady({ planPath, repoRoot: request.cwd })
        return baseResult({ usage: usage() })
      }
      if (request.prompt.startsWith("# Grill an ExecPlan")) {
        return baseResult({
          lastMessage: "AUTOMATION_STATUS: complete\nAUTOMATION_REPLY: none",
          usage: usage(),
        })
      }
      // Execute: the inner agent fails after consuming real tokens.
      return baseResult({
        exitCode: 1,
        stderr: "inner agent crashed",
        usage: usage(),
      })
    })
    const summary = await runEvalRun({
      adapter: mock,
      config,
      repoRoot,
      reps: 1,
      runId: "failed-phase-usage",
      systems: ["loop"],
      tasksDir: "tasks",
    })
    assert.equal(mock.calls, 3)
    assert.equal(summary.episodes[0]?.terminalState, "harness_failure")

    const record = await readEpisodeRecord({
      episodeId: "smoke-retry-flag-loop-r1",
      repoRoot,
      runId: "failed-phase-usage",
    })
    assert.ok(record, "expected a durable episode record")
    // The failed execute phase is present with its persisted receipt path.
    assert.deepEqual(
      record.harness.phases.map((phase) => phase.phase),
      ["write", "grill", "execute"],
    )
    // Every spine phase is tagged with the exec-plan route.
    assert.equal(
      (record.harness.phases[0] as RoutedPhaseRecord).routeTaken,
      "exec-plan",
    )
    const failed = record.harness.phases[2]
    assert.equal(failed?.status, "failed")
    assert.ok(failed?.receiptPath, "failed phase must record its receipt path")
    assert.ok(
      record.harness.notes.some((note) => note.includes("execute phase threw")),
      record.harness.notes.join(" | "),
    )
    // Usage from every attempted phase is rolled up, including the failure.
    assert.equal(record.usage?.inputTokens, 300)
    assert.equal(record.usage?.outputTokens, 150)
    assert.equal(record.usage?.modelCalls, 3)
  } finally {
    await rm(repoRoot, { force: true, recursive: true })
  }
})

/**
 * Drive the exec-plan loop's grill through a controlled number of automatic
 * reply rounds. `write` makes the scaffolded plan ready; each `grill` round
 * returns a well-formed footer carrying a concrete recommended reply (never
 * "none"), converging to `complete` after `convergeOn` rounds; `execute` is a
 * stub failure so the terminal reflects only whether grill survived its budget.
 */
async function runGrillRounds(params: { convergeOn: number | null }): Promise<{
  disposition: string
  grillRounds: number
  grillStatus?: string
}> {
  const repoRoot = await newRepo(["smoke-retry-flag"])
  const loaded = await loadTaskPackage(
    path.join(REAL_TASKS, "smoke-retry-flag"),
  )
  assert.ok(loaded.pkg, "expected a valid smoke task package")
  const sandboxDir = path.join(repoRoot, "sandbox")
  try {
    const prepared = await prepareSandbox({
      config,
      pkg: loaded.pkg,
      sandboxDir,
      system: "loop",
    })
    assert.ok(prepared.planPath, "loop prep must scaffold an ExecPlan")
    let grillRounds = 0
    const mock = new MockAdapter(async (request) => {
      if (request.prompt.startsWith("# Write an ExecPlan")) {
        const planPath =
          /<target_execplan_path>\n([^\n]+)\n<\/target_execplan_path>/.exec(
            request.prompt,
          )?.[1]
        assert.ok(planPath, "write prompt must carry the plan path")
        await makeExecPlanReady({ planPath, repoRoot: request.cwd })
        return baseResult({ usage: usage() })
      }
      if (request.prompt.startsWith("# Grill an ExecPlan")) {
        grillRounds += 1
        const done =
          params.convergeOn !== null && grillRounds >= params.convergeOn
        return baseResult({
          // A session id is required for the reply loop to continue past round 1.
          sessionId: "grill-sess",
          lastMessage: done
            ? "AUTOMATION_STATUS: complete\nAUTOMATION_REPLY: none"
            : "AUTOMATION_STATUS: question\nAUTOMATION_REPLY: Proceed with the defensible default and record it.",
          usage: usage(),
        })
      }
      // execute: stub failure so a converged grill yields harness_failure, not a
      // slow real grade — the terminal isolates grill-budget behavior.
      return baseResult({ exitCode: 1, stderr: "execute stub", usage: usage() })
    })
    const outcome = await runLoopHarness({
      adapter: mock,
      config,
      pkg: loaded.pkg,
      planPath: prepared.planPath,
      sandboxDir,
    })
    return {
      disposition: outcome.disposition,
      grillRounds,
      grillStatus: outcome.phases.find((phase) => phase.phase === "grill")
        ?.status,
    }
  } finally {
    await rm(repoRoot, { force: true, recursive: true })
  }
}

test("grill converging after >2 reply rounds no longer owner-blocks", async () => {
  // The regression: LOOP_MAX_GRILL_ROUNDS was 2, so a grill needing a third
  // clarification exhausted its budget and terminated owner_blocked even though
  // every round self-answered (codex-dryrun-001 smoke-retry-flag-loop-r1). With
  // the budget aligned to the workflow default (5), a productive loop converges.
  const result = await runGrillRounds({ convergeOn: 3 })
  assert.equal(result.grillRounds, 3, "grill must run its third reply round")
  assert.equal(result.grillStatus, "completed", "grill must reach complete")
  assert.notEqual(result.disposition, "owner_blocked")
})

test("a grill that never converges still exhausts the budget and owner-blocks", async () => {
  // Semantics preserved: a grill that keeps asking (never `complete`) exhausts
  // the raised 5-round budget and is a genuine owner-question finding.
  const result = await runGrillRounds({ convergeOn: null })
  assert.equal(result.grillRounds, 5, "grill must exhaust the 5-round budget")
  assert.equal(result.disposition, "owner_blocked")
})

test("gradeExitCode distinguishes graded failure from grading-machinery failure", () => {
  assert.equal(gradeExitCode("verified_success"), 0)
  assert.equal(gradeExitCode("verified_failure"), 1)
  assert.equal(gradeExitCode("infrastructure_failure"), 3)
})

test("loop sandbox prep scaffolds a lint-valid ExecPlan and leaves git clean", async () => {
  const repoRoot = await mkdtemp(path.join(tmpdir(), "loop-prep-"))
  const loaded = await loadTaskPackage(
    path.join(REAL_TASKS, "smoke-retry-flag"),
  )
  assert.ok(loaded.pkg, "expected a valid smoke task package")
  const sandboxDir = path.join(repoRoot, "sandbox")
  try {
    const prepared = await prepareSandbox({
      config,
      pkg: loaded.pkg,
      sandboxDir,
      system: "loop",
    })
    assert.ok(prepared.planPath, "loop prep must scaffold an ExecPlan")
    assert.match(
      prepared.planPath,
      /^docs\/assignments\/active\/.*\/exec-plans\/active\/.*\.md$/,
    )
    // Planning artifacts and .runtime are gitignored, so the baseline commit is
    // clean: the grader will only ever see the agent's real edits.
    assert.equal(await gitStatusPorcelain(sandboxDir), "")
    // The scaffolded plan binds structurally to the sandbox repo root.
    const issues = await lintExecPlan({
      planPath: path.resolve(sandboxDir, prepared.planPath),
      repoRoot: sandboxDir,
    })
    assert.deepEqual(issues, [])
  } finally {
    await rm(repoRoot, { force: true, recursive: true })
  }
})

test("a skip-shape task routes to a single direct-style run under the loop system", async () => {
  // smoke-json-lines declares workflow_shape "skip", so the loop harness must
  // bypass the planning spine: one workspace-write agent call, mechanically
  // identical to the direct baseline, reachable through the real hidden grader.
  const repoRoot = await newRepo(["smoke-json-lines"])
  try {
    const mock = new MockAdapter(writingBehavior(CORRECT_FIX))
    const summary = await runEvalRun({
      adapter: mock,
      config,
      repoRoot,
      reps: 1,
      runId: "loop-skip",
      systems: ["loop"],
      tasksDir: "tasks",
    })
    // Exactly one agent call, versus the four-phase spine the exec-plan route
    // would run.
    assert.equal(mock.calls, 1)
    assert.equal(summary.episodes[0]?.terminalState, "verified_success")

    const record = await readEpisodeRecord({
      episodeId: "smoke-json-lines-loop-r1",
      repoRoot,
      runId: "loop-skip",
    })
    assert.ok(record, "expected a durable episode record")
    assert.equal(record.harness.system, "loop")
    assert.equal(record.terminalState, "verified_success")
    assert.equal(record.grade?.functional, true)
    // One phase, tagged with the skip route so analyses can tell it apart from
    // the exec-plan spine even though both score under the loop system.
    assert.equal(record.harness.phases.length, 1)
    assert.equal(
      (record.harness.phases[0] as RoutedPhaseRecord).routeTaken,
      "skip",
    )
    // Mechanically identical to the direct baseline: workspace-write sandbox and
    // the symmetric no-human preamble.
    assert.equal(mock.requests[0]?.sandbox, "workspace-write")
    assert.match(
      mock.requests[0]?.prompt ?? "",
      /No human operator is available/,
    )
  } finally {
    await rm(repoRoot, { force: true, recursive: true })
  }
})

test("a program-shape task is rejected as a harness failure before any agent runs", async () => {
  // "program" is 0.2 scope; the loop harness must reject it cleanly without
  // spending an agent call.
  const pkg: TaskPackage = {
    ...(await buildStubGrader(DETERMINISTIC_GRADER)),
    workflowShape: "program",
  }
  const mock = new MockAdapter(() => {
    throw new Error("adapter must not run for an unsupported program shape")
  })
  try {
    const outcome = await runLoopHarness({
      adapter: mock,
      config,
      pkg,
      planPath: "docs/assignments/unused.md",
      sandboxDir: pkg.dir,
    })
    assert.equal(outcome.disposition, "harness_failure")
    assert.equal(mock.calls, 0)
    assert.deepEqual(outcome.phases, [])
    assert.equal(outcome.usage, null)
    assert.match(outcome.notes.join(" "), /program/)
  } finally {
    await rm(pkg.dir, { force: true, recursive: true })
  }
})

test("mergeEvalGitignore appends eval entries without clobbering the workspace's", () => {
  // No workspace .gitignore: the eval entries stand alone.
  assert.equal(mergeEvalGitignore(null), EVAL_GITIGNORE)
  assert.equal(mergeEvalGitignore(""), EVAL_GITIGNORE)
  // A workspace ignore (most damagingly node_modules/ for install-needing
  // tasks) survives byte-intact at the top, with the eval entries appended.
  const merged = mergeEvalGitignore("node_modules/\ndist/\n")
  assert.ok(merged.startsWith("node_modules/\ndist/\n"))
  for (const entry of [".runtime/", "/docs/assignments/", "/docs/contracts/"]) {
    assert.ok(merged.includes(`${entry}\n`), `merged must contain ${entry}`)
  }
  // Entries the workspace already lists are not repeated.
  const deduped = mergeEvalGitignore("node_modules/\n.runtime/\n")
  assert.equal(deduped.split("\n").filter((l) => l === ".runtime/").length, 1)
})

/** Copy a smoke task into the repo and declare a setup_command on it. */
async function setTaskSetupCommand(
  repoRoot: string,
  taskId: string,
  command: string,
): Promise<void> {
  const manifestPath = path.join(repoRoot, "tasks", taskId, "task.yaml")
  const source = await readFile(manifestPath, "utf8")
  assert.ok(source.includes("setup_command: null"))
  await writeFile(
    manifestPath,
    source.replace(
      "setup_command: null",
      `setup_command: ${JSON.stringify(command)}`,
    ),
    "utf8",
  )
}

const SETUP_INSTALL_LIKE =
  "node -e \"const fs=require('node:fs');fs.mkdirSync('node_modules',{recursive:true});fs.writeFileSync('node_modules/marker.txt','x');fs.writeFileSync('setup-artifact.txt','from-setup')\""

test("prepareSandbox runs setup_command before the baseline commit with a merged gitignore", async () => {
  const repoRoot = await newRepo(["smoke-json-lines"])
  try {
    // The workspace ships its own .gitignore, as real install-needing tasks do.
    await writeFile(
      path.join(
        repoRoot,
        "tasks",
        "smoke-json-lines",
        "workspace",
        ".gitignore",
      ),
      "node_modules/\n",
      "utf8",
    )
    await setTaskSetupCommand(repoRoot, "smoke-json-lines", SETUP_INSTALL_LIKE)
    const loaded = await loadTaskPackage(
      path.join(repoRoot, "tasks", "smoke-json-lines"),
    )
    assert.ok(loaded.pkg, loaded.issues.join(" | "))
    const sandboxDir = path.join(repoRoot, "sandbox")
    const prepared = await prepareSandbox({
      config,
      pkg: loaded.pkg,
      sandboxDir,
      system: "direct",
    })
    // Setup ran in the sandbox cwd and its evidence is returned.
    assert.ok(prepared.setup, "setup evidence must be recorded")
    assert.equal(prepared.setup.exitCode, 0)
    assert.equal(prepared.setup.timedOut, false)
    assert.equal(prepared.setup.networkCarveOut, true)
    assert.equal(prepared.setup.command, SETUP_INSTALL_LIKE)
    await readFile(path.join(sandboxDir, "setup-artifact.txt"), "utf8")
    await readFile(path.join(sandboxDir, "node_modules", "marker.txt"), "utf8")
    // The workspace's own ignore survives alongside the eval entries.
    const gitignore = await readFile(
      path.join(sandboxDir, ".gitignore"),
      "utf8",
    )
    assert.ok(gitignore.startsWith("node_modules/\n"))
    assert.ok(gitignore.includes(".runtime/\n"))
    // Setup outputs never dirty the agent's diff: the install dir is ignored
    // and the tracked artifact was absorbed into the baseline commit.
    assert.equal(await gitStatusPorcelain(sandboxDir), "")
  } finally {
    await rm(repoRoot, { force: true, recursive: true })
  }
})

test("an episode records its successful setup_command run", async () => {
  const repoRoot = await newRepo(["smoke-json-lines"])
  try {
    await setTaskSetupCommand(
      repoRoot,
      "smoke-json-lines",
      "node -e \"require('node:fs').mkdirSync('node_modules',{recursive:true})\"",
    )
    const mock = new MockAdapter(writingBehavior(CORRECT_FIX))
    const summary = await runEvalRun({
      adapter: mock,
      config,
      repoRoot,
      reps: 1,
      runId: "setup-ok",
      systems: ["direct"],
      tasksDir: "tasks",
    })
    assert.equal(summary.episodes[0]?.terminalState, "verified_success")
    const record = await readEpisodeRecord({
      episodeId: "smoke-json-lines-direct-r1",
      repoRoot,
      runId: "setup-ok",
    })
    assert.ok(record?.setup, "episode record must carry the setup evidence")
    assert.equal(record.setup.exitCode, 0)
    assert.equal(record.setup.networkCarveOut, true)
    assert.ok(record.setup.wallMs >= 0)
  } finally {
    await rm(repoRoot, { force: true, recursive: true })
  }
})

test("a failing setup_command maps to infrastructure_failure before any agent call", async () => {
  const repoRoot = await newRepo(["smoke-json-lines"])
  try {
    await setTaskSetupCommand(
      repoRoot,
      "smoke-json-lines",
      'node -e "process.exit(3)"',
    )
    const mock = new MockAdapter(() => {
      throw new Error("adapter must not run when setup fails")
    })
    const summary = await runEvalRun({
      adapter: mock,
      config,
      repoRoot,
      reps: 1,
      runId: "setup-fail",
      systems: ["direct"],
      tasksDir: "tasks",
    })
    assert.equal(mock.calls, 0)
    assert.equal(summary.episodes[0]?.terminalState, "infrastructure_failure")
    const record = await readEpisodeRecord({
      episodeId: "smoke-json-lines-direct-r1",
      repoRoot,
      runId: "setup-fail",
    })
    assert.equal(record?.terminalState, "infrastructure_failure")
    // A broken setup is never a scored model result, but its evidence persists.
    assert.equal(record.setup?.exitCode, 3)
    assert.ok(
      record.harness.notes.some((note) =>
        note.includes("setup_command exited 3"),
      ),
      record.harness.notes.join(" | "),
    )
    assert.equal(record.grade, null)
  } finally {
    await rm(repoRoot, { force: true, recursive: true })
  }
})

// --- Cross-arm budget parity (GAP 1, issue #7 / defect E2) --------------------

/**
 * A mock driving the exec-plan spine deterministically: `write` makes the
 * scaffolded plan ready, `grill` converges on round 1, and `execute` fails so
 * the spine stops after write -> grill -> execute without needing a real
 * execute/validate completion. `onCall` fires on every agent call (used to
 * advance a fake wall clock).
 */
function execPlanSpineMock(onCall?: () => void): MockAdapter {
  return new MockAdapter(async (request) => {
    onCall?.()
    if (request.prompt.startsWith("# Write an ExecPlan")) {
      const planPath =
        /<target_execplan_path>\n([^\n]+)\n<\/target_execplan_path>/.exec(
          request.prompt,
        )?.[1]
      assert.ok(planPath, "write prompt must carry the plan path")
      await makeExecPlanReady({ planPath, repoRoot: request.cwd })
      return baseResult({ usage: usage() })
    }
    if (request.prompt.startsWith("# Grill an ExecPlan")) {
      return baseResult({
        lastMessage: "AUTOMATION_STATUS: complete\nAUTOMATION_REPLY: none",
        usage: usage(),
      })
    }
    return baseResult({ exitCode: 1, stderr: "execute stub", usage: usage() })
  })
}

/** Prepare a loop sandbox for the exec-plan-shaped retry-flag task. */
async function preparedRetryFlagLoop(repoRoot: string): Promise<{
  pkg: TaskPackage
  planPath: string
  sandboxDir: string
}> {
  const loaded = await loadTaskPackage(
    path.join(REAL_TASKS, "smoke-retry-flag"),
  )
  assert.ok(loaded.pkg, "expected a valid smoke task package")
  const sandboxDir = path.join(repoRoot, "sandbox")
  const prepared = await prepareSandbox({
    config,
    pkg: loaded.pkg,
    sandboxDir,
    system: "loop",
  })
  assert.ok(prepared.planPath, "loop prep must scaffold an ExecPlan")
  return { pkg: loaded.pkg, planPath: prepared.planPath, sandboxDir }
}

test("both arms cap agent turns at the task's max_turns (per-agent-call, defect E2)", async () => {
  const repoRoot = await newRepo(["smoke-json-lines", "smoke-retry-flag"])
  try {
    // Direct arm: the single agent call carries --max-turns from the budget.
    const direct = new MockAdapter(writingBehavior(CORRECT_FIX))
    const jsonLines = await loadTaskPackage(
      path.join(REAL_TASKS, "smoke-json-lines"),
    )
    assert.ok(jsonLines.pkg)
    const directSandbox = path.join(repoRoot, "direct-sandbox")
    await prepareSandbox({
      config,
      pkg: jsonLines.pkg,
      sandboxDir: directSandbox,
      system: "direct",
    })
    await runDirectHarness({
      adapter: direct,
      config,
      pkg: jsonLines.pkg,
      sandboxDir: directSandbox,
    })
    assert.equal(direct.requests[0]?.maxTurns, jsonLines.pkg.budgets.maxTurns)

    // Loop arm (exec-plan spine): every phase call carries the same cap, which
    // the workflow's runAgent never sets on its own.
    const { pkg, planPath, sandboxDir } = await preparedRetryFlagLoop(repoRoot)
    const loop = execPlanSpineMock()
    await runLoopHarness({ adapter: loop, config, pkg, planPath, sandboxDir })
    assert.ok(loop.requests.length >= 2, "spine must make multiple phase calls")
    for (const request of loop.requests) {
      assert.equal(request.maxTurns, pkg.budgets.maxTurns)
    }
  } finally {
    await rm(repoRoot, { force: true, recursive: true })
  }
})

test("the loop arm threads the per-episode wall remainder into each phase call", async () => {
  const repoRoot = await newRepo(["smoke-retry-flag"])
  try {
    const { pkg, planPath, sandboxDir } = await preparedRetryFlagLoop(repoRoot)
    const step = 1_000
    const maxWallMs = 100_000
    let fakeNow = 0
    const loop = execPlanSpineMock(() => {
      fakeNow += step
    })
    await runLoopHarness({
      adapter: loop,
      config,
      now: () => fakeNow,
      pkg: { ...pkg, budgets: { maxPhases: 5, maxTurns: 7, maxWallMs } },
      planPath,
      sandboxDir,
    })
    // write -> grill -> (failed) execute: three phase calls, each handed only
    // the wall budget remaining after the prior phases consumed their step.
    assert.equal(loop.requests.length, 3)
    assert.equal(loop.requests[0]?.timeoutMs, maxWallMs)
    assert.equal(loop.requests[1]?.timeoutMs, maxWallMs - step)
    assert.equal(loop.requests[2]?.timeoutMs, maxWallMs - 2 * step)
  } finally {
    await rm(repoRoot, { force: true, recursive: true })
  }
})

test("the loop arm terminates timeout once the cumulative wall budget is spent", async () => {
  const repoRoot = await newRepo(["smoke-retry-flag"])
  try {
    const { pkg, planPath, sandboxDir } = await preparedRetryFlagLoop(repoRoot)
    const step = 1_000
    // Budget is spent after write + grill consume two steps: the guard before
    // execute observes a non-positive remainder and terminates `timeout`,
    // distinct from the max_phases `budget_exhausted` ceiling (set high here).
    const maxWallMs = 1_500
    let fakeNow = 0
    const loop = execPlanSpineMock(() => {
      fakeNow += step
    })
    const outcome = await runLoopHarness({
      adapter: loop,
      config,
      now: () => fakeNow,
      pkg: { ...pkg, budgets: { maxPhases: 5, maxTurns: 7, maxWallMs } },
      planPath,
      sandboxDir,
    })
    assert.equal(outcome.disposition, "timeout")
    assert.deepEqual(
      outcome.phases.map((phase) => phase.phase),
      ["write", "grill"],
    )
    assert.ok(
      outcome.notes.some((note) => note.includes("exceeded max_wall_ms")),
      outcome.notes.join(" | "),
    )
  } finally {
    await rm(repoRoot, { force: true, recursive: true })
  }
})

test("episode record and manifest stamp the enforced caps, semantics, and identity", async () => {
  const repoRoot = await newRepo(["smoke-json-lines"])
  try {
    const mock = new MockAdapter(writingBehavior(CORRECT_FIX))
    await runEvalRun({
      adapter: mock,
      config,
      repoRoot,
      reps: 1,
      runId: "stamps",
      systems: ["direct"],
      tasksDir: "tasks",
    })
    const record = await readEpisodeRecord({
      episodeId: "smoke-json-lines-direct-r1",
      repoRoot,
      runId: "stamps",
    })
    assert.ok(record, "expected a durable episode record")
    // Enforced caps + cross-arm semantics.
    assert.equal(record.budget?.semanticsVersion, BUDGET_SEMANTICS_VERSION)
    assert.equal(record.budget?.maxWallMs, 900_000)
    assert.equal(record.budget?.maxTurns, 40)
    assert.equal(record.budget?.maxPhases, 3)
    assert.equal(record.budget?.wallScope, "per-episode-total")
    assert.equal(record.budget?.turnsScope, "per-agent-call")
    // Baseline identity: no Loop treatment, no AGENTS.md in this workspace.
    assert.equal(record.treatment?.loopCliShimPresent, false)
    assert.deepEqual(record.treatment?.injectedPaths, [])
    assert.deepEqual(record.agentsMdPaths, [])
    // Manifest stamps the semantics version and the pinned adapter identity.
    const manifest = await readManifest({ repoRoot, runId: "stamps" })
    assert.equal(manifest?.budgetSemanticsVersion, BUDGET_SEMANTICS_VERSION)
    assert.equal(manifest?.adapterVersion, "mock")
  } finally {
    await rm(repoRoot, { force: true, recursive: true })
  }
})

// --- Loop CLI shim materialization (GAP 2, issue #8) -------------------------

function spawnCommand(
  command: string,
  args: string[],
  cwd: string,
): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd })
    let out = ""
    child.stdout.on("data", (chunk) => (out += String(chunk)))
    child.stderr.on("data", (chunk) => (out += String(chunk)))
    child.on("close", (code) => resolve({ code: code ?? -1, out }))
    child.on("error", () => resolve({ code: -1, out }))
  })
}

test("the loop arm materializes a working programmers-loop shim; the direct arm does not", async () => {
  const repoRoot = await newRepo(["smoke-retry-flag"])
  const loaded = await loadTaskPackage(
    path.join(REAL_TASKS, "smoke-retry-flag"),
  )
  assert.ok(loaded.pkg, "expected a valid smoke task package")
  try {
    // Loop arm: the shim is placed, recorded, and actually runs the CLI.
    const loopSandbox = path.join(repoRoot, "loop-sandbox")
    const loop = await prepareSandbox({
      config,
      pkg: loaded.pkg,
      sandboxDir: loopSandbox,
      system: "loop",
    })
    assert.equal(loop.treatment.loopCliShimPresent, true)
    assert.ok(loop.treatment.loopCliShimPath, "shim path must be recorded")
    assert.equal(loop.treatment.loopCliTargetVersion, "0.0.0")
    // The injected treatment set is recorded, not just the shim (issue #8).
    assert.ok(
      loop.treatment.injectedPaths.includes(loop.treatment.loopCliShimPath),
    )
    assert.ok(
      loop.treatment.injectedPaths.includes("programmers-loop.config.yaml"),
    )
    const shimAbs = path.join(loopSandbox, loop.treatment.loopCliShimPath)
    await access(shimAbs)
    // Spawning the shim resolves the CLI (cwd = sandbox).
    const help = await spawnCommand(shimAbs, ["--help"], loopSandbox)
    assert.equal(help.code, 0, help.out)
    assert.match(help.out, /Programmers Loop/)

    // Direct arm: no shim file, and the record notes its absence.
    const directSandbox = path.join(repoRoot, "direct-sandbox")
    const direct = await prepareSandbox({
      config,
      pkg: loaded.pkg,
      sandboxDir: directSandbox,
      system: "direct",
    })
    assert.equal(direct.treatment.loopCliShimPresent, false)
    assert.equal(direct.shimBinDir, null)
    await assert.rejects(
      access(path.join(directSandbox, loop.treatment.loopCliShimPath)),
      "the direct sandbox must not carry the Loop CLI shim",
    )
  } finally {
    await rm(repoRoot, { force: true, recursive: true })
  }
})

test("a loop episode record persists the CLI shim treatment and budget caps", async () => {
  // smoke-json-lines is skip-shaped, but prepareSandbox materializes the loop
  // treatment for every loop episode, so the persisted record must carry it.
  const repoRoot = await newRepo(["smoke-json-lines"])
  try {
    const mock = new MockAdapter(writingBehavior(CORRECT_FIX))
    await runEvalRun({
      adapter: mock,
      config,
      repoRoot,
      reps: 1,
      runId: "loop-treatment",
      systems: ["loop"],
      tasksDir: "tasks",
    })
    const record = await readEpisodeRecord({
      episodeId: "smoke-json-lines-loop-r1",
      repoRoot,
      runId: "loop-treatment",
    })
    assert.ok(record, "expected a durable episode record")
    // GAP 2: the Loop treatment (shim + injected set) is recorded (issue #8).
    assert.equal(record.treatment?.loopCliShimPresent, true)
    assert.ok(record.treatment?.loopCliShimPath, "shim path must be recorded")
    assert.ok(
      record.treatment?.injectedPaths.includes("programmers-loop.config.yaml"),
    )
    // GAP 1: the loop arm records the same caps + semantics as the direct arm.
    assert.equal(record.budget?.semanticsVersion, BUDGET_SEMANTICS_VERSION)
    assert.equal(record.budget?.turnsScope, "per-agent-call")
    assert.equal(record.budget?.wallScope, "per-episode-total")
    // Host mode records the looser macOS posture (the audit fact for D11).
    assert.equal(record.sandbox?.mode, "host")
    assert.equal(record.sandbox?.imageDigest, null)
    assert.deepEqual(record.sandbox?.envForwarded, [])
  } finally {
    await rm(repoRoot, { force: true, recursive: true })
  }
})

// --- Container sandbox mode (ADR option i) -----------------------------------

/** The base config with a container sandbox posture layered on. */
const containerConfig: ProgrammersLoopConfig = {
  ...config,
  sandbox: {
    mode: "container",
    image: "loopbench-sandbox:pinned",
    network: "none",
    allowlist: [],
  },
}

test("a container direct episode records the machine-enforced posture honestly", async () => {
  // The injected mock stands in for the containerized adapter: it exercises the
  // runner's record/gate wiring offline (no Docker daemon, no model call). A real
  // run swaps the mock for a container-launcher-backed adapter via liveAdapter.
  const repoRoot = await newRepo(["smoke-json-lines"])
  try {
    const mock = new MockAdapter(writingBehavior(CORRECT_FIX))
    const summary = await runEvalRun({
      adapter: mock,
      config: containerConfig,
      repoRoot,
      reps: 1,
      runId: "container-direct",
      systems: ["direct"],
      tasksDir: "tasks",
    })
    // Direct + network:none is the supported container path, so it runs and grades.
    assert.equal(summary.episodes[0]?.terminalState, "verified_success")
    const record = await readEpisodeRecord({
      episodeId: "smoke-json-lines-direct-r1",
      repoRoot,
      runId: "container-direct",
    })
    assert.ok(record, "expected a durable episode record")
    assert.equal(record.sandbox?.mode, "container")
    assert.equal(record.sandbox?.image, "loopbench-sandbox:pinned")
    assert.equal(record.sandbox?.network?.policy, "none")
    // No live model call has been driven through the policy yet — never overclaim.
    assert.equal(record.sandbox?.network?.liveValidated, false)
    // Env forwarding is recorded by NAME only (config.agent.adapter is claude here).
    assert.deepEqual(record.sandbox?.envForwarded, [
      "ANTHROPIC_API_KEY",
      "ANTHROPIC_SMALL_FAST_MODEL",
    ])
    // The whole record carries no secret value — names only.
    assert.ok(!JSON.stringify(record).includes("sk-"))
  } finally {
    await rm(repoRoot, { force: true, recursive: true })
  }
})

test("a container loop episode is refused before any spawn, with the grader-leak reason", async () => {
  const repoRoot = await newRepo(["smoke-json-lines"])
  try {
    const mock = new MockAdapter(() => {
      throw new Error(
        "adapter must not run for a refused container+loop episode",
      )
    })
    const summary = await runEvalRun({
      adapter: mock,
      config: containerConfig,
      repoRoot,
      reps: 1,
      runId: "container-loop",
      systems: ["loop"],
      tasksDir: "tasks",
    })
    assert.equal(mock.calls, 0)
    assert.equal(summary.episodes[0]?.terminalState, "infrastructure_failure")
    const record = await readEpisodeRecord({
      episodeId: "smoke-json-lines-loop-r1",
      repoRoot,
      runId: "container-loop",
    })
    assert.ok(record, "expected a durable episode record")
    assert.equal(record.terminalState, "infrastructure_failure")
    // The refusal is honest about WHY: mounting repo source would leak graders.
    assert.ok(
      record.harness.notes.some((note) => note.includes("graders")),
      record.harness.notes.join(" | "),
    )
    assert.equal(record.sandbox?.mode, "container")
    assert.equal(record.grade, null)
  } finally {
    await rm(repoRoot, { force: true, recursive: true })
  }
})
