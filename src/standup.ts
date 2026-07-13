import { readdir, readFile } from "node:fs/promises"
import path from "node:path"

import YAML from "yaml"

import type { ProgrammersLoopConfig } from "./config.js"
import type { DoctorReport } from "./doctor/index.js"
import { runDoctor } from "./doctor/index.js"
import { parseMarkdownFrontmatter } from "./markdown/frontmatter.js"
import { toRepoPath } from "./repo-path.js"

export type StandupPlan = {
  path: string
  summary: string
  title: string
}

export type StandupProgram = {
  id: string
  path: string
  plans: StandupPlan[]
  title: string
}

export type StandupAssignment = {
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
    title:
      typeof parsed.metadata.title === "string"
        ? parsed.metadata.title
        : path.basename(planPath, ".md"),
    summary:
      typeof parsed.metadata.summary === "string"
        ? parsed.metadata.summary
        : "",
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
    const metadata = YAML.parse(
      await readFile(path.join(assignmentRoot, "assignment.yaml"), "utf8"),
    ) as Record<string, unknown>
    const programs: StandupProgram[] = []
    for (const programRoot of await directories(
      path.join(assignmentRoot, "programs", "active"),
    )) {
      const parsed = parseMarkdownFrontmatter(
        await readFile(path.join(programRoot, "README.md"), "utf8"),
      )
      programs.push({
        id: path.basename(programRoot),
        path: toRepoPath(params.repoRoot, programRoot),
        plans: await activePlans(params.repoRoot, programRoot),
        title:
          typeof parsed.metadata.title === "string"
            ? parsed.metadata.title
            : path.basename(programRoot),
      })
    }
    assignments.push({
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
