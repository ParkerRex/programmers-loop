import { readFile } from "node:fs/promises"
import path from "node:path"

import YAML from "yaml"

import type { ProgrammersLoopConfig } from "./config.js"
import { runDoctor } from "./doctor/index.js"
import type { DoctorCheck, DoctorReport } from "./doctor/types.js"
import { parseMarkdownFrontmatter } from "./markdown/frontmatter.js"
import { previewProof, type ProofPreview } from "./proof.js"

const EXAMPLE_ROOT = "docs/assignments/completed/2026-07-13-tiny-cli-feature"
const EXAMPLE_PROGRAM = `${EXAMPLE_ROOT}/programs/completed/tiny-cli-feature`
export const EXAMPLE_PLAN = `${EXAMPLE_PROGRAM}/exec-plans/completed/2026-07-13-build-greet-command.md`

export type DemoArtifact = {
  kind: "Assignment" | "Program" | "ExecPlan"
  path: string
  title: string
}

export type DemoReport = {
  schemaVersion: 1
  status: "pass" | "fail"
  readOnly: true
  doctor: {
    attention: DoctorCheck[]
    passed: number
    status: DoctorReport["status"]
    total: number
  }
  hierarchy: DemoArtifact[]
  planning: {
    valid: boolean
  }
  proof: ProofPreview
  nextCommands: string[]
}

type DemoDependencies = {
  previewProof: typeof previewProof
  runDoctor: typeof runDoctor
}

const defaultDependencies: DemoDependencies = { previewProof, runDoctor }

async function markdownTitle(filePath: string): Promise<string> {
  const parsed = parseMarkdownFrontmatter(await readFile(filePath, "utf8"))
  return typeof parsed.metadata.title === "string"
    ? parsed.metadata.title
    : path.basename(filePath, ".md")
}

export async function runDemo(
  params: { config: ProgrammersLoopConfig; repoRoot: string },
  dependencies: DemoDependencies = defaultDependencies,
): Promise<DemoReport> {
  const assignmentPath = path.join(params.repoRoot, EXAMPLE_ROOT)
  const programPath = path.join(params.repoRoot, EXAMPLE_PROGRAM)
  const planPath = path.join(params.repoRoot, EXAMPLE_PLAN)
  const [doctor, proof, assignmentSource, programTitle, planTitle] =
    await Promise.all([
      dependencies.runDoctor({
        config: params.config,
        includeGitHub: false,
        repoRoot: params.repoRoot,
      }),
      dependencies.previewProof({
        config: params.config,
        planPath,
        repoRoot: params.repoRoot,
      }),
      readFile(path.join(assignmentPath, "assignment.yaml"), "utf8"),
      markdownTitle(path.join(programPath, "README.md")),
      markdownTitle(planPath),
    ])
  const assignment = YAML.parse(assignmentSource) as Record<string, unknown>
  const attention = doctor.checks.filter((check) => check.status !== "pass")
  const blockingDoctorChecks = doctor.checks.filter(
    (check) => check.status === "fail" && !check.id.startsWith("agent:"),
  )
  const planningPassed = doctor.checks.some(
    (check) => check.id === "planning-contracts" && check.status === "pass",
  )
  const proofPassed = proof.executable && proof.commands.length > 0

  return {
    schemaVersion: 1,
    status:
      blockingDoctorChecks.length === 0 && planningPassed && proofPassed
        ? "pass"
        : "fail",
    readOnly: true,
    doctor: {
      attention,
      passed: doctor.checks.filter((check) => check.status === "pass").length,
      status: doctor.status,
      total: doctor.checks.length,
    },
    hierarchy: [
      {
        kind: "Assignment",
        path: EXAMPLE_ROOT,
        title:
          typeof assignment.title === "string"
            ? assignment.title
            : "Tiny CLI feature",
      },
      { kind: "Program", path: EXAMPLE_PROGRAM, title: programTitle },
      { kind: "ExecPlan", path: EXAMPLE_PLAN, title: planTitle },
    ],
    planning: { valid: planningPassed },
    proof,
    nextCommands: [
      'bun run cli -- assignment create --slug my-project --title "My project" --dry-run',
      "bun run cli -- standup",
    ],
  }
}

export function formatDemoReport(report: DemoReport): string {
  const lines = [
    "Programmers Loop - 60-second tour",
    "",
    "1/4 Environment",
    `    ${report.doctor.status.toUpperCase()} ${report.doctor.passed}/${report.doctor.total} local checks passed`,
  ]
  for (const check of report.doctor.attention) {
    lines.push(`    ${check.status.toUpperCase()} ${check.id}: ${check.detail}`)
  }
  lines.push("", "2/4 Durable hierarchy")
  for (const artifact of report.hierarchy) {
    lines.push(`    ${artifact.kind} -> ${artifact.title}`)
  }
  lines.push(
    "",
    "3/4 Planning contracts",
    `    ${report.planning.valid ? "PASS" : "FAIL"} checked-in artifacts are structurally valid`,
    "",
    "4/4 Safe proof preview",
  )
  for (const command of report.proof.commands) {
    lines.push(
      `    ${command.allowed ? "ALLOW" : "REJECT"} ${command.command}${command.reason ? ` - ${command.reason}` : ""}`,
    )
  }
  lines.push(
    "",
    "Nothing was executed or changed.",
    "",
    "Try it on your work:",
    ...report.nextCommands.map((command) => `    ${command}`),
    "",
  )
  return lines.join("\n")
}
