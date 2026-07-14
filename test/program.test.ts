import assert from "node:assert/strict"
import { mkdir, mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import test from "node:test"

import { lintProgram, lintProgramReadiness } from "../src/contracts/program.js"

const sections = [
  "Purpose / Big Picture",
  "Program Inputs",
  "Current State",
  "Progress",
  "Decision Log",
  "Slice Ledger",
  "Next Slice",
  "Risks and Watchpoints",
  "Outcomes & Retrospective",
  "Validation and Acceptance",
  "Artifacts and Notes",
  "Interfaces and Dependencies",
]

test("validates a Program packet and immutable current brief", async () => {
  const repoRoot = await mkdtemp(path.join(tmpdir(), "programmers-loop-"))
  const programRoot = path.join(
    repoRoot,
    "docs/assignments/active/2026-07-13-example/programs/active/example-program",
  )
  const packetRoot = path.join(programRoot, "packet")
  const briefsRoot = path.join(programRoot, "briefs")
  await mkdir(packetRoot, { recursive: true })
  await mkdir(briefsRoot, { recursive: true })

  await writeFile(
    path.join(programRoot, "README.md"),
    `---
program_id: example-program
title: Example Program
status: active
created_at: 2026-07-13
completed_at: null
summary: Test Program
post_build_recap: null
read_when:
  - Testing
---

# Example Program

${sections.map((heading) => `## ${heading}\n\nDocumented.`).join("\n\n")}
`,
  )

  for (const fileName of [
    "research-pass-example.md",
    "normalized-pass-example.md",
    "converged-decision-packet.md",
    "dependency-graph.md",
    "plan-split-recommendation.md",
    "cross-repo-review.md",
  ]) {
    await writeFile(path.join(packetRoot, fileName), `# ${fileName}\n`)
  }
  await writeFile(path.join(briefsRoot, "current.txt"), "planning-brief-1.md\n")
  await writeFile(
    path.join(briefsRoot, "planning-brief-1.md"),
    `---
title: Example planning brief
program_id: example-program
brief_version: 1
status: current
summary: Test brief
read_when:
  - Executing the next slice
---

# Example planning brief
`,
  )

  assert.deepEqual(await lintProgram({ programRoot, repoRoot }), [])
  const readinessIssues = await lintProgramReadiness({ programRoot, repoRoot })
  assert.ok(
    readinessIssues.some((entry) =>
      entry.message.includes("meaningful ## Goal"),
    ),
  )
})

test("rejects Program lane drift, unknown keys, and an ambiguous pointer", async () => {
  const repoRoot = await mkdtemp(path.join(tmpdir(), "programmers-loop-"))
  const programRoot = path.join(
    repoRoot,
    "docs/assignments/active/2026-07-13-example/programs/active/example-program",
  )
  const packetRoot = path.join(programRoot, "packet")
  const briefsRoot = path.join(programRoot, "briefs")
  await mkdir(packetRoot, { recursive: true })
  await mkdir(briefsRoot, { recursive: true })
  await writeFile(
    path.join(programRoot, "README.md"),
    `---
program_id: example-program
title: Example Program
status: complete
created_at: 2026-07-13
completed_at: 2026-07-13
summary: Test Program
post_build_recap: Completed the work.
unexpected: value
read_when:
  - Testing
---

# Example Program

${sections.map((heading) => `## ${heading}\n\nDocumented.`).join("\n\n")}
`,
  )
  for (const fileName of [
    "research-pass-example.md",
    "normalized-pass-example.md",
    "converged-decision-packet.md",
    "dependency-graph.md",
    "plan-split-recommendation.md",
    "cross-repo-review.md",
  ]) {
    await writeFile(path.join(packetRoot, fileName), `# ${fileName}\n`)
  }
  await writeFile(
    path.join(briefsRoot, "current.txt"),
    "planning-brief-1.md\nplanning-brief-2.md\n",
  )
  await writeFile(
    path.join(briefsRoot, "planning-brief-1.md"),
    `---
title: Example planning brief
program_id: example-program
brief_version: 1
status: current
summary: Test brief
extra: value
read_when:
  - Executing the next slice
---

# Example planning brief
`,
  )

  const issues = await lintProgram({ programRoot, repoRoot })
  assert.ok(
    issues.some((entry) =>
      entry.message.includes("Unexpected frontmatter key"),
    ),
  )
  assert.ok(issues.some((entry) => entry.message.includes("programs/active")))
  assert.ok(
    issues.some((entry) => entry.message.includes("exactly one non-empty")),
  )
})
