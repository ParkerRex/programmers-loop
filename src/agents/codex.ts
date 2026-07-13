import { mkdir, readFile } from "node:fs/promises"
import path from "node:path"

import { runProcess } from "../process.js"
import type {
  AgentAdapter,
  AgentHealth,
  AgentRunRequest,
  AgentRunResult,
} from "./types.js"

function safeRunId(): string {
  return `${new Date().toISOString().replaceAll(":", "-")}-${process.pid}`
}

export function buildCodexExecArgs(
  request: AgentRunRequest,
  lastMessagePath: string,
): string[] {
  const args = [
    "exec",
    "--cd",
    request.cwd,
    "--sandbox",
    request.sandbox,
    "--json",
    "--output-last-message",
    lastMessagePath,
    "--config",
    'approval_policy="never"',
  ]
  if (request.ephemeral) args.push("--ephemeral")
  if (request.model) args.push("--model", request.model)
  if (request.profile) args.push("--profile", request.profile)
  if (request.outputSchemaPath) {
    args.push("--output-schema", request.outputSchemaPath)
  }
  args.push("-")
  return args
}

function parseEvents(stdout: string): unknown[] {
  return stdout
    .split("\n")
    .filter((line) => line.trim() !== "")
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as unknown]
      } catch {
        return []
      }
    })
}

function findSessionId(events: unknown[]): string | undefined {
  for (const event of events) {
    if (event === null || typeof event !== "object") continue
    const record = event as Record<string, unknown>
    for (const key of ["thread_id", "session_id"] as const) {
      if (typeof record[key] === "string") return record[key]
    }
    if (
      record.type === "thread.started" &&
      typeof record.thread_id === "string"
    ) {
      return record.thread_id
    }
  }
  return undefined
}

export class CodexAdapter implements AgentAdapter {
  readonly id = "codex"

  constructor(private readonly command = "codex") {}

  async doctor(cwd: string): Promise<AgentHealth> {
    try {
      const result = await runProcess({
        command: this.command,
        args: ["--version"],
        cwd,
        timeoutMs: 10_000,
      })
      return {
        available: result.exitCode === 0,
        detail:
          result.exitCode === 0
            ? result.stdout.trim()
            : "Codex command returned a non-zero status.",
      }
    } catch {
      return { available: false, detail: "Codex command was not found." }
    }
  }

  async run(request: AgentRunRequest): Promise<AgentRunResult> {
    const outputRoot = path.join(request.cwd, ".runtime", "agent-output")
    await mkdir(outputRoot, { recursive: true })
    const lastMessagePath = path.join(outputRoot, `${safeRunId()}.md`)
    const result = await runProcess({
      command: this.command,
      args: buildCodexExecArgs(request, lastMessagePath),
      cwd: request.cwd,
      input: request.prompt,
    })
    const events = parseEvents(result.stdout)
    let lastMessage = ""
    try {
      lastMessage = await readFile(lastMessagePath, "utf8")
    } catch {
      lastMessage = ""
    }
    return {
      exitCode: result.exitCode,
      events,
      lastMessage,
      stderr: result.stderr,
      sessionId: findSessionId(events),
    }
  }
}
