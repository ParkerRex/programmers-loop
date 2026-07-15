import assert from "node:assert/strict"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"

import type {
  AgentAdapter,
  AgentRunRequest,
  AgentRunResult,
} from "../src/agents/types.js"
import type { ProgrammersLoopConfig } from "../src/config.js"
import {
  createAssignmentScaffold,
  createExecPlanScaffold,
} from "../src/scaffold.js"
import {
  CURATED_SKILLS_MAX_PER_PHASE,
  curatedSkillsHash,
  loadCuratedSkills,
  MAX_SKILL_LINES,
  selectCuratedSkills,
  type SkillPhase,
  type SkillShape,
} from "../src/workflows/curated-skills.js"
import {
  executeExecPlan,
  grillExecPlan,
  validateExecPlan,
  writeExecPlan,
} from "../src/workflows/exec-plan.js"
import { makeExecPlanReady } from "./planning-fixtures.js"

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

function occurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1
}

async function writeSkill(
  dir: string,
  slug: string,
  frontmatter: {
    phases?: SkillPhase[]
    shapes?: SkillShape[]
    priority: number
    lintable?: string | null
  },
  bodyLines: string[] = ["Do the smallest correct thing."],
): Promise<void> {
  const applies: string[] = ["applies_to:"]
  if (frontmatter.phases) {
    applies.push(`  phases: [${frontmatter.phases.join(", ")}]`)
  }
  if (frontmatter.shapes) {
    applies.push(`  shapes: [${frontmatter.shapes.join(", ")}]`)
  }
  const lintable =
    frontmatter.lintable === undefined
      ? "lintable: null"
      : frontmatter.lintable === null
        ? "lintable: null"
        : `lintable: "${frontmatter.lintable}"`
  const source = [
    "---",
    ...applies,
    `priority: ${frontmatter.priority}`,
    lintable,
    "---",
    "",
    `# ${slug}`,
    "",
    ...bodyLines,
    "",
  ].join("\n")
  await mkdir(path.join(dir, slug), { recursive: true })
  await writeFile(path.join(dir, slug, "SKILL.md"), source)
}

async function tempSkillsDir(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), "curated-skills-"))
}

test("selection is priority-ordered and hard-capped at three per phase", async () => {
  const dir = await tempSkillsDir()
  try {
    // Six applicable-by-something skills; only the top three exec-plan/execute
    // ones may survive selection.
    await writeSkill(dir, "exec-a", {
      phases: ["execute"],
      shapes: ["exec-plan"],
      priority: 100,
    })
    await writeSkill(dir, "exec-b", {
      phases: ["execute"],
      shapes: ["exec-plan"],
      priority: 90,
    })
    await writeSkill(dir, "exec-c", {
      phases: ["execute"],
      shapes: ["exec-plan"],
      priority: 80,
    })
    // The fourth applicable skill: excluded purely by the budget cap.
    await writeSkill(dir, "exec-d", {
      phases: ["execute"],
      shapes: ["exec-plan"],
      priority: 70,
    })
    // Phase mismatch: write-only, must never appear for execute.
    await writeSkill(dir, "write-only", {
      phases: ["write"],
      shapes: ["exec-plan"],
      priority: 999,
    })
    // Shape mismatch: program-only, must never appear for exec-plan.
    await writeSkill(dir, "program-only", {
      phases: ["execute"],
      shapes: ["program"],
      priority: 999,
    })

    const skills = await loadCuratedSkills(dir)
    assert.equal(skills.length, 6)

    const selected = selectCuratedSkills({
      skills,
      phase: "execute",
      shape: "exec-plan",
    })
    assert.equal(selected.length, CURATED_SKILLS_MAX_PER_PHASE)
    assert.deepEqual(
      selected.map((skill) => skill.slug),
      ["exec-a", "exec-b", "exec-c"],
    )
    const slugs = new Set(selected.map((skill) => skill.slug))
    assert.ok(!slugs.has("exec-d"), "4th applicable skill excluded by budget")
    assert.ok(!slugs.has("write-only"), "phase mismatch excluded")
    assert.ok(!slugs.has("program-only"), "shape mismatch excluded")
  } finally {
    await rm(dir, { force: true, recursive: true })
  }
})

test("selection filters by phase and by shape independently", async () => {
  const dir = await tempSkillsDir()
  try {
    await writeSkill(dir, "write-skill", {
      phases: ["write"],
      shapes: ["exec-plan"],
      priority: 10,
    })
    await writeSkill(dir, "program-skill", {
      phases: ["execute"],
      shapes: ["program"],
      priority: 10,
    })
    await writeSkill(dir, "all-phases", { priority: 5 }) // no phases/shapes -> all
    const skills = await loadCuratedSkills(dir)

    const writeSel = selectCuratedSkills({
      skills,
      phase: "write",
      shape: "exec-plan",
    })
    assert.deepEqual(
      writeSel.map((s) => s.slug).toSorted(),
      ["all-phases", "write-skill"],
      "write/exec-plan sees the write skill and the phase-agnostic skill only",
    )

    const programSel = selectCuratedSkills({
      skills,
      phase: "execute",
      shape: "program",
    })
    assert.deepEqual(
      programSel.map((s) => s.slug).toSorted(),
      ["all-phases", "program-skill"],
      "execute/program sees the program skill and the shape-agnostic skill only",
    )

    // Explicit max overrides the default cap.
    assert.equal(
      selectCuratedSkills({
        skills,
        phase: "write",
        shape: "exec-plan",
        max: 1,
      }).length,
      1,
    )
  } finally {
    await rm(dir, { force: true, recursive: true })
  }
})

test("an oversized skill is rejected at load", async () => {
  const dir = await tempSkillsDir()
  try {
    const tooManyLines = Array.from(
      { length: MAX_SKILL_LINES + 1 },
      (_, i) => `Line ${i}.`,
    )
    await writeSkill(dir, "bloated", { priority: 1 }, tooManyLines)
    await assert.rejects(
      () => loadCuratedSkills(dir),
      /over the 60-line budget/,
    )
  } finally {
    await rm(dir, { force: true, recursive: true })
  }
})

test("malformed frontmatter is rejected at load", async () => {
  const dir = await tempSkillsDir()
  try {
    // priority is required to be numeric.
    await mkdir(path.join(dir, "bad"), { recursive: true })
    await writeFile(
      path.join(dir, "bad", "SKILL.md"),
      "---\napplies_to:\n  phases: [execute]\npriority: soon\n---\n\n# Bad\n\nText.\n",
    )
    await assert.rejects(() => loadCuratedSkills(dir), /numeric priority/)

    // Unknown phase names are rejected.
    const dir2 = await tempSkillsDir()
    await writeSkill(dir2, "typo", {
      phases: ["deploy" as SkillPhase],
      priority: 1,
    })
    await assert.rejects(() => loadCuratedSkills(dir2), /unknown phase/)
    await rm(dir2, { force: true, recursive: true })
  } finally {
    await rm(dir, { force: true, recursive: true })
  }
})

test("a missing curated pack yields no skills rather than throwing", async () => {
  const missing = path.join(os.tmpdir(), "curated-skills-does-not-exist-xyz")
  assert.deepEqual(await loadCuratedSkills(missing), [])
  assert.deepEqual(
    selectCuratedSkills({
      skills: [],
      phase: "execute",
      shape: "exec-plan",
    }),
    [],
  )
})

test("the pack hash is stable and changes when a skill changes", async () => {
  const dir = await tempSkillsDir()
  try {
    await writeSkill(dir, "alpha", { priority: 1 })
    await writeSkill(dir, "beta", { priority: 2 })
    const first = await curatedSkillsHash(dir)
    // Identical content -> identical hash (deterministic, order-independent).
    assert.equal(await curatedSkillsHash(dir), first)
    // Mutating one skill's bytes changes the pack hash.
    await writeSkill(dir, "beta", { priority: 2 }, ["A materially new line."])
    const second = await curatedSkillsHash(dir)
    assert.notEqual(first, second)
    // Adding a skill also changes it.
    await writeSkill(dir, "gamma", { priority: 3 })
    assert.notEqual(second, await curatedSkillsHash(dir))
  } finally {
    await rm(dir, { force: true, recursive: true })
  }
})

test("the shipped curated pack loads within budget", async () => {
  const skills = await loadCuratedSkills()
  assert.ok(skills.length >= 3, "the three seeded skills ship")
  for (const skill of skills) {
    assert.ok(
      skill.lineCount <= MAX_SKILL_LINES,
      `${skill.slug} within the line budget`,
    )
  }
  // The three seeds are all present.
  const slugs = new Set(skills.map((s) => s.slug))
  for (const slug of [
    "scope-discipline",
    "verify-before-claim",
    "smallest-correct-change",
  ]) {
    assert.ok(slugs.has(slug), `${slug} ships`)
  }
  // Execute selects at most three, and never more than ship.
  assert.ok(
    selectCuratedSkills({ skills, phase: "execute", shape: "exec-plan" })
      .length <= CURATED_SKILLS_MAX_PER_PHASE,
  )
  // The hash of the shipped pack is a stable non-empty hex digest.
  assert.match(await curatedSkillsHash(), /^[0-9a-f]{64}$/)
})

class CapturingAgent implements AgentAdapter {
  readonly id = "capture"
  prompts: string[] = []

  constructor(private readonly messages: string[] = ["done"]) {}

  async doctor() {
    return { available: true, detail: "capture" }
  }

  async run(request: AgentRunRequest): Promise<AgentRunResult> {
    this.prompts.push(request.prompt)
    return {
      events: [],
      eventsPath: null,
      exitCode: 0,
      lastMessage: this.messages.shift() ?? "done",
      stderr: "",
      stderrTruncated: false,
      timedOut: false,
      usage: null,
    }
  }
}

async function readyPlan(repoRoot: string): Promise<string> {
  const assignment = await createAssignmentScaffold({
    config,
    date: "2026-07-13",
    repoRoot,
    slug: "curated-skills-assignment",
    title: "Assignment for curated skills tests",
  })
  const plan = await createExecPlanScaffold({
    config,
    date: "2026-07-13",
    ownerPath: assignment.path,
    repoRoot,
    slug: "curated-skills-slice",
    title: "Curated skills slice",
  })
  await makeExecPlanReady({ planPath: plan.path, repoRoot })
  return plan.path
}

test("each phase prompt carries exactly one curated-skills block", async () => {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), "curated-skills-wf-"))
  try {
    const planPath = await readyPlan(repoRoot)

    const writer = new CapturingAgent(["written"])
    await writeExecPlan({ adapter: writer, config, planPath, repoRoot })

    const executor = new CapturingAgent(["executed"])
    await executeExecPlan({ adapter: executor, config, planPath, repoRoot })

    const griller = new CapturingAgent([
      "AUTOMATION_STATUS: complete\nAUTOMATION_REPLY: none",
    ])
    await grillExecPlan({ adapter: griller, config, planPath, repoRoot })

    const validator = new CapturingAgent(["validated"])
    await validateExecPlan({ adapter: validator, config, planPath, repoRoot })

    const writePrompt = writer.prompts[0] ?? ""
    const executePrompt = executor.prompts[0] ?? ""
    const grillPrompt = griller.prompts[0] ?? ""
    const validatePrompt = validator.prompts[0] ?? ""

    // Exactly one delimited curated-skills block per phase prompt.
    for (const [name, prompt] of [
      ["write", writePrompt],
      ["execute", executePrompt],
      ["grill", grillPrompt],
      ["validate", validatePrompt],
    ] as const) {
      assert.equal(
        occurrences(prompt, "<curated_skills>"),
        1,
        `${name} prompt has exactly one curated-skills block`,
      )
    }

    // Scope is injected only at execution time, and exactly once.
    assert.equal(occurrences(writePrompt, "<declared_scope>"), 0)
    assert.equal(occurrences(executePrompt, "<declared_scope>"), 1)
    assert.match(executePrompt, /### In Scope/)
    assert.match(executePrompt, /### Out Of Scope/)

    // Real shipped skills are selected per phase: verify-before-claim targets
    // execute/validate, so it appears there but not in the write prompt.
    assert.match(writePrompt, /# Scope discipline/)
    assert.ok(
      !/# Verify before you claim/.test(writePrompt),
      "verify-before-claim is not a write-phase skill",
    )
    assert.match(executePrompt, /# Verify before you claim/)
  } finally {
    await rm(repoRoot, { force: true, recursive: true })
  }
})
