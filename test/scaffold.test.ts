import assert from "node:assert/strict"
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"

import type { ProgrammersLoopConfig } from "../src/config.js"
import { lintAssignment } from "../src/contracts/assignment.js"
import {
  lintExecPlan,
  lintExecPlanReadiness,
} from "../src/contracts/exec-plan.js"
import { lintProgram } from "../src/contracts/program.js"
import { parseMarkdownFrontmatter } from "../src/markdown/frontmatter.js"
import {
  createAssignmentScaffold,
  createExecPlanScaffold,
  createProgramScaffold,
} from "../src/scaffold.js"
import { runStandup } from "../src/standup.js"
import { lintProgramReadiness } from "../src/contracts/program.js"
import { makeProgramReady } from "./planning-fixtures.js"

const config: ProgrammersLoopConfig = {
  schemaVersion: 1,
  planningRoot: "docs/assignments",
  agent: {
    adapter: "codex",
    command: "codex",
    maxOutputBytes: 1_048_576,
    model: null,
    profile: null,
    runTimeoutMs: 3_600_000,
  },
  github: { repository: null },
  proof: {
    commandTimeoutMs: 1_800_000,
    maxOutputBytes: 65_536,
    allowedCommandPrefixes: ["bun run", "node --test", "git diff"],
  },
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath)
    return true
  } catch {
    return false
  }
}

test("artifact scaffolds are valid, safe, and Program briefs are pinned", async () => {
  const repoRoot = await mkdtemp(
    path.join(os.tmpdir(), "programmers-loop-scaffold-"),
  )
  try {
    const preview = await createAssignmentScaffold({
      config,
      date: "2026-07-13",
      dryRun: true,
      repoRoot,
      slug: "preview-only",
      title: "Preview only",
    })
    assert.equal(preview.dryRun, true)
    assert.equal(await pathExists(path.join(repoRoot, preview.path)), false)

    const assignment = await createAssignmentScaffold({
      config,
      date: "2026-07-13",
      repoRoot,
      slug: "public-interface",
      title: "Public interface",
    })
    const assignmentRoot = path.join(repoRoot, assignment.path)
    assert.deepEqual(await lintAssignment({ assignmentRoot, repoRoot }), [])

    await assert.rejects(
      createAssignmentScaffold({
        config,
        date: "2026-07-13",
        repoRoot,
        slug: "public-interface",
        title: "Public interface",
      }),
      /Refusing to overwrite existing path/,
    )

    const program = await createProgramScaffold({
      assignmentPath: assignment.path,
      config,
      date: "2026-07-13",
      programId: "portable-cli",
      repoRoot,
      title: "Portable CLI",
    })
    const programRoot = path.join(repoRoot, program.path)
    assert.deepEqual(await lintProgram({ programRoot, repoRoot }), [])

    await assert.rejects(
      createExecPlanScaffold({
        config,
        date: "2026-07-13",
        ownerPath: program.path,
        repoRoot,
        slug: "blocked-placeholder",
        title: "Blocked placeholder",
      }),
      /not ready to authorize an ExecPlan/,
    )
    await makeProgramReady({ programPath: program.path, repoRoot })
    assert.deepEqual(await lintProgramReadiness({ programRoot, repoRoot }), [])
    await writeFile(
      path.join(programRoot, "briefs/planning-brief-1.md"),
      `---
title: Ready refresh brief
program_id: portable-cli
brief_version: 1
status: current
summary: Refresh the next evidence-backed slice.
read_when:
  - Writing the next child ExecPlan
---

# Ready refresh brief

## What Changed

The prior slice established the implementation seam.

## What Still Holds

The original compatibility and proof constraints remain.

## Boundary Changes

The next slice is limited to the newly exposed seam.

## Dependency Changes

The prior slice is now a satisfied prerequisite.

## Next Plan Recommendation

Implement and prove one bounded follow-up behavior.

## Risks To Carry Forward

Do not absorb later release work.
`,
    )
    assert.deepEqual(await lintProgramReadiness({ programRoot, repoRoot }), [])

    const plan = await createExecPlanScaffold({
      config,
      date: "2026-07-13",
      ownerPath: program.path,
      repoRoot,
      slug: "add-command-tree",
      title: "Add command tree",
    })
    const planPath = path.join(repoRoot, plan.path)
    assert.deepEqual(await lintExecPlan({ planPath, repoRoot }), [])
    assert.ok(
      (await lintExecPlanReadiness({ planPath, repoRoot })).some((entry) =>
        entry.message.includes("scaffold placeholders"),
      ),
    )
    const parsed = parseMarkdownFrontmatter(await readFile(planPath, "utf8"))
    assert.equal(parsed.metadata.program_id, "portable-cli")
    assert.equal(
      parsed.metadata.planning_brief,
      `${program.path}/briefs/planning-brief-1.md`,
    )
    const validPlanSource = await readFile(planPath, "utf8")
    await writeFile(
      planPath,
      validPlanSource.replace(
        "program_id: portable-cli",
        "program_id: wrong-program",
      ),
    )
    assert.ok(
      (await lintExecPlan({ planPath, repoRoot })).some((entry) =>
        entry.message.includes("Program directory that owns"),
      ),
    )
    await writeFile(planPath, validPlanSource)

    const standup = await runStandup({
      config,
      includeGitHub: false,
      repoRoot,
    })
    assert.equal(standup.assignments[0]?.currentSegment, "research")
    assert.equal(
      standup.assignments[0]?.programs[0]?.currentBrief,
      "planning-brief-1.md",
    )
    assert.match(
      standup.assignments[0]?.programs[0]?.nextSlice ?? "",
      /first recommended ExecPlan/,
    )
    assert.match(
      standup.assignments[0]?.programs[0]?.plans[0]?.nextAction ?? "",
      /Replace scaffold guidance/,
    )
  } finally {
    await rm(repoRoot, { force: true, recursive: true })
  }
})

test("scaffold inputs reject traversal and invalid identifiers", async () => {
  const repoRoot = await mkdtemp(
    path.join(os.tmpdir(), "programmers-loop-safety-"),
  )
  try {
    await assert.rejects(
      createAssignmentScaffold({
        config,
        date: "2026-07-13",
        repoRoot,
        slug: "Not-Kebab",
        title: "Invalid",
      }),
      /kebab-case/,
    )
    await assert.rejects(
      createProgramScaffold({
        assignmentPath: "../../outside",
        config,
        date: "2026-07-13",
        programId: "outside",
        repoRoot,
        title: "Outside",
      }),
      /inside the repository/,
    )
  } finally {
    await rm(repoRoot, { force: true, recursive: true })
  }
})

test("exec-plan scaffold supports the lite tier without changing the default", async () => {
  const repoRoot = await mkdtemp(
    path.join(os.tmpdir(), "programmers-loop-scaffold-"),
  )
  try {
    const assignment = await createAssignmentScaffold({
      config,
      date: "2026-07-13",
      repoRoot,
      slug: "lite-tier",
      title: "Lite tier",
    })
    const fullPlan = await createExecPlanScaffold({
      config,
      date: "2026-07-13",
      ownerPath: assignment.path,
      repoRoot,
      slug: "full-slice",
      title: "Full slice",
    })
    const fullSource = await readFile(
      path.join(repoRoot, fullPlan.path),
      "utf8",
    )
    assert.ok(!fullSource.includes("tier:"))
    assert.ok(fullSource.includes("## Milestones"))

    const litePlan = await createExecPlanScaffold({
      config,
      date: "2026-07-13",
      ownerPath: assignment.path,
      repoRoot,
      slug: "lite-slice",
      tier: "lite",
      title: "Lite slice",
    })
    const litePath = path.join(repoRoot, litePlan.path)
    const liteSource = await readFile(litePath, "utf8")
    assert.equal(parseMarkdownFrontmatter(liteSource).metadata.tier, "lite")
    for (const heading of [
      "## Surprises & Discoveries",
      "## Decision Log",
      "## Milestones",
      "## Concrete Steps",
      "## Idempotence and Recovery",
      "## Artifacts and Notes",
      "## Interfaces and Dependencies",
    ]) {
      assert.ok(!liteSource.includes(heading), `${heading} must be absent`)
    }
    assert.deepEqual(await lintExecPlan({ planPath: litePath, repoRoot }), [])
    assert.ok(
      (await lintExecPlanReadiness({ planPath: litePath, repoRoot })).some(
        (entry) => entry.message.includes("scaffold placeholders"),
      ),
    )
  } finally {
    await rm(repoRoot, { force: true, recursive: true })
  }
})

test("the packaged Assignment template satisfies the Assignment contract", async () => {
  const sourceRoot = path.resolve(import.meta.dirname, "..")
  const repoRoot = await mkdtemp(
    path.join(os.tmpdir(), "programmers-loop-template-"),
  )
  try {
    const assignmentRoot = path.join(
      repoRoot,
      "docs/assignments/active/YYYY-MM-DD-assignment-slug",
    )
    await mkdir(assignmentRoot, { recursive: true })
    for (const fileName of ["README.md", "assignment.yaml"]) {
      await writeFile(
        path.join(assignmentRoot, fileName),
        await readFile(
          path.join(sourceRoot, "templates/assignment", fileName),
          "utf8",
        ),
      )
    }
    assert.deepEqual(await lintAssignment({ assignmentRoot, repoRoot }), [])
  } finally {
    await rm(repoRoot, { force: true, recursive: true })
  }
})
