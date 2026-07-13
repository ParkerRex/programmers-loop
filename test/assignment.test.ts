import assert from "node:assert/strict"
import { mkdir, mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import test from "node:test"

import { lintAssignment } from "../src/contracts/assignment.js"

test("validates the readable Assignment schema", async () => {
  const repoRoot = await mkdtemp(path.join(tmpdir(), "programmers-loop-"))
  const relativeRoot = "docs/assignments/active/2026-07-13-example"
  const assignmentRoot = path.join(repoRoot, relativeRoot)
  await mkdir(assignmentRoot, { recursive: true })
  await writeFile(
    path.join(assignmentRoot, "README.md"),
    `---
title: Example
summary: Example packet
status: active
read_when:
  - Testing
---

# Example
`,
  )
  await writeFile(
    path.join(assignmentRoot, "assignment.yaml"),
    `schema_version: 1
assignment_id: example
assignment_slug: example
title: Example
status: active
root_path: ${relativeRoot}
local_mirror:
  driver: README.md
  metadata: assignment.yaml
`,
  )

  assert.deepEqual(await lintAssignment({ assignmentRoot, repoRoot }), [])
})

test("rejects a folder and metadata slug mismatch", async () => {
  const repoRoot = await mkdtemp(path.join(tmpdir(), "programmers-loop-"))
  const relativeRoot = "docs/assignments/active/2026-07-13-example"
  const assignmentRoot = path.join(repoRoot, relativeRoot)
  await mkdir(assignmentRoot, { recursive: true })
  await writeFile(
    path.join(assignmentRoot, "README.md"),
    "---\ntitle: Example\nread_when: [Testing]\n---\n\n# Example\n",
  )
  await writeFile(
    path.join(assignmentRoot, "assignment.yaml"),
    `schema_version: 1
assignment_id: wrong
assignment_slug: wrong
title: Example
status: active
root_path: ${relativeRoot}
local_mirror:
  driver: README.md
  metadata: assignment.yaml
`,
  )

  const issues = await lintAssignment({ assignmentRoot, repoRoot })
  assert.ok(
    issues.some((entry) =>
      entry.message.includes("assignment_slug must match"),
    ),
  )
})
