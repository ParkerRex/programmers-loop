import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { mkdir } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import test from "node:test"

import {
  DEFAULT_PRIVATE_TASKS_DIR,
  initTaskPackage,
  type TaskInitResult,
} from "../src/evals/task-init.js"
import { loadTaskPackage } from "../src/evals/task-package.js"

const EXPECTED_SKELETON_ISSUES = [
  "workflow_shape must be one of: skip, exec-plan, program.",
]

function git(cwd: string, args: string[]): string {
  const result = spawnSync(
    "git",
    [
      "-C",
      cwd,
      "-c",
      "user.name=fixture",
      "-c",
      "user.email=fixture@example.com",
      "-c",
      "commit.gpgsign=false",
      ...args,
    ],
    { encoding: "utf8" },
  )
  assert.equal(result.status, 0, `git ${args.join(" ")}: ${result.stderr}`)
  return result.stdout
}

async function writeFileIn(
  root: string,
  relPath: string,
  content: string,
): Promise<void> {
  const target = path.join(root, relPath)
  await mkdir(path.dirname(target), { recursive: true })
  await writeFile(target, content, "utf8")
}

const PRICING_V1 = "export const price = 1 // v1\n"
const PRICING_V2 = "export const price = 2 // v2 cache-aware\n"
const README = "# Fixture\n\nA fixture repo.\n"
const TEST_V1 = 'import { price } from "./pricing.js"\nexport const t = price\n'
const TEST_V2 =
  'import { price } from "./pricing.js"\nexport const t = price + 1\n'
const NEWFILE = "export const cache = true\n"

const cleanups: string[] = []

test.after(async () => {
  await Promise.all(
    cleanups.map((dir) => rm(dir, { force: true, recursive: true })),
  )
})

/** A source repo whose accepted commit modifies two files and adds one. */
async function makeSourceRepo(): Promise<{
  sourceDir: string
  acceptedSha: string
  parentSha: string
}> {
  const sourceDir = await mkdtemp(path.join(tmpdir(), "task-init-src-"))
  cleanups.push(sourceDir)
  git(sourceDir, ["init", "-q"])
  await writeFileIn(sourceDir, "src/pricing.ts", PRICING_V1)
  await writeFileIn(sourceDir, "README.md", README)
  await writeFileIn(sourceDir, "src/pricing.test.ts", TEST_V1)
  git(sourceDir, ["add", "-A"])
  git(sourceDir, ["commit", "-qm", "seed: initial pricing"])
  const parentSha = git(sourceDir, ["rev-parse", "HEAD"]).trim()

  await writeFileIn(sourceDir, "src/pricing.ts", PRICING_V2)
  await writeFileIn(sourceDir, "src/pricing.test.ts", TEST_V2)
  await writeFileIn(sourceDir, "src/newfile.ts", NEWFILE)
  git(sourceDir, ["add", "-A"])
  git(sourceDir, ["commit", "-qm", "feat: teach pricing to read cache prices"])
  const acceptedSha = git(sourceDir, ["rev-parse", "HEAD"]).trim()

  return { acceptedSha, parentSha, sourceDir }
}

async function newOutputDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "task-init-out-"))
  cleanups.push(dir)
  return dir
}

async function generate(
  overrides: Partial<Parameters<typeof initTaskPackage>[0]> = {},
): Promise<{ result: TaskInitResult; sourceDir: string; outputDir: string }> {
  const { sourceDir, acceptedSha } = await makeSourceRepo()
  const outputDir = await newOutputDir()
  const result = await initTaskPackage({
    commit: acceptedSha,
    cwd: sourceDir,
    execute: true,
    now: new Date("2026-07-14T00:00:00.000Z"),
    outputDir,
    repoRoot: outputDir,
    slug: "cache-pricing-parse",
    sourcePath: sourceDir,
    ...overrides,
  })
  return { outputDir, result, sourceDir }
}

async function exists(target: string): Promise<boolean> {
  try {
    await readFile(target)
    return true
  } catch (error) {
    if (
      error !== null &&
      typeof error === "object" &&
      "code" in error &&
      (error.code === "EISDIR" || error.code === "EACCES")
    ) {
      return true
    }
    return false
  }
}

test("execute writes the full package layout", async () => {
  const { result } = await generate()
  assert.equal(result.status, "skeleton-written")
  assert.equal(result.execute, true)
  for (const relPath of [
    "task.yaml",
    "workspace/README.md",
    "workspace/src/pricing.ts",
    "workspace/src/pricing.test.ts",
    "graders/grade.mjs",
    "reference/notes.md",
  ]) {
    assert.ok(
      await exists(path.join(result.packageDir, relPath)),
      `missing ${relPath}`,
    )
  }
})

test("workspace is the PARENT snapshot and carries no .git", async () => {
  const { result } = await generate()
  const workspace = path.join(result.packageDir, "workspace")

  // Parent content, not the accepted-commit content.
  assert.equal(
    await readFile(path.join(workspace, "src/pricing.ts"), "utf8"),
    PRICING_V1,
  )
  // A file added only in the accepted commit must be absent from the parent.
  assert.equal(
    await exists(path.join(workspace, "src/newfile.ts")),
    false,
    "src/newfile.ts was added in the accepted commit; the parent must not have it",
  )
  assert.equal(
    await exists(path.join(workspace, ".git")),
    false,
    "workspace must not contain a .git entry",
  )
})

test("canary is embedded in a non-allowed workspace file and the manifest", async () => {
  const { result } = await generate()
  // The advisor's correction: the canary host is a file the agent has no
  // reason to touch (outside allowed_paths), giving a free scope tripwire.
  assert.equal(result.canaryFile, "README.md")
  assert.ok(!result.changedFiles.includes(result.canaryFile))

  const hostContent = await readFile(
    path.join(result.packageDir, "workspace", result.canaryFile),
    "utf8",
  )
  assert.ok(
    hostContent.includes(result.canary),
    "canary GUID must appear in the host workspace file",
  )
  assert.match(hostContent, /provenance-canary:/)

  const loaded = await loadTaskPackage(result.packageDir)
  // loadTaskPackage independently verifies the canary is in a workspace file.
  assert.ok(
    loaded.pkg === null ? true : loaded.pkg.provenance.canary === result.canary,
  )
})

test("loadTaskPackage reports exactly the expected TODO-class issue", async () => {
  const { result } = await generate()
  const loaded = await loadTaskPackage(result.packageDir)
  // Everything except workflow_shape must already be valid; if any other
  // issue appears, a field the generator assumed valid is not.
  assert.deepEqual(loaded.issues, EXPECTED_SKELETON_ISSUES)
  assert.equal(loaded.pkg, null)
  assert.deepEqual(result.schemaIssues, EXPECTED_SKELETON_ISSUES)
  assert.deepEqual(result.hardIssues, [])
})

test("guessed allowed_paths are the accepted commit's changed files", async () => {
  const { result } = await generate()
  assert.deepEqual(result.changedFiles, [
    "src/newfile.ts",
    "src/pricing.test.ts",
    "src/pricing.ts",
  ])
})

test("a supplied --request suppresses the placeholder TODO", async () => {
  const withRequest = await generate({
    request: "Teach pricing to read cache prices.",
  })
  const manifest = await readFile(
    path.join(withRequest.result.packageDir, "task.yaml"),
    "utf8",
  )
  assert.match(manifest, /request: Teach pricing to read cache prices\./)
  assert.ok(
    !withRequest.result.checklist.some((item) => item.startsWith("request:")),
    "checklist should not ask for a request when one was supplied",
  )
})

test("preview writes nothing", async () => {
  const { sourceDir, acceptedSha } = await makeSourceRepo()
  const outputDir = await newOutputDir()
  const result = await initTaskPackage({
    commit: acceptedSha,
    cwd: sourceDir,
    execute: false,
    outputDir,
    repoRoot: outputDir,
    slug: "cache-pricing-parse",
    sourcePath: sourceDir,
  })
  assert.equal(result.status, "previewed")
  assert.equal(
    await exists(result.packageDir),
    false,
    "preview must not create the package directory",
  )
  // Preview still resolves everything read-only.
  assert.equal(result.workspaceFileCount, 3)
  assert.equal(result.canaryFile, "README.md")
})

test("--output inside the tracked tree warns; ignored or external paths do not", async () => {
  const { sourceDir, acceptedSha } = await makeSourceRepo()

  // repoRoot is its own git repo; "tracked-tasks" is not ignored.
  const repoRoot = await mkdtemp(path.join(tmpdir(), "task-init-root-"))
  cleanups.push(repoRoot)
  git(repoRoot, ["init", "-q"])
  await writeFile(path.join(repoRoot, ".gitignore"), ".runtime/\n", "utf8")

  const base = {
    commit: acceptedSha,
    cwd: sourceDir,
    execute: false as const,
    repoRoot,
    slug: "cache-pricing-parse",
    sourcePath: sourceDir,
  }

  const tracked = await initTaskPackage({ ...base, outputDir: "tracked-tasks" })
  assert.ok(
    tracked.warnings.some((warning) => warning.includes("tracked tree")),
    `expected a tracked-tree warning, got: ${tracked.warnings.join(" | ")}`,
  )

  const ignored = await initTaskPackage({
    ...base,
    outputDir: DEFAULT_PRIVATE_TASKS_DIR,
  })
  assert.deepEqual(ignored.warnings, [], "ignored default output must not warn")

  const external = await newOutputDir()
  const outside = await initTaskPackage({ ...base, outputDir: external })
  assert.deepEqual(
    outside.warnings,
    [],
    "an output outside the repo must not warn",
  )
})

test("commit with no parent is rejected", async () => {
  const sourceDir = await mkdtemp(path.join(tmpdir(), "task-init-root-only-"))
  cleanups.push(sourceDir)
  git(sourceDir, ["init", "-q"])
  await writeFileIn(sourceDir, "only.ts", "export const x = 1\n")
  git(sourceDir, ["add", "-A"])
  git(sourceDir, ["commit", "-qm", "root"])
  const rootSha = git(sourceDir, ["rev-parse", "HEAD"]).trim()
  const outputDir = await newOutputDir()
  await assert.rejects(
    initTaskPackage({
      commit: rootSha,
      cwd: sourceDir,
      execute: true,
      outputDir,
      repoRoot: outputDir,
      slug: "root-task",
      sourcePath: sourceDir,
    }),
    /has no parent/,
  )
})

test("execute refuses to overwrite an existing package directory", async () => {
  const { result, sourceDir } = await generate()
  await assert.rejects(
    initTaskPackage({
      commit: result.acceptedCommit,
      cwd: sourceDir,
      execute: true,
      outputDir: path.dirname(result.packageDir),
      repoRoot: path.dirname(result.packageDir),
      slug: "cache-pricing-parse",
      sourcePath: sourceDir,
    }),
    /refusing to overwrite/,
  )
})

test("the generated grader is runnable and its scope check works", async () => {
  const { result } = await generate()
  const graderPath = path.join(result.packageDir, "graders", "grade.mjs")

  const runGrader = (sandbox: string) => {
    const proc = spawnSync(process.execPath, [graderPath, sandbox], {
      cwd: result.packageDir,
      encoding: "utf8",
    })
    return {
      status: proc.status,
      summary: JSON.parse(proc.stdout) as {
        functional: boolean
        regression: boolean
        scope: boolean
        notes: string[]
      },
    }
  }

  // Pristine (no-git) materialization: scaffold TODOs fail, scope passes.
  const pristine = await mkdtemp(path.join(tmpdir(), "task-init-sbx-"))
  cleanups.push(pristine)
  await cp(path.join(result.packageDir, "workspace"), pristine, {
    recursive: true,
  })
  const clean = runGrader(pristine)
  assert.equal(clean.status, 1)
  assert.equal(clean.summary.functional, false)
  assert.equal(clean.summary.regression, false)
  assert.equal(clean.summary.scope, true)

  // Editing an allowed file keeps scope true.
  await writeFile(
    path.join(pristine, "src/pricing.ts"),
    "export const price = 42 // agent edit\n",
    "utf8",
  )
  assert.equal(runGrader(pristine).summary.scope, true)

  // Editing the non-allowed canary host trips scope.
  const tampered = await mkdtemp(path.join(tmpdir(), "task-init-sbx-"))
  cleanups.push(tampered)
  await cp(path.join(result.packageDir, "workspace"), tampered, {
    recursive: true,
  })
  await writeFile(
    path.join(tampered, "README.md"),
    `${README}tampered\n`,
    "utf8",
  )
  assert.equal(runGrader(tampered).summary.scope, false)
})

test("the generated grader uses git-diff when the sandbox is a repository", async () => {
  // The production runner git-inits and baseline-commits each sandbox, so the
  // git-diff scope path (not the no-git fallback) is what actually runs.
  const { result } = await generate()
  const graderPath = path.join(result.packageDir, "graders", "grade.mjs")
  const runGrader = (sandbox: string) => {
    const proc = spawnSync(process.execPath, [graderPath, sandbox], {
      cwd: result.packageDir,
      encoding: "utf8",
    })
    return JSON.parse(proc.stdout) as { scope: boolean; notes: string[] }
  }

  const sandbox = await mkdtemp(path.join(tmpdir(), "task-init-gitsbx-"))
  cleanups.push(sandbox)
  await cp(path.join(result.packageDir, "workspace"), sandbox, {
    recursive: true,
  })
  git(sandbox, ["init", "-q"])
  git(sandbox, ["add", "-A"])
  git(sandbox, ["commit", "-qm", "baseline"])

  // Editing an allowed file: scope true, and the git-diff path was taken.
  await writeFile(
    path.join(sandbox, "src/pricing.ts"),
    "export const price = 7 // agent edit\n",
    "utf8",
  )
  const allowed = runGrader(sandbox)
  assert.equal(allowed.scope, true)
  assert.ok(
    allowed.notes.some((note) => note.includes("git diff")),
    allowed.notes.join(" | "),
  )

  // Editing the non-allowed canary host trips scope via git.
  await writeFile(
    path.join(sandbox, "README.md"),
    `${README}tampered\n`,
    "utf8",
  )
  assert.equal(runGrader(sandbox).scope, false)
})

test("an invalid --slug is rejected", async () => {
  const { sourceDir, acceptedSha } = await makeSourceRepo()
  const outputDir = await newOutputDir()
  await assert.rejects(
    initTaskPackage({
      commit: acceptedSha,
      cwd: sourceDir,
      execute: false,
      outputDir,
      repoRoot: outputDir,
      slug: "Not_Kebab",
      sourcePath: sourceDir,
    }),
    /kebab-case/,
  )
})
