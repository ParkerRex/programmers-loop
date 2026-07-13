import assert from "node:assert/strict"
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import test from "node:test"

import YAML from "yaml"

import { lintAssignment } from "../src/contracts/assignment.js"
import type { ProgrammersLoopConfig } from "../src/config.js"
import { createAssignmentScaffold } from "../src/scaffold.js"

const config: ProgrammersLoopConfig = {
  schemaVersion: 1,
  planningRoot: "docs/assignments",
  agent: {
    adapter: "codex",
    command: "codex",
    maxOutputBytes: 65_536,
    model: null,
    profile: null,
    runTimeoutMs: 30_000,
  },
  github: { repository: null },
  proof: {
    allowedCommandPrefixes: ["bun run"],
    commandTimeoutMs: 30_000,
    maxOutputBytes: 65_536,
  },
}

test("validates the readable Assignment schema", async () => {
  const repoRoot = await mkdtemp(path.join(tmpdir(), "programmers-loop-"))
  const assignment = await createAssignmentScaffold({
    config,
    date: "2026-07-13",
    repoRoot,
    slug: "example",
    title: "Example",
  })
  const assignmentRoot = path.join(repoRoot, assignment.path)

  assert.deepEqual(await lintAssignment({ assignmentRoot, repoRoot }), [])
})

test("rejects a folder and metadata slug mismatch", async () => {
  const repoRoot = await mkdtemp(path.join(tmpdir(), "programmers-loop-"))
  const assignment = await createAssignmentScaffold({
    config,
    date: "2026-07-13",
    repoRoot,
    slug: "example",
    title: "Example",
  })
  const assignmentRoot = path.join(repoRoot, assignment.path)
  const metadataPath = path.join(assignmentRoot, "assignment.yaml")
  const metadata = await readFile(metadataPath, "utf8")
  await writeFile(
    metadataPath,
    metadata
      .replace("assignment_id: example", "assignment_id: wrong")
      .replace("assignment_slug: example", "assignment_slug: wrong"),
  )

  const issues = await lintAssignment({ assignmentRoot, repoRoot })
  assert.ok(
    issues.some((entry) =>
      entry.message.includes("assignment_slug must match"),
    ),
  )
})

test("enforces Assignment stepper dependencies", async () => {
  const repoRoot = await mkdtemp(path.join(tmpdir(), "programmers-loop-"))
  const assignment = await createAssignmentScaffold({
    config,
    date: "2026-07-13",
    repoRoot,
    slug: "stepper",
    title: "Stepper",
  })
  const assignmentRoot = path.join(repoRoot, assignment.path)
  const metadataPath = path.join(assignmentRoot, "assignment.yaml")
  const metadata = YAML.parse(await readFile(metadataPath, "utf8")) as {
    lifecycle: { segments: Record<string, { state: string }> }
  }
  metadata.lifecycle.segments.execplans!.state = "in_progress"
  await mkdir(path.join(assignmentRoot, "exec-plans"))
  await writeFile(metadataPath, YAML.stringify(metadata))

  const issues = await lintAssignment({ assignmentRoot, repoRoot })
  assert.ok(
    issues.some((entry) =>
      entry.message.includes(
        "execplans cannot be in_progress until research is complete",
      ),
    ),
  )
})

test("rejects local mirror paths that escape the Assignment", async () => {
  const repoRoot = await mkdtemp(path.join(tmpdir(), "programmers-loop-"))
  const assignment = await createAssignmentScaffold({
    config,
    date: "2026-07-13",
    repoRoot,
    slug: "contained",
    title: "Contained",
  })
  const assignmentRoot = path.join(repoRoot, assignment.path)
  const metadataPath = path.join(assignmentRoot, "assignment.yaml")
  const metadata = YAML.parse(await readFile(metadataPath, "utf8")) as {
    local_mirror: { driver: string }
  }
  metadata.local_mirror.driver = "../../outside.md"
  await writeFile(metadataPath, YAML.stringify(metadata))

  const issues = await lintAssignment({ assignmentRoot, repoRoot })
  assert.ok(
    issues.some((entry) =>
      entry.message.includes("local_mirror.driver must stay inside"),
    ),
  )
})
