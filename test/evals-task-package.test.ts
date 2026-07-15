import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { cp, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import test from "node:test"
import { pathToFileURL } from "node:url"

import {
  loadTaskPackage,
  materializeWorkspace,
  parseGraderSummary,
  type TaskPackage,
  workspaceFingerprint,
} from "../src/evals/task-package.js"

const TASKS_ROOT = path.resolve(import.meta.dirname, "..", "evals", "tasks")
const JSON_LINES_DIR = path.join(TASKS_ROOT, "smoke-json-lines")
const RETRY_FLAG_DIR = path.join(TASKS_ROOT, "smoke-retry-flag")

async function loadValidPackage(dir: string): Promise<TaskPackage> {
  const loaded = await loadTaskPackage(dir)
  assert.deepEqual(loaded.issues, [])
  assert.ok(loaded.pkg, "expected a valid task package")
  return loaded.pkg
}

async function newSandbox(pkg: TaskPackage): Promise<string> {
  const base = await mkdtemp(path.join(tmpdir(), "task-sandbox-"))
  const sandbox = path.join(base, "work")
  await materializeWorkspace(pkg, sandbox)
  return sandbox
}

function runGrader(pkg: TaskPackage, sandboxDir: string) {
  const [entry, ...rest] = pkg.grader.command
  const result = spawnSync(
    process.execPath,
    [path.join(pkg.dir, entry), ...rest, sandboxDir],
    { cwd: pkg.dir, encoding: "utf8" },
  )
  const { issues, summary } = parseGraderSummary(result.stdout)
  assert.deepEqual(issues, [])
  assert.ok(summary, "expected a grader summary on stdout")
  return { status: result.status, stdout: result.stdout, summary }
}

async function cloneTask(sourceDir: string, name?: string): Promise<string> {
  const base = await mkdtemp(path.join(tmpdir(), "task-clone-"))
  const target = path.join(base, name ?? path.basename(sourceDir))
  await cp(sourceDir, target, { recursive: true })
  return target
}

async function rewriteManifest(
  dir: string,
  edit: (source: string) => string,
): Promise<void> {
  const manifestPath = path.join(dir, "task.yaml")
  await writeFile(manifestPath, edit(await readFile(manifestPath, "utf8")))
}

async function importParseJsonLines(
  sandboxDir: string,
): Promise<(text: string) => unknown> {
  const moduleUrl = pathToFileURL(path.join(sandboxDir, "json-lines.mjs")).href
  const mod = (await import(moduleUrl)) as {
    parseJsonLines: (text: string) => unknown
  }
  return mod.parseJsonLines
}

function runGit(sandboxDir: string, args: string[]): void {
  const result = spawnSync(
    "git",
    [
      "-C",
      sandboxDir,
      "-c",
      "user.name=grader",
      "-c",
      "user.email=grader@example.com",
      "-c",
      "commit.gpgsign=false",
      ...args,
    ],
    { encoding: "utf8" },
  )
  assert.equal(result.status, 0, `git ${args.join(" ")}: ${result.stderr}`)
}

// A false completion: turns the whole visible suite green while silently
// swallowing malformed records, violating the documented throw behavior.
const NAIVE_JSON_LINES_FIX = String.raw`export function parseJsonLines(text) {
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

const CORRECT_JSON_LINES_FIX_A = String.raw`export function parseJsonLines(text) {
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

const CORRECT_JSON_LINES_FIX_B = String.raw`export function parseJsonLines(text) {
  const records = []
  for (const rawLine of text.split(/\r\n|\n/)) {
    if (rawLine.trim() === "") continue
    records.push(JSON.parse(rawLine))
  }
  return records
}

export function stringifyJsonLines(records) {
  return records.map((record) => JSON.stringify(record)).join("\n")
}
`

const CORRECT_RETRY_CLI = String.raw`#!/usr/bin/env node
import { access } from "node:fs/promises"

export const USAGE = [
  "Usage: pulse [options] <path>",
  "",
  "Checks that <path> exists and reports the result.",
  "",
  "Options:",
  "  --json       Print the result as a JSON object.",
  "  --quiet      Print nothing on success.",
  "  --retry <n>  Retry a failed check up to <n> more times.",
  "  --help       Show this message.",
].join("\n")

export function parseArgs(argv) {
  const options = {
    help: false,
    json: false,
    quiet: false,
    retry: 0,
    target: null,
  }
  const rest = [...argv]
  while (rest.length > 0) {
    const arg = rest.shift()
    if (arg === "--help") options.help = true
    else if (arg === "--json") options.json = true
    else if (arg === "--quiet") options.quiet = true
    else if (arg === "--retry") {
      const value = rest.shift()
      if (value === undefined || !/^\d+$/.test(value)) {
        return { error: "--retry requires a non-negative integer" }
      }
      options.retry = Number(value)
    } else if (arg.startsWith("--")) {
      return { error: "Unknown option: " + arg }
    } else if (options.target === null) options.target = arg
    else return { error: "Unexpected argument: " + arg }
  }
  if (!options.help && options.target === null) {
    return { error: "Missing <path> argument" }
  }
  return { options }
}

export async function defaultAttempt(target) {
  try {
    await access(target)
    return true
  } catch {
    return false
  }
}

export async function runCli(argv, attempt = defaultAttempt) {
  const parsed = parseArgs(argv)
  if (parsed.error !== undefined) {
    return { exitCode: 2, output: parsed.error + "\n\n" + USAGE }
  }
  const { options } = parsed
  if (options.help) return { exitCode: 0, output: USAGE }
  let ok = false
  for (let attemptIndex = 0; attemptIndex <= options.retry; attemptIndex += 1) {
    ok = await attempt(options.target)
    if (ok) break
  }
  if (options.json) {
    return {
      exitCode: ok ? 0 : 1,
      output: JSON.stringify({ target: options.target, ok }),
    }
  }
  if (ok) {
    return {
      exitCode: 0,
      output: options.quiet ? "" : "ok " + options.target,
    }
  }
  return { exitCode: 1, output: "missing " + options.target }
}

if (import.meta.url === new URL(process.argv[1] ?? "", "file:").href) {
  const result = await runCli(process.argv.slice(2))
  if (result.output !== "") process.stdout.write(result.output + "\n")
  process.exitCode = result.exitCode
}
`

test("loads both smoke task packages with zero issues", async () => {
  const jsonLines = await loadValidPackage(JSON_LINES_DIR)
  assert.equal(jsonLines.id, "smoke-json-lines")
  assert.equal(jsonLines.schemaVersion, 1)
  assert.equal(jsonLines.version, 1)
  assert.equal(jsonLines.workflowShape, "skip")
  assert.equal(jsonLines.expectedStratum, null)
  assert.equal(jsonLines.setupCommand, null)
  assert.equal(jsonLines.toolPolicy.network, "deny")
  assert.deepEqual(jsonLines.grader.command, ["graders/grade.mjs"])

  const retryFlag = await loadValidPackage(RETRY_FLAG_DIR)
  assert.equal(retryFlag.id, "smoke-retry-flag")
  assert.equal(retryFlag.workflowShape, "exec-plan")
  assert.ok(retryFlag.scope.allowedPaths.includes("cli.mjs"))
  assert.ok(retryFlag.budgets.maxWallMs > 0)
})

test("reports issues for invalid manifest variants", async () => {
  const variants: [string, (source: string) => string, RegExp][] = [
    [
      "wrong schema_version",
      (source) => source.replace("schema_version: 1", "schema_version: 2"),
      /schema_version must equal 1/,
    ],
    [
      "unknown workflow_shape",
      (source) =>
        source.replace("workflow_shape: skip", "workflow_shape: vibes"),
      /workflow_shape must be one of/,
    ],
    [
      "network not denied",
      (source) => source.replace("network: deny", "network: allow"),
      /tool_policy\.network/,
    ],
    [
      "canary missing from every workspace file",
      (source) =>
        source.replace(
          "84752743-abf4-48ee-bd88-61379e2760bb",
          "11111111-2222-4333-8444-555555555555",
        ),
      /canary was not found/,
    ],
    [
      "missing budget key",
      (source) => source.replace(/^ {2}max_turns: \d+\n/m, ""),
      /max_turns must be a positive integer/,
    ],
    [
      "unexpected manifest key",
      (source) => `${source}\nmystery: 1\n`,
      /Unexpected manifest key: mystery/,
    ],
  ]
  for (const [name, edit, expected] of variants) {
    const clone = await cloneTask(JSON_LINES_DIR)
    await rewriteManifest(clone, edit)
    const loaded = await loadTaskPackage(clone)
    assert.equal(loaded.pkg, null, name)
    assert.ok(
      loaded.issues.some((issue) => expected.test(issue)),
      `${name}: ${loaded.issues.join(" | ")}`,
    )
  }
})

test("rejects an id that does not match the directory name", async () => {
  const clone = await cloneTask(JSON_LINES_DIR, "renamed-task")
  const loaded = await loadTaskPackage(clone)
  assert.equal(loaded.pkg, null)
  assert.ok(
    loaded.issues.some((issue) =>
      issue.includes("id must match the package directory name"),
    ),
  )
})

test("rejects a missing grader entry script", async () => {
  const clone = await cloneTask(JSON_LINES_DIR)
  await rm(path.join(clone, "graders", "grade.mjs"))
  const loaded = await loadTaskPackage(clone)
  assert.equal(loaded.pkg, null)
  assert.ok(
    loaded.issues.some((issue) =>
      issue.includes("grader.command[0] does not exist"),
    ),
  )
})

test("materializes the workspace without hidden content", async () => {
  for (const dir of [JSON_LINES_DIR, RETRY_FLAG_DIR]) {
    const pkg = await loadValidPackage(dir)
    const sandbox = await newSandbox(pkg)
    const entries = await readdir(sandbox, { recursive: true })
    assert.ok(entries.length > 0)
    for (const entry of entries) {
      const segments = entry.split(path.sep)
      assert.ok(
        !segments.includes("graders") && !segments.includes("reference"),
        `hidden content leaked: ${entry}`,
      )
      assert.notEqual(segments.at(-1), "grade.mjs")
      assert.notEqual(segments.at(-1), "task.yaml")
    }
    const contents = await Promise.all(
      entries.map((entry) =>
        readFile(path.join(sandbox, entry), "utf8").catch(() => ""),
      ),
    )
    assert.ok(
      contents.some((content) => content.includes(pkg.provenance.canary)),
      "canary must be materialized with the workspace",
    )
  }
})

test("double materialization is fingerprint-identical", async () => {
  const pkg = await loadValidPackage(JSON_LINES_DIR)
  const first = await newSandbox(pkg)
  const second = await newSandbox(pkg)
  const firstPrint = await workspaceFingerprint(first)
  assert.equal(firstPrint, await workspaceFingerprint(second))
  assert.equal(
    firstPrint,
    await workspaceFingerprint(path.join(pkg.dir, "workspace")),
  )
  await writeFile(path.join(second, "json-lines.mjs"), "// changed\n")
  assert.notEqual(firstPrint, await workspaceFingerprint(second))
})

test("materialization refuses a non-empty destination", async () => {
  const pkg = await loadValidPackage(JSON_LINES_DIR)
  const sandbox = await newSandbox(pkg)
  await assert.rejects(materializeWorkspace(pkg, sandbox), /empty destination/)
})

test("task 1 grader fails the pristine buggy workspace", async () => {
  const pkg = await loadValidPackage(JSON_LINES_DIR)
  const sandbox = await newSandbox(pkg)
  const graded = runGrader(pkg, sandbox)
  assert.equal(graded.status, 1)
  assert.equal(graded.summary.functional, false)
  assert.equal(graded.summary.regression, true)
  assert.equal(graded.summary.scope, true)
})

test("task 1 grader rejects the naive fix even though visible tests pass", async () => {
  const pkg = await loadValidPackage(JSON_LINES_DIR)
  const sandbox = await newSandbox(pkg)
  await writeFile(path.join(sandbox, "json-lines.mjs"), NAIVE_JSON_LINES_FIX)

  // The weak visible suite is fully green for the naive fix.
  const parseJsonLines = await importParseJsonLines(sandbox)
  assert.deepEqual(parseJsonLines('{"id":1}\n{"id":2}'), [{ id: 1 }, { id: 2 }])
  assert.deepEqual(parseJsonLines('{"id":1}\n\n{"id":2}'), [
    { id: 1 },
    { id: 2 },
  ])
  assert.deepEqual(parseJsonLines('{"id":1}\n'), [{ id: 1 }])

  const first = runGrader(pkg, sandbox)
  assert.equal(first.status, 1)
  assert.equal(first.summary.functional, false)
  assert.equal(first.summary.regression, true)
  assert.equal(first.summary.scope, true)
  assert.ok(
    first.summary.notes.some((note) => note.includes("malformed line")),
    first.summary.notes.join(" | "),
  )

  const second = runGrader(pkg, sandbox)
  assert.equal(second.status, first.status)
  assert.equal(second.stdout, first.stdout)
})

test("task 1 grader accepts two distinct correct fixes", async () => {
  const pkg = await loadValidPackage(JSON_LINES_DIR)
  for (const fix of [CORRECT_JSON_LINES_FIX_A, CORRECT_JSON_LINES_FIX_B]) {
    const sandbox = await newSandbox(pkg)
    await writeFile(path.join(sandbox, "json-lines.mjs"), fix)
    const graded = runGrader(pkg, sandbox)
    assert.deepEqual(graded.summary, {
      functional: true,
      notes: [],
      regression: true,
      scope: true,
    })
    assert.equal(graded.status, 0)
  }
})

test("task 2 grader accepts a correct implementation deterministically", async () => {
  const pkg = await loadValidPackage(RETRY_FLAG_DIR)
  const sandbox = await newSandbox(pkg)
  await writeFile(path.join(sandbox, "cli.mjs"), CORRECT_RETRY_CLI)
  const first = runGrader(pkg, sandbox)
  assert.equal(first.status, 0)
  assert.equal(first.summary.functional, true)
  assert.equal(first.summary.regression, true)
  assert.equal(first.summary.scope, true)
  const second = runGrader(pkg, sandbox)
  assert.equal(second.status, first.status)
  assert.equal(second.stdout, first.stdout)
})

test("task 2 grader fails the unmodified workspace on the feature", async () => {
  const pkg = await loadValidPackage(RETRY_FLAG_DIR)
  const sandbox = await newSandbox(pkg)
  const graded = runGrader(pkg, sandbox)
  assert.equal(graded.status, 1)
  assert.equal(graded.summary.functional, false)
  assert.equal(graded.summary.regression, true)
  assert.equal(graded.summary.scope, true)
})

test("task 2 grader flags out-of-scope edits without git", async () => {
  const pkg = await loadValidPackage(RETRY_FLAG_DIR)
  const sandbox = await newSandbox(pkg)
  await writeFile(path.join(sandbox, "cli.mjs"), CORRECT_RETRY_CLI)
  const readmePath = path.join(sandbox, "README.md")
  await writeFile(readmePath, `${await readFile(readmePath, "utf8")}\nedited\n`)
  await writeFile(path.join(sandbox, "helper.mjs"), "export const x = 1\n")
  const graded = runGrader(pkg, sandbox)
  assert.equal(graded.status, 1)
  assert.equal(graded.summary.functional, true)
  assert.equal(graded.summary.regression, true)
  assert.equal(graded.summary.scope, false)
  const joined = graded.summary.notes.join(" | ")
  assert.ok(joined.includes("compared file contents"), joined)
})

test("task 2 grader uses git when the sandbox is a repository", async () => {
  const pkg = await loadValidPackage(RETRY_FLAG_DIR)
  const sandbox = await newSandbox(pkg)
  runGit(sandbox, ["init"])
  runGit(sandbox, ["add", "-A"])
  runGit(sandbox, ["commit", "-m", "baseline"])
  await writeFile(path.join(sandbox, "cli.mjs"), CORRECT_RETRY_CLI)

  const allowed = runGrader(pkg, sandbox)
  assert.equal(allowed.status, 0)
  assert.equal(allowed.summary.scope, true)
  assert.ok(
    allowed.summary.notes.some((note) => note.includes("git diff")),
    allowed.summary.notes.join(" | "),
  )

  const readmePath = path.join(sandbox, "README.md")
  await writeFile(readmePath, `${await readFile(readmePath, "utf8")}\nedited\n`)
  const violated = runGrader(pkg, sandbox)
  assert.equal(violated.status, 1)
  assert.equal(violated.summary.scope, false)
})

test("parseGraderSummary rejects malformed grader output", () => {
  assert.equal(parseGraderSummary("not json").summary, null)
  const wrongShape = parseGraderSummary('{"functional":"yes"}')
  assert.equal(wrongShape.summary, null)
  assert.ok(wrongShape.issues.length > 0)
})
