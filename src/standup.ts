import { lstat, readdir, readFile } from "node:fs/promises"
import path from "node:path"

import YAML from "yaml"

import type { ProgrammersLoopConfig } from "./config.js"
import type { DoctorReport } from "./doctor/index.js"
import { runDoctor } from "./doctor/index.js"
import {
  extractSection,
  parseMarkdownFrontmatter,
} from "./markdown/frontmatter.js"
import { toRepoPath } from "./repo-path.js"

export type StandupPlan = {
  nextAction: string | null
  path: string
  status: string
  summary: string
  title: string
}

export type StandupProgram = {
  currentBrief: string | null
  id: string
  nextSlice: string | null
  path: string
  plans: StandupPlan[]
  status: string
  title: string
}

export type StandupAssignment = {
  blockers: string[]
  currentSegment: string | null
  id: string
  path: string
  plans: StandupPlan[]
  programs: StandupProgram[]
  status: string
  title: string
}

export type StandupReport = {
  status: DoctorReport["status"]
  counts: {
    assignments: number
    programs: number
    execPlans: number
  }
  assignments: StandupAssignment[]
  doctor: DoctorReport
}

async function directories(root: string): Promise<string[]> {
  try {
    return (await readdir(root, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
      .map((entry) => path.join(root, entry.name))
      .toSorted()
  } catch {
    return []
  }
}

async function markdownFiles(root: string): Promise<string[]> {
  try {
    return (await readdir(root, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
      .map((entry) => path.join(root, entry.name))
      .toSorted()
  } catch {
    return []
  }
}

async function readPlan(
  repoRoot: string,
  planPath: string,
): Promise<StandupPlan> {
  const parsed = parseMarkdownFrontmatter(await readFile(planPath, "utf8"))
  return {
    path: toRepoPath(repoRoot, planPath),
    status:
      typeof parsed.metadata.status === "string"
        ? parsed.metadata.status
        : "unknown",
    title:
      typeof parsed.metadata.title === "string"
        ? parsed.metadata.title
        : path.basename(planPath, ".md"),
    summary:
      typeof parsed.metadata.summary === "string"
        ? parsed.metadata.summary
        : "",
    nextAction:
      /^- \[ \] (.+)$/m.exec(
        extractSection(parsed.body, "Progress") ?? "",
      )?.[1] ?? null,
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function lifecycleSummary(metadata: Record<string, unknown>): {
  blockers: string[]
  currentSegment: string | null
} {
  const lifecycle = record(metadata.lifecycle)
  const segments = record(lifecycle?.segments)
  const order = Array.isArray(lifecycle?.order)
    ? lifecycle.order.filter(
        (value): value is string => typeof value === "string",
      )
    : []
  if (!segments) return { blockers: [], currentSegment: null }
  const ready = new Set(["complete", "not_applicable"])
  const currentSegment =
    order.find((segmentId) => {
      const segment = record(segments[segmentId])
      return !ready.has(String(segment?.state ?? "missing"))
    }) ?? null
  if (!currentSegment) return { blockers: [], currentSegment: null }
  const current = record(segments[currentSegment])
  const blockers = Array.isArray(current?.blocked_by)
    ? current.blocked_by
        .filter((value): value is string => typeof value === "string")
        .filter((dependency) => {
          const dependencySegment = record(segments[dependency])
          return !ready.has(String(dependencySegment?.state ?? "missing"))
        })
        .map((dependency) => `${dependency} is not complete`)
    : []
  const state = String(current?.state ?? "missing")
  if (state === "blocked" || state === "needs_owner") {
    blockers.push(`${currentSegment} is ${state}`)
  }
  return { blockers, currentSegment }
}

async function optionalText(filePath: string): Promise<string | null> {
  try {
    if (!(await lstat(filePath)).isFile()) return null
    return await readFile(filePath, "utf8")
  } catch {
    return null
  }
}

async function activePlans(
  repoRoot: string,
  ownerRoot: string,
): Promise<StandupPlan[]> {
  const paths = await markdownFiles(
    path.join(ownerRoot, "exec-plans", "active"),
  )
  return Promise.all(paths.map((planPath) => readPlan(repoRoot, planPath)))
}

export async function runStandup(params: {
  config: ProgrammersLoopConfig
  includeGitHub: boolean
  repoRoot: string
}): Promise<StandupReport> {
  const assignments: StandupAssignment[] = []
  const activeRoot = path.join(
    params.repoRoot,
    params.config.planningRoot,
    "active",
  )
  for (const assignmentRoot of await directories(activeRoot)) {
    let metadata: Record<string, unknown> = {}
    const metadataSource = await optionalText(
      path.join(assignmentRoot, "assignment.yaml"),
    )
    if (metadataSource) {
      try {
        metadata = record(YAML.parse(metadataSource)) ?? {}
      } catch {
        metadata = {}
      }
    }
    const programs: StandupProgram[] = []
    for (const programRoot of await directories(
      path.join(assignmentRoot, "programs", "active"),
    )) {
      const readmeSource = await optionalText(
        path.join(programRoot, "README.md"),
      )
      const parsed = parseMarkdownFrontmatter(readmeSource ?? "")
      const currentBrief = (
        await optionalText(path.join(programRoot, "briefs", "current.txt"))
      )?.trim()
      programs.push({
        currentBrief: currentBrief || null,
        id: path.basename(programRoot),
        path: toRepoPath(params.repoRoot, programRoot),
        plans: await activePlans(params.repoRoot, programRoot),
        status:
          typeof parsed.metadata.status === "string"
            ? parsed.metadata.status
            : "unknown",
        title:
          typeof parsed.metadata.title === "string"
            ? parsed.metadata.title
            : path.basename(programRoot),
        nextSlice: extractSection(parsed.body, "Next Slice"),
      })
    }
    const lifecycle = lifecycleSummary(metadata)
    assignments.push({
      blockers: lifecycle.blockers,
      currentSegment: lifecycle.currentSegment,
      id:
        typeof metadata.assignment_id === "string"
          ? metadata.assignment_id
          : path.basename(assignmentRoot),
      path: toRepoPath(params.repoRoot, assignmentRoot),
      plans: await activePlans(params.repoRoot, assignmentRoot),
      programs,
      status: typeof metadata.status === "string" ? metadata.status : "unknown",
      title:
        typeof metadata.title === "string"
          ? metadata.title
          : path.basename(assignmentRoot),
    })
  }
  const doctor = await runDoctor(params)
  const programCount = assignments.reduce(
    (count, assignment) => count + assignment.programs.length,
    0,
  )
  const execPlanCount = assignments.reduce(
    (count, assignment) =>
      count +
      assignment.plans.length +
      assignment.programs.reduce(
        (planCount, program) => planCount + program.plans.length,
        0,
      ),
    0,
  )
  return {
    status: doctor.status,
    counts: {
      assignments: assignments.length,
      programs: programCount,
      execPlans: execPlanCount,
    },
    assignments,
    doctor,
  }
}
