#!/usr/bin/env node

import process from "node:process"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { parseArgs, type ParseArgsOptionsConfig } from "node:util"

import { commandHelp, COMMANDS, topLevelHelp } from "./cli/help.js"
import { findRepoRoot, loadConfig } from "./config.js"
import { lintAssignment } from "./contracts/assignment.js"
import { lintExecPlan, lintExecPlanReadiness } from "./contracts/exec-plan.js"
import { lintProgram, lintProgramReadiness } from "./contracts/program.js"
import type { LintReport } from "./contracts/types.js"
import { formatDemoReport, runDemo } from "./demo.js"
import { validateDocsSpine } from "./docs/spine.js"
import { runDoctor } from "./doctor/index.js"
import { listPrompts, listSkills } from "./inventory.js"
import { loadOutlineSource, type OutlineInputKind } from "./outline-input.js"
import { lintPlanningTree } from "./lint.js"
import {
  executeProof,
  previewProof,
  type ProofPreview,
  type ProofReceipt,
} from "./proof.js"
import {
  resolveExistingRepoPath,
  resolveRepoPath,
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
import {
  distillExecPlanOutline,
  executeExecPlan,
  grillExecPlan,
  readOutline,
  runExecPlanWorkflow,
  validateExecPlan,
  writeExecPlan,
  type WorkflowReceipt,
} from "./workflows/exec-plan.js"
import {
  advanceProgram,
  previewProgramChildPlan,
  runProgramChildPlan,
  type ProgramAdvanceReceipt,
  type ProgramChildPlanReceipt,
} from "./workflows/program.js"

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

function positiveInteger(
  values: Record<string, unknown>,
  name: string,
): number | undefined {
  const value = values[name]
  if (value === undefined) return undefined
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new UsageError(`--${name} must be a positive integer.`)
  }
  return parsed
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
  if (COMMANDS.some((entry) => entry.command === args[0])) return true
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
    if (assignment.currentSegment) {
      io.stdout(`  Current segment: ${assignment.currentSegment}\n`)
    }
    for (const blocker of assignment.blockers) {
      io.stdout(`  Blocker: ${blocker}\n`)
    }
    for (const plan of assignment.plans) {
      io.stdout(
        `  ExecPlan: ${plan.title} [${plan.status}]\n    ${plan.path}\n`,
      )
      if (plan.nextAction) io.stdout(`    Next: ${plan.nextAction}\n`)
    }
    for (const program of assignment.programs) {
      io.stdout(
        `  Program: ${program.title} [${program.status}]\n    ${program.path}\n`,
      )
      if (program.currentBrief) {
        io.stdout(`    Current brief: ${program.currentBrief}\n`)
      }
      if (program.nextSlice) io.stdout(`    Next slice: ${program.nextSlice}\n`)
      for (const plan of program.plans) {
        io.stdout(
          `    ExecPlan: ${plan.title} [${plan.status}]\n      ${plan.path}\n`,
        )
        if (plan.nextAction) io.stdout(`      Next: ${plan.nextAction}\n`)
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

function renderActionPreview(
  io: CliIo,
  params: { json: boolean; path: string; phase: string },
): void {
  const value = {
    execute: false,
    path: params.path,
    phase: params.phase,
    message: "Preview only. Add --execute to authorize the agent run.",
  }
  if (params.json) writeJson(io, value)
  else {
    io.stdout(`${value.message}\n`)
    io.stdout(`Phase: ${params.phase}\nPath: ${params.path}\n`)
  }
}

function renderWorkflowReceipt(
  io: CliIo,
  receipt: WorkflowReceipt,
  json: boolean,
): void {
  if (json) writeJson(io, receipt)
  else {
    io.stdout(
      `${receipt.phase}: ${receipt.status}. ${receipt.message}\nReceipt: ${receipt.receiptPath}\n`,
    )
  }
}

function renderWorkflowReceipts(
  io: CliIo,
  receipts: WorkflowReceipt[],
  json: boolean,
): void {
  if (json) writeJson(io, receipts)
  else {
    for (const receipt of receipts) renderWorkflowReceipt(io, receipt, false)
  }
}

function renderProofPreview(
  io: CliIo,
  preview: ProofPreview,
  json: boolean,
): void {
  if (json) {
    writeJson(io, preview)
    return
  }
  io.stdout(`Proof preview for ${preview.planPath}:\n`)
  if (preview.commands.length === 0) io.stdout("  No test commands found.\n")
  for (const command of preview.commands) {
    io.stdout(
      `  ${command.allowed ? "ALLOW" : "REJECT"} ${command.command}${command.reason ? ` — ${command.reason}` : ""}\n`,
    )
  }
  io.stdout(
    preview.executable
      ? "Add --execute to run these commands and write a receipt.\n"
      : "This proof set is not executable.\n",
  )
}

function renderProofReceipt(
  io: CliIo,
  receipt: ProofReceipt,
  json: boolean,
): void {
  if (json) writeJson(io, receipt)
  else {
    io.stdout(
      `Proof ${receipt.status} for ${receipt.planPath}.\nReceipt: ${receipt.receiptPath}\n`,
    )
    for (const command of receipt.commands) {
      io.stdout(
        `  ${command.exitCode === 0 ? "PASS" : "FAIL"} ${command.command}\n`,
      )
    }
  }
}

function renderProgramReceipt(
  io: CliIo,
  receipt: ProgramAdvanceReceipt | ProgramChildPlanReceipt,
  json: boolean,
): void {
  if (json) writeJson(io, receipt)
  else {
    io.stdout(
      `Program ${receipt.status}. ${receipt.message}\nReceipt: ${receipt.receiptPath}\n`,
    )
    if ("planPath" in receipt)
      io.stdout(`Child ExecPlan: ${receipt.planPath}\n`)
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

  if (command === "demo") {
    const values = parseOptions(args.slice(1), { json: jsonOption() })
    const report = await runDemo({ config, repoRoot })
    if (values.json === true) writeJson(io, report)
    else io.stdout(formatDemoReport(report))
    return report.status === "pass" ? 0 : 1
  }

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

  if (command === "program" && subcommand === "advance") {
    const values = parseOptions(args.slice(2), {
      path: { type: "string" },
      execute: { type: "boolean" },
      json: jsonOption(),
    })
    const programPath = requiredString(values, "path")
    if (values.execute !== true) {
      const resolved = await resolveExistingRepoPath(repoRoot, programPath)
      renderActionPreview(io, {
        json: values.json === true,
        path: toRepoPath(repoRoot, resolved),
        phase: "program advance",
      })
      return 0
    }
    const receipt = await advanceProgram({
      config,
      programPath,
      repoRoot,
    })
    renderProgramReceipt(io, receipt, values.json === true)
    return receipt.status === "completed" ? 0 : 1
  }

  if (command === "program" && subcommand === "child-plan") {
    const values = parseOptions(args.slice(2), {
      path: { type: "string" },
      slug: { type: "string" },
      title: { type: "string" },
      summary: { type: "string" },
      date: { type: "string" },
      outline: { type: "string" },
      "run-id": { type: "string" },
      execute: { type: "boolean" },
      json: jsonOption(),
    })
    const common = {
      config,
      date: typeof values.date === "string" ? values.date : undefined,
      programPath: requiredString(values, "path"),
      repoRoot,
      runId:
        typeof values["run-id"] === "string" ? values["run-id"] : undefined,
      slug: requiredString(values, "slug"),
      summary: typeof values.summary === "string" ? values.summary : undefined,
      title: requiredString(values, "title"),
    }
    if (values.execute !== true) {
      const preview = await previewProgramChildPlan(common)
      renderProgramReceipt(io, preview, values.json === true)
      return 0
    }
    const outline =
      typeof values.outline === "string"
        ? await readOutline({ outlinePath: values.outline, repoRoot })
        : undefined
    const receipt = await runProgramChildPlan({ ...common, outline })
    renderProgramReceipt(io, receipt, values.json === true)
    return receipt.status === "completed" ? 0 : 1
  }

  if (command === "exec-plan" && subcommand === "proof") {
    const values = parseOptions(args.slice(2), {
      path: { type: "string" },
      execute: { type: "boolean" },
      json: jsonOption(),
    })
    const planPath = requiredString(values, "path")
    if (values.execute !== true) {
      renderProofPreview(
        io,
        await previewProof({ config, planPath, repoRoot }),
        values.json === true,
      )
      return 0
    }
    const receipt = await executeProof({ config, planPath, repoRoot })
    renderProofReceipt(io, receipt, values.json === true)
    return receipt.status === "passed" ? 0 : 1
  }

  if (command === "exec-plan" && subcommand === "outline") {
    const values = parseOptions(args.slice(2), {
      input: { type: "string" },
      "session-jsonl": { type: "string" },
      handoff: { type: "string" },
      output: { type: "string" },
      execute: { type: "boolean" },
      json: jsonOption(),
    })
    const inputs = [
      ["notes", values.input],
      ["session-jsonl", values["session-jsonl"]],
      ["handoff", values.handoff],
    ].filter(
      (entry): entry is [OutlineInputKind, string] =>
        typeof entry[1] === "string",
    )
    if (inputs.length !== 1) {
      throw new UsageError(
        "Use exactly one of --input, --session-jsonl, or --handoff.",
      )
    }
    const [kind, inputPath] = inputs[0]!
    const outputPath = requiredString(values, "output")
    const sourceMaterial = await loadOutlineSource({
      inputPath,
      kind,
      repoRoot,
    })
    const resolvedOutput = resolveRepoPath(repoRoot, outputPath)
    if (values.execute !== true) {
      renderActionPreview(io, {
        json: values.json === true,
        path: toRepoPath(repoRoot, resolvedOutput),
        phase: "exec-plan outline",
      })
      return 0
    }
    const receipt = await distillExecPlanOutline({
      config,
      outputPath,
      repoRoot,
      sourceMaterial,
    })
    renderWorkflowReceipt(io, receipt, values.json === true)
    return receipt.status === "completed" ? 0 : 1
  }

  if (
    command === "exec-plan" &&
    (subcommand === "write" ||
      subcommand === "grill" ||
      subcommand === "execute" ||
      subcommand === "validate" ||
      subcommand === "run")
  ) {
    const values = parseOptions(args.slice(2), {
      path: { type: "string" },
      outline: { type: "string" },
      handoff: { type: "string" },
      execute: { type: "boolean" },
      proof: { type: "boolean" },
      "max-rounds": { type: "string" },
      "max-attempts": { type: "string" },
      json: jsonOption(),
    })
    const planPath = requiredString(values, "path")
    if (values.execute !== true) {
      const resolved = await resolveExistingRepoPath(repoRoot, planPath)
      renderActionPreview(io, {
        json: values.json === true,
        path: toRepoPath(repoRoot, resolved),
        phase: `exec-plan ${subcommand}`,
      })
      return 0
    }
    const maxRounds = positiveInteger(values, "max-rounds")
    const maxAttempts = positiveInteger(values, "max-attempts")
    if (
      values.outline !== undefined &&
      subcommand !== "write" &&
      subcommand !== "run"
    ) {
      throw new UsageError("--outline is only valid for write and run.")
    }
    if (
      values.handoff !== undefined &&
      subcommand !== "write" &&
      subcommand !== "run"
    ) {
      throw new UsageError("--handoff is only valid for write and run.")
    }
    if (values.outline !== undefined && values.handoff !== undefined) {
      throw new UsageError("Use either --outline or --handoff, not both.")
    }
    if (
      maxRounds !== undefined &&
      subcommand !== "grill" &&
      subcommand !== "run"
    ) {
      throw new UsageError("--max-rounds is only valid for grill and run.")
    }
    if (
      maxAttempts !== undefined &&
      subcommand !== "validate" &&
      subcommand !== "run"
    ) {
      throw new UsageError("--max-attempts is only valid for validate and run.")
    }
    if (
      values.proof === true &&
      subcommand !== "validate" &&
      subcommand !== "run"
    ) {
      throw new UsageError("--proof is only valid for validate and run.")
    }
    const approvedProof =
      values.proof === true
        ? await previewProof({ config, planPath, repoRoot })
        : undefined
    if (approvedProof && values.json !== true) {
      renderProofPreview(io, approvedProof, false)
    }
    let receipts: WorkflowReceipt[]
    if (subcommand === "write") {
      const outline =
        typeof values.outline === "string"
          ? await readOutline({ outlinePath: values.outline, repoRoot })
          : typeof values.handoff === "string"
            ? await loadOutlineSource({
                inputPath: values.handoff,
                kind: "handoff",
                repoRoot,
              })
            : undefined
      receipts = [await writeExecPlan({ config, outline, planPath, repoRoot })]
    } else if (subcommand === "grill") {
      receipts = [
        await grillExecPlan({
          config,
          maxRounds,
          planPath,
          repoRoot,
        }),
      ]
    } else if (subcommand === "execute") {
      receipts = [await executeExecPlan({ config, planPath, repoRoot })]
    } else if (subcommand === "validate") {
      receipts = [
        await validateExecPlan({
          config,
          approvedProof,
          executeProofCommands: values.proof === true,
          maxAttempts,
          planPath,
          repoRoot,
        }),
      ]
    } else {
      const outline =
        typeof values.outline === "string"
          ? await readOutline({ outlinePath: values.outline, repoRoot })
          : typeof values.handoff === "string"
            ? await loadOutlineSource({
                inputPath: values.handoff,
                kind: "handoff",
                repoRoot,
              })
            : undefined
      receipts = await runExecPlanWorkflow({
        config,
        approvedProof,
        executeProofCommands: values.proof === true,
        maxGrillRounds: maxRounds,
        maxValidationAttempts: maxAttempts,
        outline,
        planPath,
        repoRoot,
      })
    }
    renderWorkflowReceipts(io, receipts, values.json === true)
    return receipts.every((receipt) => receipt.status === "completed") ? 0 : 1
  }

  if (
    (command === "assignment" ||
      command === "program" ||
      command === "exec-plan") &&
    subcommand === "lint"
  ) {
    const values = parseOptions(args.slice(2), {
      path: { type: "string" },
      ready: { type: "boolean" },
      json: jsonOption(),
    })
    if (values.ready === true && command === "assignment") {
      throw new UsageError(
        "--ready is only valid for Program and ExecPlan lint.",
      )
    }
    const inputPath = requiredString(values, "path")
    const artifactPath = await resolveExistingRepoPath(repoRoot, inputPath)
    const issues =
      command === "assignment"
        ? await lintAssignment({ assignmentRoot: artifactPath, repoRoot })
        : command === "program"
          ? values.ready === true
            ? await lintProgramReadiness({
                programRoot: artifactPath,
                repoRoot,
              })
            : await lintProgram({ programRoot: artifactPath, repoRoot })
          : values.ready === true
            ? await lintExecPlanReadiness({
                planPath: artifactPath,
                repoRoot,
              })
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
