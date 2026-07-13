import assert from "node:assert/strict"
import { access, mkdtemp, readFile, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"

import type { ProgrammersLoopConfig } from "../src/config.js"
import { lintAssignment } from "../src/contracts/assignment.js"
import { lintExecPlan } from "../src/contracts/exec-plan.js"
import { lintProgram } from "../src/contracts/program.js"
import { parseMarkdownFrontmatter } from "../src/markdown/frontmatter.js"
import {
  createAssignmentScaffold,
  createExecPlanScaffold,
  createProgramScaffold,
} from "../src/scaffold.js"

const config: ProgrammersLoopConfig = {
  schemaVersion: 1,
  planningRoot: "docs/assignments",
  agent: {
    adapter: "codex",
    command: "codex",
    model: null,
    profile: null,
  },
  github: { repository: null },
  proof: {
    commandTimeoutMs: 1_800_000,
    allowedCommandPrefixes: ["bun", "node", "git"],
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
    const parsed = parseMarkdownFrontmatter(await readFile(planPath, "utf8"))
    assert.equal(parsed.metadata.program_id, "portable-cli")
    assert.equal(
      parsed.metadata.planning_brief,
      `${program.path}/briefs/planning-brief-1.md`,
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
