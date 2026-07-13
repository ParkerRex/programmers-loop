import { readdir } from "node:fs/promises"
import path from "node:path"

import type { ProgrammersLoopConfig } from "./config.js"
import { lintAssignment } from "./contracts/assignment.js"
import { lintExecPlan } from "./contracts/exec-plan.js"
import { lintProgram } from "./contracts/program.js"
import type { LintReport } from "./contracts/types.js"

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

export async function lintPlanningTree(params: {
  repoRoot: string
  config: ProgrammersLoopConfig
}): Promise<LintReport> {
  const report: LintReport = { checked: [], issues: [] }
  const planningRoot = path.join(params.repoRoot, params.config.planningRoot)

  for (const assignmentState of ["active", "completed"]) {
    for (const assignmentRoot of await directories(
      path.join(planningRoot, assignmentState),
    )) {
      report.checked.push(path.relative(params.repoRoot, assignmentRoot))
      report.issues.push(
        ...(await lintAssignment({
          assignmentRoot,
          repoRoot: params.repoRoot,
        })),
      )

      for (const planState of ["active", "completed"]) {
        for (const planPath of await markdownFiles(
          path.join(assignmentRoot, "exec-plans", planState),
        )) {
          report.checked.push(path.relative(params.repoRoot, planPath))
          report.issues.push(
            ...(await lintExecPlan({ planPath, repoRoot: params.repoRoot })),
          )
        }
      }

      for (const programState of ["active", "completed"]) {
        for (const programRoot of await directories(
          path.join(assignmentRoot, "programs", programState),
        )) {
          report.checked.push(path.relative(params.repoRoot, programRoot))
          report.issues.push(
            ...(await lintProgram({
              programRoot,
              repoRoot: params.repoRoot,
            })),
          )
          for (const planState of ["active", "completed"]) {
            for (const planPath of await markdownFiles(
              path.join(programRoot, "exec-plans", planState),
            )) {
              report.checked.push(path.relative(params.repoRoot, planPath))
              report.issues.push(
                ...(await lintExecPlan({
                  planPath,
                  repoRoot: params.repoRoot,
                })),
              )
            }
          }
        }
      }
    }
  }

  report.checked.sort()
  report.issues.sort((left, right) =>
    `${left.path}:${left.message}`.localeCompare(
      `${right.path}:${right.message}`,
    ),
  )
  return report
}
