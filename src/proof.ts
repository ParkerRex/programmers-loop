import { readFile } from "node:fs/promises"
import path from "node:path"

import type { ProgrammersLoopConfig } from "./config.js"
import { lintExecPlan, lintExecPlanReadiness } from "./contracts/exec-plan.js"
import { runProcess, type ProcessResult } from "./process.js"
import {
  resolveExistingRepoPath,
  toRepoPath,
  UserInputError,
} from "./repo-path.js"
import { createRunId, writeRuntimeJson } from "./runtime/store.js"

export type ProofCommand = {
  allowed: boolean
  argv: string[]
  command: string
  reason: string | null
}

export type ProofPreview = {
  commands: ProofCommand[]
  executable: boolean
  planPath: string
}

export type ProofCommandResult = ProofCommand & {
  durationMs: number
  exitCode: number
  stderr: string
  stderrTruncated: boolean
  stdout: string
  stdoutTruncated: boolean
  timedOut: boolean
}

export type ProofReceipt = {
  schemaVersion: 1
  runId: string
  planPath: string
  startedAt: string
  completedAt: string
  status: "passed" | "failed" | "rejected"
  commands: ProofCommandResult[]
  preview: ProofCommand[]
  receiptPath: string
}

export type ProofProcessRunner = (params: {
  args: string[]
  command: string
  cwd: string
  maxOutputBytes: number
  timeoutMs: number
}) => Promise<ProcessResult>

function extractTestCommandLines(source: string): string[] {
  const lines = source.split(/\r?\n/)
  let inValidation = false
  let inTestCommands = false
  let inFence = false
  const commands: string[] = []

  for (const line of lines) {
    const heading = /^(#{1,6})\s+(.+?)\s*$/.exec(line)
    if (heading) {
      const level = heading[1]?.length ?? 0
      const title = heading[2]
      if (level === 2) {
        inValidation = title === "Validation and Acceptance"
        inTestCommands = false
        inFence = false
      } else if (level === 3 && inValidation) {
        inTestCommands = title === "Test Commands"
        inFence = false
      } else if (level <= 3) {
        inTestCommands = false
        inFence = false
      }
      continue
    }
    if (!inTestCommands) continue
    if (/^\s*```/.test(line)) {
      inFence = !inFence
      continue
    }
    if (!inFence) continue
    const command = line.trim().replace(/^\$\s+/, "")
    if (command !== "" && !command.startsWith("#")) commands.push(command)
  }
  return commands
}

export function tokenizeCommand(source: string): string[] {
  if (source.includes("\n") || source.includes("\r")) {
    throw new UserInputError("Proof commands must occupy one line each.")
  }
  if (source.endsWith("\\")) {
    throw new UserInputError("Proof commands cannot use line continuations.")
  }

  const tokens: string[] = []
  let token = ""
  let quote: "'" | '"' | null = null
  let escaping = false
  let hasToken = false

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index]
    if (escaping) {
      token += character
      hasToken = true
      escaping = false
      continue
    }
    if (character === "\\" && quote !== "'") {
      escaping = true
      continue
    }
    if (character === "'" || character === '"') {
      if (quote === null) {
        quote = character
        hasToken = true
        continue
      }
      if (quote === character) {
        quote = null
        continue
      }
    }
    if (quote === null && /[;&|<>`]/.test(character)) {
      throw new UserInputError(
        `Unsupported shell operator in proof command: ${character}`,
      )
    }
    if (quote === null && /\s/.test(character)) {
      if (hasToken) {
        tokens.push(token)
        token = ""
        hasToken = false
      }
      continue
    }
    token += character
    hasToken = true
  }
  if (escaping || quote !== null) {
    throw new UserInputError("Proof command has an unfinished escape or quote.")
  }
  if (hasToken) tokens.push(token)
  if (tokens.length === 0) {
    throw new UserInputError("Proof command must not be empty.")
  }
  if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[0] ?? "")) {
    throw new UserInputError(
      "Proof commands cannot begin with environment assignments.",
    )
  }
  if (source.includes("$(") || source.includes("${")) {
    throw new UserInputError("Proof commands cannot use shell substitution.")
  }
  return tokens
}

function isContained(repoRoot: string, candidate: string): boolean {
  const absolute = path.resolve(repoRoot, candidate)
  const relative = path.relative(repoRoot, absolute)
  return relative !== ".." && !relative.startsWith(`..${path.sep}`)
}

function validatePathArguments(
  repoRoot: string,
  argv: string[],
): string | null {
  for (const argument of argv) {
    const value = argument.includes("=")
      ? argument.slice(argument.indexOf("=") + 1)
      : argument
    if (value.startsWith("~")) {
      return `Home-relative path is not allowed: ${argument}`
    }
    const pathLike =
      path.isAbsolute(value) ||
      value === ".." ||
      value.startsWith("../") ||
      value.startsWith("..\\") ||
      value.includes("/../") ||
      value.includes("\\..\\")
    if (pathLike && !isContained(repoRoot, value)) {
      return `Path escapes the repository: ${argument}`
    }
  }
  return null
}

function prefixAllowed(argv: string[], allowedPrefixes: string[]): boolean {
  return allowedPrefixes.some((prefix) => {
    const prefixTokens = tokenizeCommand(prefix)
    return prefixTokens.every((token, index) => argv[index] === token)
  })
}

function classifyCommand(params: {
  allowedPrefixes: string[]
  command: string
  repoRoot: string
}): ProofCommand {
  try {
    const argv = tokenizeCommand(params.command)
    const pathIssue = validatePathArguments(params.repoRoot, argv)
    if (pathIssue) {
      return {
        allowed: false,
        argv,
        command: params.command,
        reason: pathIssue,
      }
    }
    if (!prefixAllowed(argv, params.allowedPrefixes)) {
      return {
        allowed: false,
        argv,
        command: params.command,
        reason: "Command does not match a configured token prefix.",
      }
    }
    return { allowed: true, argv, command: params.command, reason: null }
  } catch (error) {
    return {
      allowed: false,
      argv: [],
      command: params.command,
      reason: error instanceof Error ? error.message : "Invalid command.",
    }
  }
}

export async function previewProof(params: {
  config: ProgrammersLoopConfig
  planPath: string
  repoRoot: string
}): Promise<ProofPreview> {
  const planPath = await resolveExistingRepoPath(
    params.repoRoot,
    params.planPath,
  )
  const lintIssues = await lintExecPlan({ planPath, repoRoot: params.repoRoot })
  if (lintIssues.length > 0) {
    throw new UserInputError(
      `ExecPlan is invalid: ${lintIssues[0]?.path}: ${lintIssues[0]?.message}`,
    )
  }
  const source = await readFile(planPath, "utf8")
  const commands = extractTestCommandLines(source).map((command) =>
    classifyCommand({
      allowedPrefixes: params.config.proof.allowedCommandPrefixes,
      command,
      repoRoot: params.repoRoot,
    }),
  )
  return {
    commands,
    executable:
      commands.length > 0 && commands.every((command) => command.allowed),
    planPath: toRepoPath(params.repoRoot, planPath),
  }
}

function emptyResult(command: ProofCommand): ProofCommandResult {
  return {
    ...command,
    durationMs: 0,
    exitCode: 1,
    stderr: command.reason ?? "Command was rejected.",
    stderrTruncated: false,
    stdout: "",
    stdoutTruncated: false,
    timedOut: false,
  }
}

export async function executeProof(params: {
  approvedPreview?: ProofPreview
  config: ProgrammersLoopConfig
  planPath: string
  repoRoot: string
  runProcess?: ProofProcessRunner
}): Promise<ProofReceipt> {
  const currentPreview = await previewProof(params)
  const preview = params.approvedPreview ?? currentPreview
  const resolvedPlanPath = await resolveExistingRepoPath(
    params.repoRoot,
    params.planPath,
  )
  if (preview.planPath !== toRepoPath(params.repoRoot, resolvedPlanPath)) {
    throw new UserInputError(
      "Approved proof preview belongs to a different ExecPlan.",
    )
  }
  if (
    params.approvedPreview &&
    JSON.stringify(params.approvedPreview.commands) !==
      JSON.stringify(currentPreview.commands)
  ) {
    throw new UserInputError(
      "Approved proof preview no longer matches the ExecPlan command set.",
    )
  }
  const readinessIssues = await lintExecPlanReadiness({
    planPath: resolvedPlanPath,
    repoRoot: params.repoRoot,
  })
  if (readinessIssues.length > 0) {
    throw new UserInputError(
      `ExecPlan is not execution-ready: ${readinessIssues[0]?.path}: ${readinessIssues[0]?.message}`,
    )
  }
  const runId = createRunId("proof")
  const startedAt = new Date().toISOString()
  const results: ProofCommandResult[] = []
  let status: ProofReceipt["status"] = "passed"
  const runner = params.runProcess ?? runProcess

  if (!preview.executable) {
    status = "rejected"
    results.push(...preview.commands.map(emptyResult))
  } else {
    for (const proofCommand of preview.commands) {
      const [command, ...args] = proofCommand.argv
      if (!command) continue
      const started = Date.now()
      let result: ProcessResult
      try {
        result = await runner({
          command,
          args,
          cwd: params.repoRoot,
          maxOutputBytes: params.config.proof.maxOutputBytes,
          timeoutMs: params.config.proof.commandTimeoutMs,
        })
      } catch (error) {
        result = {
          exitCode: 1,
          stderr:
            error instanceof Error
              ? error.message
              : "Proof process could not be started.",
          stderrTruncated: false,
          stdout: "",
          stdoutTruncated: false,
          timedOut: false,
        }
      }
      results.push({
        ...proofCommand,
        durationMs: Date.now() - started,
        exitCode: result.exitCode,
        stderr: result.stderr,
        stderrTruncated: result.stderrTruncated,
        stdout: result.stdout,
        stdoutTruncated: result.stdoutTruncated,
        timedOut: result.timedOut,
      })
      if (result.exitCode !== 0 || result.timedOut) {
        status = "failed"
        break
      }
    }
  }

  const relativeReceiptPath = path.join(".runtime", "proof", `${runId}.json`)
  const receipt: ProofReceipt = {
    schemaVersion: 1,
    runId,
    planPath: preview.planPath,
    startedAt,
    completedAt: new Date().toISOString(),
    status,
    commands: results,
    preview: preview.commands,
    receiptPath: relativeReceiptPath.split(path.sep).join("/"),
  }
  await writeRuntimeJson({
    relativePath: relativeReceiptPath,
    repoRoot: params.repoRoot,
    value: receipt,
  })
  return receipt
}
