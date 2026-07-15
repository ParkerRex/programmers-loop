import assert from "node:assert/strict"
import { appendFile, cp, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import test from "node:test"

import {
  buildCorpusManifest,
  CORPUS_MANIFEST_SCHEMA_VERSION,
  serializeCorpusManifest,
} from "../src/evals/corpus-manifest.js"

const REAL_TASKS = path.resolve(import.meta.dirname, "..", "evals", "tasks")

/** Copy the public smoke corpus into an isolated temp directory. */
async function copyCorpus(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "corpus-manifest-"))
  const tasks = path.join(dir, "tasks")
  await cp(REAL_TASKS, tasks, { recursive: true })
  return tasks
}

test("corpus-manifest is deterministic and pins each task's identity", async () => {
  const first = await buildCorpusManifest({ tasksDir: REAL_TASKS })
  const second = await buildCorpusManifest({ tasksDir: REAL_TASKS })
  // Two builds of an unchanged corpus are byte-identical (the freeze artifact).
  assert.deepEqual(first, second)
  assert.equal(serializeCorpusManifest(first), serializeCorpusManifest(second))

  assert.equal(first.schemaVersion, CORPUS_MANIFEST_SCHEMA_VERSION)
  assert.equal(first.taskCount, 2)
  // Tasks are sorted by id for a stable document.
  assert.deepEqual(
    first.tasks.map((task) => task.id),
    ["smoke-json-lines", "smoke-retry-flag"],
  )
  const jsonLines = first.tasks[0]
  assert.ok(jsonLines)
  assert.equal(jsonLines.version, 1)
  assert.equal(jsonLines.workflowShape, "skip")
  assert.equal(jsonLines.expectedStratum, null)
  // Every pinning hash is present.
  assert.match(jsonLines.workspaceFingerprint, /^[0-9a-f]{64}$/)
  assert.match(jsonLines.taskYamlSha256, /^[0-9a-f]{64}$/)
  assert.match(
    jsonLines.graderSha256["graders/grade.mjs"] ?? "",
    /^[0-9a-f]{64}$/,
  )
})

test("corpus-manifest changes when a workspace fixture byte changes", async () => {
  const tasks = await copyCorpus()
  try {
    const before = await buildCorpusManifest({ tasksDir: tasks })
    // Flip one byte of a public workspace file (not task.yaml, not the canary),
    // keeping the package valid so only the workspace fingerprint moves.
    await appendFile(
      path.join(tasks, "smoke-json-lines", "workspace", "index.mjs"),
      "\n",
    )
    const after = await buildCorpusManifest({ tasksDir: tasks })

    assert.notDeepEqual(before, after)
    const beforeFp = before.tasks[0]?.workspaceFingerprint
    const afterFp = after.tasks[0]?.workspaceFingerprint
    assert.notEqual(beforeFp, afterFp, "workspace fingerprint must change")
    // The untouched task's pins are unaffected.
    assert.equal(
      before.tasks[1]?.workspaceFingerprint,
      after.tasks[1]?.workspaceFingerprint,
    )
  } finally {
    await rm(path.dirname(tasks), { force: true, recursive: true })
  }
})

test("corpus-manifest changes when a hidden grader byte changes", async () => {
  const tasks = await copyCorpus()
  try {
    const before = await buildCorpusManifest({ tasksDir: tasks })
    await appendFile(
      path.join(tasks, "smoke-retry-flag", "graders", "grade.mjs"),
      "\n// pinned\n",
    )
    const after = await buildCorpusManifest({ tasksDir: tasks })
    assert.notDeepEqual(before, after)
    assert.notEqual(
      before.tasks[1]?.graderSha256["graders/grade.mjs"],
      after.tasks[1]?.graderSha256["graders/grade.mjs"],
    )
  } finally {
    await rm(path.dirname(tasks), { force: true, recursive: true })
  }
})

test("corpus-manifest refuses an invalid package before pinning anything", async () => {
  const tasks = await copyCorpus()
  try {
    // Corrupt one manifest so loadTaskPackage rejects it.
    await writeFile(
      path.join(tasks, "smoke-json-lines", "task.yaml"),
      "not: a valid task package\n",
      "utf8",
    )
    await assert.rejects(
      buildCorpusManifest({ tasksDir: tasks }),
      /smoke-json-lines is invalid/,
    )
  } finally {
    await rm(path.dirname(tasks), { force: true, recursive: true })
  }
})
