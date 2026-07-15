#!/usr/bin/env node
// Hidden grader for smoke-retry-flag.
// Usage: node graders/grade.mjs <sandboxDir>
// Prints one JSON summary line ({functional, regression, scope, notes})
// to stdout and exits non-zero when any component fails.
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { realpathSync } from "node:fs"
import { readdir, readFile } from "node:fs/promises"
import path from "node:path"
import { pathToFileURL } from "node:url"

// Mirror of scope.allowed_paths in task.yaml: cli.mjs and *.test.mjs.
const ALLOWED_PATTERNS = [/^cli\.mjs$/, /^[^/]*\.test\.mjs$/]

// sha256 pins of every workspace file outside the allowed patterns.
const BASELINE_HASHES = {
  "README.md":
    "a8d340649a36934757389bc64dbcb54065705ece34013064cf9ed394f19ca3b5",
}

const notes = []

function describe(error) {
  const text = error instanceof Error ? error.message : String(error)
  return text.split("\n")[0]
}

async function passes(component, name, run) {
  try {
    await run()
    return true
  } catch (error) {
    notes.push(`${component}: ${name}: ${describe(error)}`)
    return false
  }
}

function makeAttempt(results) {
  const state = { calls: 0 }
  const attempt = async () => {
    const index = Math.min(state.calls, results.length - 1)
    state.calls += 1
    return results[index]
  }
  return { attempt, state }
}

function isAllowedPath(relativePath) {
  return ALLOWED_PATTERNS.some((pattern) => pattern.test(relativePath))
}

function runGit(sandboxDir, args) {
  const result = spawnSync("git", ["-C", sandboxDir, ...args], {
    encoding: "utf8",
  })
  return result.status === 0 ? result.stdout : null
}

// Changed paths since the runner's baseline commit, or null when the
// sandbox itself is not a usable git repository.
function gitChangedPaths(sandboxDir) {
  const inside = runGit(sandboxDir, ["rev-parse", "--is-inside-work-tree"])
  if (inside === null || inside.trim() !== "true") return null
  const top = runGit(sandboxDir, ["rev-parse", "--show-toplevel"])
  if (top === null) return null
  let sandboxReal = path.resolve(sandboxDir)
  try {
    sandboxReal = realpathSync(sandboxDir)
  } catch {
    return null
  }
  if (path.resolve(top.trim()) !== sandboxReal) return null
  const roots = runGit(sandboxDir, ["rev-list", "--max-parents=0", "HEAD"])
  if (roots === null) return null
  const rootCommit = roots.trim().split("\n")[0]
  const committed = runGit(sandboxDir, [
    "diff",
    "--name-only",
    rootCommit,
    "HEAD",
  ])
  const status = runGit(sandboxDir, ["status", "--porcelain"])
  if (committed === null || status === null) return null
  const changed = new Set()
  for (const line of committed.split("\n")) {
    if (line.trim() !== "") changed.add(line.trim())
  }
  for (const line of status.split("\n")) {
    if (line.trim() === "") continue
    const entry = line.slice(3)
    const target = entry.includes(" -> ") ? entry.split(" -> ")[1] : entry
    changed.add(target.replace(/^"|"$/g, ""))
  }
  return [...changed].sort()
}

async function walkFiles(root, prefix = "") {
  const files = []
  const dirents = await readdir(
    prefix === "" ? root : path.join(root, prefix),
    { withFileTypes: true },
  )
  dirents.sort((left, right) => (left.name < right.name ? -1 : 1))
  for (const dirent of dirents) {
    if (dirent.name === ".git") continue
    const relativePath =
      prefix === "" ? dirent.name : `${prefix}/${dirent.name}`
    if (dirent.isDirectory()) {
      files.push(...(await walkFiles(root, relativePath)))
    } else {
      files.push(relativePath)
    }
  }
  return files
}

async function scopeViolations(sandboxDir) {
  const changed = gitChangedPaths(sandboxDir)
  if (changed !== null) {
    notes.push("scope: checked with git diff against the baseline commit")
    return changed.filter((entry) => !isAllowedPath(entry))
  }
  notes.push("scope: git unavailable; compared file contents to baselines")
  const violations = []
  const files = await walkFiles(sandboxDir)
  for (const relativePath of files) {
    if (isAllowedPath(relativePath)) continue
    const expected = BASELINE_HASHES[relativePath]
    if (expected === undefined) {
      violations.push(`unexpected new file: ${relativePath}`)
      continue
    }
    const digest = createHash("sha256")
      .update(await readFile(path.join(sandboxDir, relativePath)))
      .digest("hex")
    if (digest !== expected) violations.push(`modified: ${relativePath}`)
  }
  for (const relativePath of Object.keys(BASELINE_HASHES)) {
    if (!files.includes(relativePath)) {
      violations.push(`deleted: ${relativePath}`)
    }
  }
  return violations
}

async function grade(sandboxDir) {
  let mod = null
  try {
    mod = await import(pathToFileURL(path.resolve(sandboxDir, "cli.mjs")).href)
  } catch (error) {
    notes.push(`import of cli.mjs failed: ${describe(error)}`)
  }

  let functional = mod !== null
  let regression = mod !== null
  if (mod !== null) {
    const { runCli } = mod

    functional &&= await passes(
      "functional",
      "help documents --retry",
      async () => {
        const result = await runCli(["--help"], async () => true)
        assert.equal(result.exitCode, 0)
        assert.match(result.output, /--retry/)
      },
    )
    functional &&= await passes(
      "functional",
      "succeeds once an attempt passes",
      async () => {
        const { attempt, state } = makeAttempt([false, false, true])
        const result = await runCli(["--retry", "2", "site.txt"], attempt)
        assert.equal(result.exitCode, 0)
        assert.equal(state.calls, 3)
      },
    )
    functional &&= await passes(
      "functional",
      "fails after exhausting retries",
      async () => {
        const { attempt, state } = makeAttempt([false])
        const result = await runCli(["--retry", "2", "site.txt"], attempt)
        assert.equal(result.exitCode, 1)
        assert.equal(state.calls, 3)
      },
    )
    functional &&= await passes(
      "functional",
      "retry 0 means one attempt",
      async () => {
        const { attempt, state } = makeAttempt([false])
        const result = await runCli(["--retry", "0", "site.txt"], attempt)
        assert.equal(result.exitCode, 1)
        assert.equal(state.calls, 1)
      },
    )
    functional &&= await passes(
      "functional",
      "no flag means one attempt",
      async () => {
        const { attempt, state } = makeAttempt([false])
        const result = await runCli(["site.txt"], attempt)
        assert.equal(result.exitCode, 1)
        assert.equal(state.calls, 1)
      },
    )
    functional &&= await passes(
      "functional",
      "stops after a first-try success",
      async () => {
        const { attempt, state } = makeAttempt([true])
        const result = await runCli(["--retry", "5", "site.txt"], attempt)
        assert.equal(result.exitCode, 0)
        assert.equal(state.calls, 1)
      },
    )
    for (const [name, argv] of [
      ["rejects a negative count", ["--retry", "-1", "site.txt"]],
      ["rejects a non-numeric count", ["--retry", "soon", "site.txt"]],
      ["rejects a missing count", ["--retry"]],
    ]) {
      functional &&= await passes("functional", name, async () => {
        const { attempt, state } = makeAttempt([true])
        const result = await runCli(argv, attempt)
        assert.equal(result.exitCode, 2)
        assert.equal(state.calls, 0)
      })
    }

    regression &&= await passes("regression", "json output", async () => {
      const result = await runCli(["--json", "site.txt"], async () => true)
      assert.equal(result.exitCode, 0)
      const parsed = JSON.parse(result.output)
      assert.equal(parsed.target, "site.txt")
      assert.equal(parsed.ok, true)
    })
    regression &&= await passes("regression", "quiet success", async () => {
      const result = await runCli(["--quiet", "site.txt"], async () => true)
      assert.equal(result.exitCode, 0)
      assert.equal(result.output.trim(), "")
    })
    regression &&= await passes("regression", "plain outputs", async () => {
      const success = await runCli(["site.txt"], async () => true)
      assert.equal(success.exitCode, 0)
      assert.match(success.output, /ok site\.txt/)
      const failure = await runCli(["site.txt"], async () => false)
      assert.equal(failure.exitCode, 1)
      assert.match(failure.output, /missing site\.txt/)
    })
    regression &&= await passes("regression", "usage errors", async () => {
      const unknown = await runCli(
        ["--frobnicate", "site.txt"],
        async () => true,
      )
      assert.equal(unknown.exitCode, 2)
      const missing = await runCli([], async () => true)
      assert.equal(missing.exitCode, 2)
    })
  }

  let scope = true
  scope &&= await passes("scope", "only allowed files changed", async () => {
    const violations = await scopeViolations(sandboxDir)
    assert.deepEqual(violations, [])
  })

  return { functional, regression, scope }
}

const sandboxDir = process.argv[2]
let result = { functional: false, regression: false, scope: false }
if (sandboxDir === undefined) {
  notes.push("usage: node graders/grade.mjs <sandboxDir>")
} else {
  result = await grade(sandboxDir)
}

console.log(JSON.stringify({ ...result, notes }))
process.exitCode =
  result.functional && result.regression && result.scope ? 0 : 1
