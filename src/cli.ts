#!/usr/bin/env node

import process from "node:process"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { parseArgs, type ParseArgsOptionsConfig } from "node:util"

import { commandHelp, COMMANDS, topLevelHelp } from "./cli/help.js"
import { findRepoRoot, loadConfig } from "./config.js"
import { lintAssignment } from "./contracts/assignment.js"
import { lintExecPlan } from "./contracts/exec-plan.js"
import { lintProgram } from "./contracts/program.js"
import type { LintReport } from "./contracts/types.js"
import { validateDocsSpine } from "./docs/spine.js"
import { runDoctor } from "./doctor/index.js"
import { listPrompts, listSkills } from "./inventory.js"
import { lintPlanningTree } from "./lint.js"
import {
  resolveExistingRepoPath,
  toRepoPath,
  UserInputError,
} from "./repo-path.js"
import {
  createAssignmentScaffold,
  createExecPlanScaffold,
  createProgramScaffold,
  type ScaffoldResult,
} from "./scaffold.js"
import { runStandup, type StandupReport } from "./standup.js"
import { VERSION } from "./version.js"

export type CliIo = {
  stderr: (text: string) => void
  stdout: (text: string) => void
}

export type CliRequest = {
  args: string[]
  cwd: string
  io?: CliIo
}

class UsageError extends Error {}

const defaultIo: CliIo = {
  stderr: (text) => process.stderr.write(text),
  stdout: (text) => process.stdout.write(text),
}

function writeJson(io: CliIo, value: unknown): void {
  io.stdout(`${JSON.stringify(value, null, 2)}\n`)
}

function requiredString(values: Record<string, unknown>, name: string): string {
  const value = values[name]
  if (typeof value !== "string" || value.trim() === "") {
    throw new UsageError(`Missing required option: --${name}`)
  }
  return value
}

function parseOptions(
  args: string[],
  options: ParseArgsOptionsConfig,
): Record<string, unknown> {
  try {
    return parseArgs({ args, allowPositionals: false, options, strict: true })
      .values as Record<string, unknown>
  } catch (error) {
    throw new UsageError(
      error instanceof Error ? error.message : "Invalid command options.",
    )
  }
}

function jsonOption() {
  return { type: "boolean" as const }
}

function dryRunOption() {
  return { type: "boolean" as const, short: "n" }
}

function helpTopic(args: string[]): string | null {
  const first = args[0]
  if (!first || first.startsWith("-")) return null
  const second = args[1]
  const candidate =
    second && !second.startsWith("-") ? `${first} ${second}` : first
  if (COMMANDS.some((entry) => entry.command === candidate)) return candidate
  if (COMMANDS.some((entry) => entry.command.startsWith(`${first} `)))
    return first
  if (COMMANDS.some((entry) => entry.command === first)) return first
  return null
}

function isKnownCommand(args: string[]): boolean {
  if (args[0] === "lint") return true
  if (args[0] === "doctor" || args[0] === "standup") return true
  const candidate = `${args[0] ?? ""} ${args[1] ?? ""}`.trim()
  return COMMANDS.some((entry) => entry.command === candidate)
}

function renderLint(
  io: CliIo,
  report: LintReport,
  label: string,
  json: boolean,
): number {
  if (json) {
    writeJson(io, report)
  } else if (report.issues.length === 0) {
    io.stdout(`${label} passed (${report.checked.length} artifact(s)).\n`)
  } else {
    for (const issue of report.issues) {
      io.stderr(`${issue.path}: ${issue.message}\n`)
    }
  }
  return report.issues.length === 0 ? 0 : 1
}

function renderScaffold(
  io: CliIo,
  result: ScaffoldResult,
  json: boolean,
): void {
  if (json) {
    writeJson(io, result)
    return
  }
  io.stdout(
    `${result.dryRun ? "Would create" : "Created"} ${result.artifact} at ${result.path}.\n`,
  )
  for (const file of result.files) io.stdout(`  ${file}\n`)
}

function renderStandup(io: CliIo, report: StandupReport, json: boolean): void {
  if (json) {
    writeJson(io, report)
    return
  }
  io.stdout(
    `Standup: ${report.counts.assignments} active Assignment(s), ${report.counts.programs} Program(s), ${report.counts.execPlans} ExecPlan(s).\n`,
  )
  for (const assignment of report.assignments) {
    io.stdout(
      `\n${assignment.title} [${assignment.status}]\n  ${assignment.path}\n`,
    )
    for (const plan of assignment.plans) {
      io.stdout(`  ExecPlan: ${plan.title}\n    ${plan.path}\n`)
    }
    for (const program of assignment.programs) {
      io.stdout(`  Program: ${program.title}\n    ${program.path}\n`)
      for (const plan of program.plans) {
        io.stdout(`    ExecPlan: ${plan.title}\n      ${plan.path}\n`)
      }
    }
  }
  const attention = report.doctor.checks.filter(
    (check) => check.status !== "pass",
  )
  io.stdout(`\nDoctor status: ${report.doctor.status}.\n`)
  for (const check of attention) {
    io.stdout(
      `  ${check.status.toUpperCase()} [${check.scope}] ${check.id}: ${check.detail}\n`,
    )
  }
}

async function runKnownCommand(
  request: CliRequest & { io: CliIo },
): Promise<number> {
  const { args, cwd, io } = request
  const command = args[0]
  const subcommand = args[1]

  const repoRoot = await findRepoRoot(cwd)
  const config = await loadConfig(repoRoot)

  if (command === "assignment" && subcommand === "create") {
    const values = parseOptions(args.slice(2), {
      slug: { type: "string" },
      title: { type: "string" },
      summary: { type: "string" },
      date: { type: "string" },
      "dry-run": dryRunOption(),
      json: jsonOption(),
    })
    const result = await createAssignmentScaffold({
      repoRoot,
      config,
      slug: requiredString(values, "slug"),
      title: requiredString(values, "title"),
      summary: typeof values.summary === "string" ? values.summary : undefined,
      date: typeof values.date === "string" ? values.date : undefined,
      dryRun: values["dry-run"] === true,
    })
    renderScaffold(io, result, values.json === true)
    return 0
  }

  if (command === "program" && subcommand === "create") {
    const values = parseOptions(args.slice(2), {
      assignment: { type: "string" },
      id: { type: "string" },
      title: { type: "string" },
      summary: { type: "string" },
      date: { type: "string" },
      "dry-run": dryRunOption(),
      json: jsonOption(),
    })
    const result = await createProgramScaffold({
      repoRoot,
      config,
      assignmentPath: requiredString(values, "assignment"),
      programId: requiredString(values, "id"),
      title: requiredString(values, "title"),
      summary: typeof values.summary === "string" ? values.summary : undefined,
      date: typeof values.date === "string" ? values.date : undefined,
      dryRun: values["dry-run"] === true,
    })
    renderScaffold(io, result, values.json === true)
    return 0
  }

  if (command === "exec-plan" && subcommand === "create") {
    const values = parseOptions(args.slice(2), {
      owner: { type: "string" },
      slug: { type: "string" },
      title: { type: "string" },
      summary: { type: "string" },
      date: { type: "string" },
      "test-command": { type: "string" },
      "dry-run": dryRunOption(),
      json: jsonOption(),
    })
    const result = await createExecPlanScaffold({
      repoRoot,
      config,
      ownerPath: requiredString(values, "owner"),
      slug: requiredString(values, "slug"),
      title: requiredString(values, "title"),
      summary: typeof values.summary === "string" ? values.summary : undefined,
      date: typeof values.date === "string" ? values.date : undefined,
      testCommand:
        typeof values["test-command"] === "string"
          ? values["test-command"]
          : undefined,
      dryRun: values["dry-run"] === true,
    })
    renderScaffold(io, result, values.json === true)
    return 0
  }

  if (
    (command === "assignment" ||
      command === "program" ||
      command === "exec-plan") &&
    subcommand === "lint"
  ) {
    const values = parseOptions(args.slice(2), {
      path: { type: "string" },
      json: jsonOption(),
    })
    const inputPath = requiredString(values, "path")
    const artifactPath = await resolveExistingRepoPath(repoRoot, inputPath)
    const issues =
      command === "assignment"
        ? await lintAssignment({ assignmentRoot: artifactPath, repoRoot })
        : command === "program"
          ? await lintProgram({ programRoot: artifactPath, repoRoot })
          : await lintExecPlan({ planPath: artifactPath, repoRoot })
    return renderLint(
      io,
      { checked: [toRepoPath(repoRoot, artifactPath)], issues },
      command === "exec-plan"
        ? "ExecPlan contract"
        : `${command[0]?.toUpperCase()}${command.slice(1)} contract`,
      values.json === true,
    )
  }

  if ((command === "planning" && subcommand === "lint") || command === "lint") {
    const offset = command === "lint" ? 1 : 2
    const values = parseOptions(args.slice(offset), { json: jsonOption() })
    const report = await lintPlanningTree({ repoRoot, config })
    return renderLint(io, report, "Planning contracts", values.json === true)
  }

  if (command === "docs" && subcommand === "lint") {
    const values = parseOptions(args.slice(2), { json: jsonOption() })
    const report = await validateDocsSpine({ repoRoot })
    if (values.json === true) {
      writeJson(io, report)
    } else if (report.issues.length === 0) {
      io.stdout(
        `Documentation spine passed (${report.checked.length} Markdown files).\n`,
      )
    } else {
      for (const issue of report.issues)
        io.stderr(`${issue.path}: ${issue.message}\n`)
    }
    return report.issues.length === 0 ? 0 : 1
  }

  if (command === "doctor") {
    const values = parseOptions(args.slice(1), {
      github: { type: "boolean" },
      json: jsonOption(),
    })
    const report = await runDoctor({
      config,
      includeGitHub: values.github === true,
      repoRoot,
    })
    if (values.json === true) {
      writeJson(io, report)
    } else {
      for (const check of report.checks) {
        io.stdout(
          `${check.status.toUpperCase()} [${check.scope}] ${check.id}: ${check.detail}\n`,
        )
      }
      io.stdout(`Doctor status: ${report.status}.\n`)
    }
    return report.status === "fail" ? 1 : 0
  }

  if (command === "standup") {
    const values = parseOptions(args.slice(1), {
      github: { type: "boolean" },
      json: jsonOption(),
    })
    const report = await runStandup({
      config,
      includeGitHub: values.github === true,
      repoRoot,
    })
    renderStandup(io, report, values.json === true)
    return report.status === "fail" ? 1 : 0
  }

  if (command === "skills" && subcommand === "list") {
    const values = parseOptions(args.slice(2), { json: jsonOption() })
    const skills = await listSkills(repoRoot)
    if (values.json === true) writeJson(io, skills)
    else {
      for (const skill of skills) {
        io.stdout(`${skill.name}\n  ${skill.description}\n  ${skill.path}\n`)
      }
    }
    return 0
  }

  if (command === "prompts" && subcommand === "list") {
    const values = parseOptions(args.slice(2), { json: jsonOption() })
    const prompts = await listPrompts(repoRoot)
    if (values.json === true) writeJson(io, prompts)
    else {
      for (const prompt of prompts) {
        io.stdout(
          `${prompt.category}/${prompt.name}\n  ${prompt.title}\n  ${prompt.path}\n`,
        )
      }
    }
    return 0
  }

  throw new UsageError(`Unknown command: ${args.join(" ")}`)
}

export async function runCli(request: CliRequest): Promise<number> {
  const io = request.io ?? defaultIo
  const args = request.args
  try {
    if (args.length === 0 || args[0] === "help") {
      const topic = args.slice(1).join(" ")
      try {
        io.stdout(topic === "" ? topLevelHelp() : commandHelp(topic))
      } catch (error) {
        throw new UsageError(
          error instanceof Error ? error.message : "Unknown help topic.",
        )
      }
      return 0
    }
    if (args.includes("--version")) {
      io.stdout(`${VERSION}\n`)
      return 0
    }
    if (args.includes("--help") || args.includes("-h")) {
      const topic = helpTopic(args)
      io.stdout(topic ? commandHelp(topic) : topLevelHelp())
      return 0
    }
    if (!isKnownCommand(args)) {
      throw new UsageError(`Unknown command: ${args.join(" ")}`)
    }
    return await runKnownCommand({ ...request, io })
  } catch (error) {
    const usage = error instanceof UsageError || error instanceof UserInputError
    const message =
      error instanceof Error ? error.message : "Unexpected failure."
    if (args.includes("--json")) {
      io.stderr(
        `${JSON.stringify({ error: message, kind: usage ? "usage" : "failure" })}\n`,
      )
    } else {
      io.stderr(`Error: ${message}\n`)
      if (usage) io.stderr("Run `programmers-loop --help` for usage.\n")
    }
    return usage ? 2 : 1
  }
}

const invokedPath = process.argv[1]
if (
  invokedPath &&
  fileURLToPath(import.meta.url) === path.resolve(invokedPath)
) {
  process.exitCode = await runCli({
    args: process.argv.slice(2),
    cwd: process.cwd(),
  })
}
