import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises"
import path from "node:path"

import YAML from "yaml"

import type { ProgrammersLoopConfig } from "./config.js"
import { lintAssignment } from "./contracts/assignment.js"
import { EXEC_PLAN_PLACEHOLDER_MARKER } from "./contracts/exec-plan.js"
import {
  lintProgram,
  lintProgramReadiness,
  PROGRAM_PLACEHOLDER_MARKER,
} from "./contracts/program.js"
import {
  assertIsoDate,
  assertKebabCase,
  assertWritePathInRepo,
  resolveExistingRepoPath,
  resolveRepoPath,
  toRepoPath,
  UserInputError,
} from "./repo-path.js"

export type ScaffoldResult = {
  artifact: "assignment" | "program" | "exec-plan"
  dryRun: boolean
  path: string
  files: string[]
}

type PlannedFile = {
  relativePath: string
  content: string
}

function markdown(metadata: Record<string, unknown>, body: string): string {
  return `---\n${YAML.stringify(metadata).trimEnd()}\n---\n\n${body.trim()}\n`
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath)
    return true
  } catch {
    return false
  }
}

function validateText(value: string, label: string): void {
  if (value.trim() === "") {
    throw new UserInputError(`${label} must not be empty.`)
  }
}

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

function assignmentLifecycle(): Record<string, unknown> {
  return {
    states: [
      "not_applicable",
      "missing",
      "ready",
      "in_progress",
      "blocked",
      "needs_owner",
      "complete",
    ],
    order: [
      "research",
      "architecture",
      "ux",
      "ui",
      "program",
      "execplans",
      "unlocks",
      "proof",
      "review",
      "receipts",
    ],
    segments: {
      research: {
        state: "missing",
        artifact: "research.md",
        blocked_by: [],
        complete_when: [
          "the problem, evidence, constraints, and open questions are explicit",
        ],
      },
      architecture: {
        state: "missing",
        artifact: "architecture.md",
        blocked_by: ["research"],
        complete_when: [
          "state ownership, interfaces, failure modes, and recovery are explicit",
        ],
      },
      ux: {
        state: "missing",
        artifact: "ux.md",
        blocked_by: ["research", "architecture"],
        complete_when: [
          "important user states, tasks, affordances, and recovery paths are explicit",
        ],
      },
      ui: {
        state: "missing",
        artifact: "ui.md",
        blocked_by: ["ux"],
        complete_when: [
          "visual hierarchy, components, responsive behavior, and feedback are explicit",
        ],
      },
      program: {
        state: "missing",
        artifact: "programs",
        blocked_by: ["research", "architecture"],
        complete_when: [
          "research has converged and required implementation slices are ordered",
        ],
      },
      execplans: {
        state: "missing",
        artifact: "exec-plans",
        blocked_by: ["research", "architecture", "ux", "ui"],
        complete_when: ["every required bounded slice is complete"],
      },
      unlocks: {
        state: "missing",
        artifact: "unlocks.md",
        blocked_by: [],
        complete_when: [
          "external approvals, credentials, migrations, or delivery prerequisites are resolved or explicitly not applicable",
        ],
      },
      proof: {
        state: "missing",
        artifact: "proof.md",
        blocked_by: ["execplans"],
        complete_when: ["observable acceptance evidence is recorded"],
      },
      review: {
        state: "missing",
        artifact: "review.md",
        blocked_by: ["proof"],
        complete_when: ["findings are resolved or explicitly accepted"],
      },
      receipts: {
        state: "missing",
        artifact: "receipts.md",
        blocked_by: ["review"],
        complete_when: ["required external and runtime receipts are indexed"],
      },
    },
  }
}

function plannedRepoFiles(
  repoRoot: string,
  targetRoot: string,
  files: PlannedFile[],
): string[] {
  return files.map((file) =>
    toRepoPath(repoRoot, path.join(targetRoot, file.relativePath)),
  )
}

async function materializeDirectory(params: {
  dryRun: boolean
  files: PlannedFile[]
  targetRoot: string
}): Promise<void> {
  if (await exists(params.targetRoot)) {
    throw new Error(`Refusing to overwrite existing path: ${params.targetRoot}`)
  }
  if (params.dryRun) return

  const parent = path.dirname(params.targetRoot)
  await mkdir(parent, { recursive: true })
  const temporaryRoot = await mkdtemp(
    path.join(parent, `.${path.basename(params.targetRoot)}.tmp-`),
  )
  try {
    for (const file of params.files) {
      const destination = path.join(temporaryRoot, file.relativePath)
      await mkdir(path.dirname(destination), { recursive: true })
      await writeFile(destination, file.content, {
        encoding: "utf8",
        flag: "wx",
      })
    }
    await rename(temporaryRoot, params.targetRoot)
  } catch (error) {
    await rm(temporaryRoot, { force: true, recursive: true })
    throw error
  }
}

async function materializeFile(params: {
  content: string
  dryRun: boolean
  targetPath: string
}): Promise<void> {
  if (await exists(params.targetPath)) {
    throw new Error(`Refusing to overwrite existing path: ${params.targetPath}`)
  }
  if (params.dryRun) return
  await mkdir(path.dirname(params.targetPath), { recursive: true })
  await writeFile(params.targetPath, params.content, {
    encoding: "utf8",
    flag: "wx",
  })
}

export async function createAssignmentScaffold(params: {
  config: ProgrammersLoopConfig
  date?: string
  dryRun?: boolean
  repoRoot: string
  slug: string
  summary?: string
  title: string
}): Promise<ScaffoldResult> {
  assertKebabCase(params.slug, "slug")
  validateText(params.title, "title")
  const date = params.date ?? today()
  assertIsoDate(date)
  const summary =
    params.summary?.trim() || `Coordinate the ${params.title} body of work.`
  const targetRoot = resolveRepoPath(
    params.repoRoot,
    path.join(params.config.planningRoot, "active", `${date}-${params.slug}`),
  )
  const repoPath = toRepoPath(params.repoRoot, targetRoot)
  const files: PlannedFile[] = [
    {
      relativePath: "README.md",
      content: markdown(
        {
          title: params.title,
          summary,
          status: "draft",
          read_when: ["Working on this Assignment."],
        },
        `# ${params.title}\n\n${summary}\n\nRecord shared scope, evidence, decisions, and child planning artifacts here.`,
      ),
    },
    {
      relativePath: "assignment.yaml",
      content: YAML.stringify({
        schema_version: 1,
        assignment_id: params.slug,
        assignment_slug: params.slug,
        title: params.title,
        status: "draft",
        root_path: repoPath,
        local_mirror: {
          driver: "README.md",
          metadata: "assignment.yaml",
        },
        lifecycle: assignmentLifecycle(),
        derived_segments: {
          design: { derives_from: ["architecture", "ux", "ui"] },
          plan: { derives_from: ["execplans"] },
        },
      }),
    },
  ]

  await assertWritePathInRepo(params.repoRoot, targetRoot)
  await materializeDirectory({
    dryRun: params.dryRun ?? false,
    files,
    targetRoot,
  })
  return {
    artifact: "assignment",
    dryRun: params.dryRun ?? false,
    path: repoPath,
    files: plannedRepoFiles(params.repoRoot, targetRoot, files),
  }
}

function programReadme(params: {
  date: string
  programId: string
  summary: string
  title: string
}): string {
  return markdown(
    {
      program_id: params.programId,
      title: params.title,
      status: "active",
      created_at: params.date,
      completed_at: null,
      summary: params.summary,
      post_build_recap: null,
      read_when: ["Advancing this Program or selecting its next slice."],
    },
    `${PROGRAM_PLACEHOLDER_MARKER}

# ${params.title}

## Purpose / Big Picture

${params.summary}

## Program Inputs

- Owning Assignment and user request.
- Repository contracts, evidence, and constraints.

## Current State

The initial packet is ready for research and convergence.

## Progress

- [ ] Replace initial packet placeholders with evidence-backed findings.
- [ ] Converge the first implementation-ready planning brief.

## Decision Log

- ${params.date}: Initialized the Program packet.

## Slice Ledger

No slices have been executed.

## Next Slice

Complete research and convergence before selecting an ExecPlan.

## Risks and Watchpoints

Do not treat scaffold placeholders as researched conclusions.

## Outcomes & Retrospective

Pending.

## Validation and Acceptance

Run \`programmers-loop program lint --path <program-path>\` after each transition.

## Artifacts and Notes

Packet evidence lives under \`packet/\`; immutable briefs live under \`briefs/\`.

## Interfaces and Dependencies

Use the owning Assignment, repository docs, agent skills, and configured adapter.`,
  )
}

function packet(title: string, purpose: string): string {
  return `${PROGRAM_PLACEHOLDER_MARKER}\n\n# ${title}\n\n${purpose}\n\nReplace this initialization note with evidence before using it to authorize implementation.\n`
}

export async function createProgramScaffold(params: {
  assignmentPath: string
  config: ProgrammersLoopConfig
  date?: string
  dryRun?: boolean
  programId: string
  repoRoot: string
  summary?: string
  title: string
}): Promise<ScaffoldResult> {
  assertKebabCase(params.programId, "id")
  validateText(params.title, "title")
  const date = params.date ?? today()
  assertIsoDate(date)
  const assignmentRoot = await resolveExistingRepoPath(
    params.repoRoot,
    params.assignmentPath,
  )
  const relativeAssignment = toRepoPath(params.repoRoot, assignmentRoot)
  if (!relativeAssignment.startsWith(`${params.config.planningRoot}/active/`)) {
    throw new UserInputError(
      "Programs can only be created inside an active Assignment.",
    )
  }
  if (!(await exists(path.join(assignmentRoot, "assignment.yaml")))) {
    throw new UserInputError(
      "assignment must point to an Assignment directory.",
    )
  }
  const assignmentIssues = await lintAssignment({
    assignmentRoot,
    repoRoot: params.repoRoot,
  })
  if (assignmentIssues.length > 0) {
    throw new Error(
      `Owning Assignment is invalid: ${assignmentIssues[0]?.message ?? "unknown issue"}`,
    )
  }
  const summary =
    params.summary?.trim() ||
    `Research and sequence the ${params.title} initiative.`
  const targetRoot = path.join(
    assignmentRoot,
    "programs",
    "active",
    params.programId,
  )
  const briefTitle = `${params.title} planning brief 1`
  const files: PlannedFile[] = [
    {
      relativePath: "README.md",
      content: programReadme({
        date,
        programId: params.programId,
        summary,
        title: params.title,
      }),
    },
    {
      relativePath: "packet/research-pass-initial.md",
      content: packet(
        "Initial research pass",
        "Capture sources, facts, uncertainty, and implications.",
      ),
    },
    {
      relativePath: "packet/normalized-pass-initial.md",
      content: packet(
        "Initial normalized pass",
        "Normalize agreements, conflicts, dependencies, and open questions.",
      ),
    },
    {
      relativePath: "packet/converged-decision-packet.md",
      content: packet(
        "Converged decision packet",
        "Record the evidence-backed decisions that downstream slices may rely on.",
      ),
    },
    {
      relativePath: "packet/dependency-graph.md",
      content: packet(
        "Dependency graph",
        "Record ordering constraints and critical dependencies.",
      ),
    },
    {
      relativePath: "packet/plan-split-recommendation.md",
      content: packet(
        "Plan split recommendation",
        "Propose bounded ExecPlan slices and their order.",
      ),
    },
    {
      relativePath: "packet/cross-repo-review.md",
      content: packet(
        "Adversarial review",
        "Challenge assumptions, scope boundaries, and validation claims.",
      ),
    },
    {
      relativePath: "briefs/planning-brief-1.md",
      content: markdown(
        {
          title: briefTitle,
          program_id: params.programId,
          brief_version: 1,
          status: "current",
          summary:
            "Initial brief scaffold; replace placeholders before creating an implementation slice.",
          read_when: ["Selecting or writing the first Program-owned ExecPlan."],
        },
        `${PROGRAM_PLACEHOLDER_MARKER}\n\n# ${briefTitle}\n\n## Decision\n\nPending evidence-backed convergence.\n\n## Acceptance\n\nDo not execute from this brief while placeholder text remains.`,
      ),
    },
    { relativePath: "briefs/current.txt", content: "planning-brief-1.md\n" },
  ]

  await assertWritePathInRepo(params.repoRoot, targetRoot)
  await materializeDirectory({
    dryRun: params.dryRun ?? false,
    files,
    targetRoot,
  })
  return {
    artifact: "program",
    dryRun: params.dryRun ?? false,
    path: toRepoPath(params.repoRoot, targetRoot),
    files: plannedRepoFiles(params.repoRoot, targetRoot, files),
  }
}

function execPlanBody(params: {
  date: string
  summary: string
  testCommand: string
  title: string
}): string {
  return `${EXEC_PLAN_PLACEHOLDER_MARKER}

# ${params.title}

## Purpose / Big Picture

${params.summary}

## Progress

- [ ] Replace scaffold guidance with repository-specific steps.
- [ ] Grill the plan before implementation.
- [ ] Execute the bounded slice and record proof.

## Surprises & Discoveries

None yet.

## Decision Log

- ${params.date}: Initialized this ExecPlan.

## Outcomes & Retrospective

Pending.

## Context and Orientation

Read the owning planning artifact, relevant contracts, implementation surfaces,
and verification commands before changing code.

### In Scope

- Define the bounded implementation work before execution.

### Out Of Scope

- Any work not explicitly added to the in-scope list.

This ExecPlan must be maintained in accordance with \`docs/contracts/exec-plan.md\`.

## Plan of Work

Inspect the real implementation surfaces, then make the smallest ordered changes
that produce the user-visible outcome and preserve the stated boundaries.

## Milestones

1. Replace scaffold text with a self-contained implementation plan.
2. Complete the slice with deterministic acceptance evidence.

## Concrete Steps

1. Inspect the owning artifacts and target code.
2. Write exact implementation and recovery steps.
3. Run the configured validation commands.

## Validation and Acceptance

Replace or extend the default command with focused, behavior-specific proof.

### Test Commands

\`\`\`bash
${params.testCommand}
\`\`\`

## Idempotence and Recovery

Keep every step safe to retry. Record partial state and rollback guidance before
performing irreversible work.

## Artifacts and Notes

Record receipts and concise evidence here as the plan runs.

## Interfaces and Dependencies

List concrete modules, APIs, tools, and external boundaries before execution.`
}

export async function createExecPlanScaffold(params: {
  config: ProgrammersLoopConfig
  date?: string
  dryRun?: boolean
  ownerPath: string
  planningBriefPath?: string
  repoRoot: string
  slug: string
  summary?: string
  testCommand?: string
  title: string
}): Promise<ScaffoldResult> {
  assertKebabCase(params.slug, "slug")
  validateText(params.title, "title")
  const date = params.date ?? today()
  assertIsoDate(date)
  const ownerRoot = await resolveExistingRepoPath(
    params.repoRoot,
    params.ownerPath,
  )
  const relativeOwner = toRepoPath(params.repoRoot, ownerRoot)
  if (!relativeOwner.startsWith(`${params.config.planningRoot}/active/`)) {
    throw new UserInputError(
      "ExecPlans can only be created inside an active Assignment.",
    )
  }
  const isAssignment = await exists(path.join(ownerRoot, "assignment.yaml"))
  const isProgram = await exists(path.join(ownerRoot, "briefs", "current.txt"))
  if (isAssignment === isProgram) {
    throw new UserInputError(
      "owner must point to exactly one Assignment or Program directory.",
    )
  }
  if (isProgram && !relativeOwner.includes("/programs/active/")) {
    throw new UserInputError(
      "ExecPlans can only be created inside an active Program.",
    )
  }

  let programMetadata: Record<string, unknown> = {}
  if (isProgram) {
    const programIssues = await lintProgram({
      programRoot: ownerRoot,
      repoRoot: params.repoRoot,
    })
    if (programIssues.length > 0) {
      throw new Error(
        `Owning Program is invalid: ${programIssues[0]?.message ?? "unknown issue"}`,
      )
    }
    const readinessIssues = await lintProgramReadiness({
      programRoot: ownerRoot,
      repoRoot: params.repoRoot,
    })
    if (readinessIssues.length > 0) {
      throw new UserInputError(
        `Owning Program is not ready to authorize an ExecPlan: ${readinessIssues[0]?.message ?? "unknown issue"}`,
      )
    }
    const briefsRoot = path.join(ownerRoot, "briefs")
    const briefPath = params.planningBriefPath
      ? await resolveExistingRepoPath(params.repoRoot, params.planningBriefPath)
      : path.join(
          briefsRoot,
          (await readFile(path.join(briefsRoot, "current.txt"), "utf8")).trim(),
        )
    if (
      path.dirname(briefPath) !== briefsRoot ||
      !/^planning-brief-[1-9]\d*\.md$/.test(path.basename(briefPath))
    ) {
      throw new UserInputError(
        "planning brief must name a versioned brief inside the owning Program.",
      )
    }
    programMetadata = {
      program_id: path.basename(ownerRoot),
      planning_brief: toRepoPath(params.repoRoot, briefPath),
    }
  } else if (params.planningBriefPath) {
    throw new UserInputError(
      "planning brief can only be pinned for a Program-owned ExecPlan.",
    )
  }

  const summary =
    params.summary?.trim() || `Implement the ${params.title} slice.`
  const targetPath = path.join(
    ownerRoot,
    "exec-plans",
    "active",
    `${date}-${params.slug}.md`,
  )
  const content = markdown(
    {
      title: params.title,
      status: "active",
      created_at: date,
      completed_at: null,
      summary,
      post_build_recap: null,
      read_when: ["Implementing or validating this bounded slice."],
      ...programMetadata,
    },
    execPlanBody({
      date,
      summary,
      testCommand: params.testCommand?.trim() || "bun run check",
      title: params.title,
    }),
  )
  await assertWritePathInRepo(params.repoRoot, targetPath)
  await materializeFile({
    content,
    dryRun: params.dryRun ?? false,
    targetPath,
  })
  return {
    artifact: "exec-plan",
    dryRun: params.dryRun ?? false,
    path: toRepoPath(params.repoRoot, targetPath),
    files: [toRepoPath(params.repoRoot, targetPath)],
  }
}
