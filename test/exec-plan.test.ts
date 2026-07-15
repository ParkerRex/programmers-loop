import assert from "node:assert/strict"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"

import type { ProgrammersLoopConfig } from "../src/config.js"
import {
  lintExecPlan,
  lintExecPlanReadiness,
} from "../src/contracts/exec-plan.js"
import {
  createAssignmentScaffold,
  createExecPlanScaffold,
} from "../src/scaffold.js"

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

async function scaffoldPlan(repoRoot: string): Promise<string> {
  const assignment = await createAssignmentScaffold({
    config,
    date: "2026-07-14",
    repoRoot,
    slug: "strict-plan",
    title: "Strict plan",
  })
  const plan = await createExecPlanScaffold({
    config,
    date: "2026-07-14",
    ownerPath: assignment.path,
    repoRoot,
    slug: "verify-contract",
    title: "Verify contract",
  })
  return path.join(repoRoot, plan.path)
}

test("ExecPlan lint rejects unknown metadata and lane-status drift", async () => {
  const repoRoot = await mkdtemp(
    path.join(os.tmpdir(), "programmers-loop-exec-plan-"),
  )
  try {
    const planPath = await scaffoldPlan(repoRoot)
    const source = await readFile(planPath, "utf8")
    await writeFile(
      planPath,
      source
        .replace("status: active", "status: complete\nunexpected: value")
        .replace("completed_at: null", "completed_at: 2026-07-14")
        .replace(
          "post_build_recap: null",
          "post_build_recap: Completed the strict contract proof.",
        )
        .replace(
          "## Outcomes & Retrospective\n\nPending.",
          "## Outcomes & Retrospective\n\nThe bounded contract proof is complete.",
        ),
    )
    const issues = await lintExecPlan({ planPath, repoRoot })
    assert.ok(
      issues.some((entry) =>
        entry.message.includes("Unexpected frontmatter key"),
      ),
    )
    assert.ok(
      issues.some((entry) => entry.message.includes("exec-plans/active")),
    )
  } finally {
    await rm(repoRoot, { force: true, recursive: true })
  }
})

test("ExecPlan lint requires exact scope, maintenance, and runnable proof", async () => {
  const repoRoot = await mkdtemp(
    path.join(os.tmpdir(), "programmers-loop-exec-plan-"),
  )
  try {
    const planPath = await scaffoldPlan(repoRoot)
    const source = await readFile(planPath, "utf8")
    await writeFile(
      planPath,
      source
        .replace("### In Scope", "### Scope")
        .replace(
          "This ExecPlan must be maintained in accordance with `docs/contracts/exec-plan.md`.\n\n",
          "",
        )
        .replace("bun run check", "Describe the intended test later."),
    )
    const issues = await lintExecPlan({ planPath, repoRoot })
    assert.ok(issues.some((entry) => entry.message.includes("### In Scope")))
    assert.ok(
      issues.some((entry) => entry.message.includes("maintenance sentence")),
    )
    assert.ok(
      issues.some((entry) => entry.message.includes("runnable command")),
    )
  } finally {
    await rm(repoRoot, { force: true, recursive: true })
  }
})

const LITE_OPTIONAL_SECTIONS = [
  "## Surprises & Discoveries",
  "## Decision Log",
  "## Milestones",
  "## Concrete Steps",
  "## Idempotence and Recovery",
  "## Artifacts and Notes",
  "## Interfaces and Dependencies",
]

async function scaffoldLitePlan(repoRoot: string): Promise<string> {
  const assignment = await createAssignmentScaffold({
    config,
    date: "2026-07-14",
    repoRoot,
    slug: "lite-plan",
    title: "Lite plan",
  })
  const plan = await createExecPlanScaffold({
    config,
    date: "2026-07-14",
    ownerPath: assignment.path,
    repoRoot,
    slug: "verify-lite-contract",
    tier: "lite",
    title: "Verify lite contract",
  })
  return path.join(repoRoot, plan.path)
}

test("a lite ExecPlan with only required sections passes structural and readiness lint", async () => {
  const repoRoot = await mkdtemp(
    path.join(os.tmpdir(), "programmers-loop-exec-plan-"),
  )
  try {
    const planPath = await scaffoldLitePlan(repoRoot)
    const source = await readFile(planPath, "utf8")
    for (const heading of LITE_OPTIONAL_SECTIONS) {
      assert.ok(!source.includes(heading), `${heading} must be absent at lite`)
    }
    assert.deepEqual(await lintExecPlan({ planPath, repoRoot }), [])
    assert.ok(
      (await lintExecPlanReadiness({ planPath, repoRoot })).some((entry) =>
        entry.message.includes("scaffold placeholders"),
      ),
    )
    await writeFile(
      planPath,
      source
        .replace("<!-- programmers-loop:placeholder -->\n\n", "")
        .replace(
          "- [ ] Replace scaffold guidance with repository-specific steps.",
          "- [x] Wrote the bounded lite slice steps.",
        )
        .replace(
          "- Define the bounded implementation work before execution.",
          "- Exercise the lite contract tier end to end.",
        ),
    )
    assert.deepEqual(await lintExecPlanReadiness({ planPath, repoRoot }), [])
  } finally {
    await rm(repoRoot, { force: true, recursive: true })
  }
})

test("a lite ExecPlan still requires exact scope and runnable proof", async () => {
  const repoRoot = await mkdtemp(
    path.join(os.tmpdir(), "programmers-loop-exec-plan-"),
  )
  try {
    const planPath = await scaffoldLitePlan(repoRoot)
    const source = await readFile(planPath, "utf8")
    await writeFile(
      planPath,
      source
        .replace("### In Scope", "### Scope")
        .replace("### Out Of Scope", "### Beyond Scope")
        .replace("### Test Commands", "### Proof Ideas"),
    )
    const issues = await lintExecPlan({ planPath, repoRoot })
    assert.ok(issues.some((entry) => entry.message.includes("### In Scope")))
    assert.ok(
      issues.some((entry) => entry.message.includes("### Out Of Scope")),
    )
    assert.ok(
      issues.some((entry) => entry.message.includes("### Test Commands")),
    )
  } finally {
    await rm(repoRoot, { force: true, recursive: true })
  }
})

test("tier selects the required sections and invalid tiers fall back to full", async () => {
  const repoRoot = await mkdtemp(
    path.join(os.tmpdir(), "programmers-loop-exec-plan-"),
  )
  try {
    const fullPath = await scaffoldPlan(repoRoot)
    const fullSource = await readFile(fullPath, "utf8")
    await writeFile(
      fullPath,
      fullSource.replace("status: active", "status: active\ntier: full"),
    )
    assert.deepEqual(await lintExecPlan({ planPath: fullPath, repoRoot }), [])

    const litePath = await scaffoldLitePlan(repoRoot)
    const liteSource = await readFile(litePath, "utf8")
    await writeFile(litePath, liteSource.replace("tier: lite", "tier: medium"))
    const issues = await lintExecPlan({ planPath: litePath, repoRoot })
    assert.ok(
      issues.some((entry) =>
        entry.message.includes("tier must be full or lite"),
      ),
    )
    assert.ok(
      issues.some((entry) =>
        entry.message.includes("Missing required section: ## Milestones"),
      ),
    )
  } finally {
    await rm(repoRoot, { force: true, recursive: true })
  }
})
