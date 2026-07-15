import { readFile } from "node:fs/promises"
import path from "node:path"

import { runProcess, type ProcessResult } from "../process.js"
import { createRunId, writeRuntimeText } from "../runtime/store.js"
import {
  addAgentUsage,
  emptyAgentUsage,
  hasAgentUsageSignal,
  hostLauncher,
  parseJsonlEvents,
} from "./types.js"
import type {
  AgentAdapter,
  AgentAuthMode,
  AgentHealth,
  AgentRunRequest,
  AgentRunResult,
  AgentUsage,
  ProcessLauncher,
} from "./types.js"

/** Built-in Claude Code tools that mutate the workspace or run commands. */
const MUTATING_TOOLS = "Bash Edit MultiEdit NotebookEdit Write"

/**
 * read-only additionally denies worktree escapes; tool names the installed
 * CLI does not know are simply ignored.
 */
const READ_ONLY_DISALLOWED = `${MUTATING_TOOLS} EnterWorktree ExitWorktree`

/**
 * Builds a non-interactive `claude` invocation. The prompt always travels
 * over stdin, never argv. Verified against Claude Code 2.1.206:
 * - `-p --output-format stream-json --verbose` emits JSONL events plus a
 *   final `result` record (stream-json requires verbose in print mode).
 * - `--setting-sources project,local --strict-mcp-config` keeps user-level
 *   settings and ambient MCP servers out of automated runs.
 * - Sandboxing never uses `--dangerously-skip-permissions`: read-only relies
 *   on print mode auto-denying permission prompts plus an explicit deny list,
 *   and workspace-write grants only the mutating tools via
 *   `--permission-mode acceptEdits` with `--allowedTools`.
 */
export function buildClaudeArgs(
  request: AgentRunRequest,
  outputSchemaJson: string | null,
): string[] {
  const args = [
    "-p",
    "--output-format",
    "stream-json",
    "--verbose",
    "--setting-sources",
    "project,local",
    "--strict-mcp-config",
  ]
  if (request.sessionId) {
    // Resume the exact session; keep it persistent so later rounds can too.
    args.push("--resume", request.sessionId)
  } else if (request.ephemeral) {
    args.push("--no-session-persistence")
  }
  if (request.sandbox === "read-only") {
    args.push("--disallowedTools", READ_ONLY_DISALLOWED)
  } else {
    args.push(
      "--permission-mode",
      "acceptEdits",
      "--allowedTools",
      MUTATING_TOOLS,
    )
  }
  if (request.model) args.push("--model", request.model)
  // Effort pinning is not codex-only: Claude Code 2.1.206 exposes `--effort
  // <level>` (confirmed in `claude --help`), so pin D3's requested level here
  // rather than recording intent without applying it.
  if (request.reasoningEffort) {
    args.push("--effort", request.reasoningEffort)
  }
  if (request.maxTurns !== undefined) {
    args.push("--max-turns", String(request.maxTurns))
  }
  if (outputSchemaJson !== null) args.push("--json-schema", outputSchemaJson)
  return args
}

/**
 * Env var the Claude CLI reads to override the small/fast model it uses for
 * incidental background/utility calls (side-queries, summaries). Confirmed
 * against Claude Code 2.1.206: the string is present in the installed binary,
 * and the changelog documents that background side-queries fall back to a
 * Haiku model ID when this override is unset — the exact drift observed as
 * `claude-haiku-4-5` events in smoke runs.
 */
export const SMALL_FAST_MODEL_ENV = "ANTHROPIC_SMALL_FAST_MODEL"

/**
 * Spawn environment for a Claude run. When the run explicitly configures a
 * subject model, pin the CLI's utility model to it so incidental internal
 * calls cannot drift to a different model (Decision D13). When no model is
 * configured, the parent env passes through untouched.
 */
export function buildClaudeEnv(
  request: AgentRunRequest,
  baseEnv: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  // Mirror buildClaudeArgs' `--model` gate: pin only when a model is set.
  if (!request.model) return baseEnv
  return { ...baseEnv, [SMALL_FAST_MODEL_ENV]: request.model }
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function numeric(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

function authModeFromInit(
  entry: Record<string, unknown>,
): AgentAuthMode | null {
  const source = entry.apiKeySource
  if (typeof source !== "string" || source === "") return null
  return source === "none" ? "subscription" : "api-key"
}

/** Reads Anthropic-style token counts from a `usage` record on `holder`. */
function claudeTokenUsage(
  holder: Record<string, unknown> | null,
): AgentUsage | null {
  const source = record(holder?.usage)
  if (!source) return null
  const input = numeric(source.input_tokens)
  const cacheCreation = numeric(source.cache_creation_input_tokens)
  const usage = emptyAgentUsage()
  // Anthropic input counts exclude cache activity; fold cache-creation
  // tokens into inputTokens per the AgentUsage contract.
  usage.inputTokens =
    input === null && cacheCreation === null
      ? null
      : (input ?? 0) + (cacheCreation ?? 0)
  usage.cachedInputTokens = numeric(source.cache_read_input_tokens)
  usage.outputTokens = numeric(source.output_tokens)
  return hasAgentUsageSignal(usage) ? usage : null
}

function assistantText(message: Record<string, unknown> | null): string {
  const content = message?.content
  if (!Array.isArray(content)) return ""
  return content
    .map((block) => {
      const entry = record(block)
      return entry?.type === "text" && typeof entry.text === "string"
        ? entry.text
        : ""
    })
    .filter((text) => text !== "")
    .join("\n")
}

function countToolUses(message: Record<string, unknown> | null): number {
  const content = message?.content
  if (!Array.isArray(content)) return 0
  return content.filter((block) => record(block)?.type === "tool_use").length
}

export type ClaudeRunSummary = {
  lastMessage: string
  sessionId: string | undefined
  usage: AgentUsage | null
}

/**
 * Extracts the final message, session id, and usage from a stream-json run.
 * The `result` record is authoritative for main-loop tokens; when a run is
 * cut short we fall back to summing assistant-message usage. Note that
 * `total_cost_usd` also covers helper models the token fields do not.
 */
export function summarizeClaudeEvents(events: unknown[]): ClaudeRunSummary {
  let sessionId: string | undefined
  let authMode: AgentAuthMode | null = null
  let assistantUsage: AgentUsage | null = null
  let assistantCalls = 0
  let toolUses = 0
  let sawAssistant = false
  let lastAssistantText = ""
  let resultUsage: AgentUsage | null = null
  let resultText: string | null = null
  for (const event of events) {
    const entry = record(event)
    if (!entry) continue
    if (sessionId === undefined && typeof entry.session_id === "string") {
      sessionId = entry.session_id
    }
    if (entry.type === "system" && entry.subtype === "init") {
      authMode = authModeFromInit(entry) ?? authMode
    } else if (entry.type === "assistant") {
      sawAssistant = true
      assistantCalls += 1
      const message = record(entry.message)
      const usage = claudeTokenUsage(message)
      if (usage) {
        assistantUsage = assistantUsage
          ? addAgentUsage(assistantUsage, usage)
          : usage
      }
      toolUses += countToolUses(message)
      const text = assistantText(message)
      if (text !== "") lastAssistantText = text
    } else if (entry.type === "result") {
      resultUsage = claudeTokenUsage(entry)
      const cost = numeric(entry.total_cost_usd)
      if (cost !== null) {
        resultUsage = resultUsage ?? emptyAgentUsage()
        resultUsage.costUsd = cost
      }
      if (typeof entry.result === "string") {
        resultText = entry.result
      } else if (entry.structured_output !== undefined) {
        resultText = JSON.stringify(entry.structured_output)
      }
    }
  }
  const tokens = resultUsage ?? assistantUsage
  let usage: AgentUsage | null = null
  if (tokens !== null || sawAssistant || authMode !== null) {
    usage = tokens ? { ...tokens } : emptyAgentUsage()
    usage.modelCalls = sawAssistant ? assistantCalls : null
    usage.toolCalls = sawAssistant ? toolUses : null
    usage.authMode = authMode
    if (!hasAgentUsageSignal(usage)) usage = null
  }
  return {
    lastMessage: resultText ?? lastAssistantText,
    sessionId,
    usage,
  }
}

async function persistAgentEvents(
  adapterId: string,
  cwd: string,
  stdout: string,
): Promise<string | null> {
  const lines = stdout.split("\n").filter((line) => line.trim() !== "")
  try {
    return await writeRuntimeText({
      relativePath: path.join(
        ".runtime",
        "agent-events",
        `${createRunId(adapterId)}.jsonl`,
      ),
      repoRoot: cwd,
      text: lines.length > 0 ? `${lines.join("\n")}\n` : "",
    })
  } catch {
    // Durable event capture must never fail the agent run itself.
    return null
  }
}

/**
 * Overlays the utility-model pin onto process.env for the synchronous spawn
 * only, then restores it. runProcess spawns from `process.env`
 * (src/process.ts: `spawn(command, args, { env: process.env })`) and exposes no
 * env override, so this relies on runProcess calling `spawn` synchronously
 * inside its Promise executor: the child snapshots env at that call, and — because
 * this returns the spawn promise WITHOUT awaiting it — the `finally` restores
 * env immediately after that synchronous spawn. The mutation window never spans
 * an await, so concurrent runs cannot observe or clobber each other's pin. In
 * container mode the launcher additionally forwards SMALL_FAST_MODEL_ENV by name
 * (never value) with `docker run -e`, so `docker` reads the pinned value from
 * this same window.
 */
function spawnClaudeWithPin(
  request: AgentRunRequest,
  options: Parameters<typeof runProcess>[0],
): Promise<ProcessResult> {
  const pinned = buildClaudeEnv(request)[SMALL_FAST_MODEL_ENV]
  // A no-model run returns the parent env unchanged, so `pinned` equals the
  // ambient value and we spawn without touching process.env.
  if (pinned === undefined || pinned === process.env[SMALL_FAST_MODEL_ENV]) {
    return runProcess(options)
  }
  const had = SMALL_FAST_MODEL_ENV in process.env
  const previous = process.env[SMALL_FAST_MODEL_ENV]
  process.env[SMALL_FAST_MODEL_ENV] = pinned
  try {
    // No await: the finally restores env right after the synchronous spawn.
    return runProcess(options)
  } finally {
    if (had) process.env[SMALL_FAST_MODEL_ENV] = previous
    else delete process.env[SMALL_FAST_MODEL_ENV]
  }
}

/**
 * Spawns the CLI through the launcher seam with the utility-model pin applied.
 * Host mode is the identity transform (byte-for-byte the prior host spawn);
 * container mode rewrites this into `docker run … claude …`. `cleanup` runs in
 * the outer `finally` after `await` — i.e. after the process completes — so a
 * container launcher's teardown never kills a still-running container; the
 * env-pin window stays inside {@link spawnClaudeWithPin} and never spans that
 * await.
 */
async function runClaudeProcess(
  command: string,
  request: AgentRunRequest,
  outputSchemaJson: string | null,
  launcher: ProcessLauncher,
): Promise<ProcessResult> {
  const launched = launcher({
    command,
    args: buildClaudeArgs(request, outputSchemaJson),
    cwd: request.cwd,
  })
  const options = {
    command: launched.command,
    args: launched.args,
    cwd: launched.cwd,
    input: request.prompt,
    maxOutputBytes: request.maxOutputBytes,
    timeoutMs: request.timeoutMs,
  }
  try {
    return await spawnClaudeWithPin(request, options)
  } finally {
    await launched.cleanup()
  }
}

export type ClaudeAdapterOptions = {
  /**
   * Wraps the host spawn (e.g. inside `docker run` for a containerized eval
   * run); defaults to {@link hostLauncher}, which runs the CLI on the host
   * exactly as before. The Claude argv references the sandbox by absolute path,
   * so a container launcher must bind-mount that path identically for the argv
   * to resolve unchanged (see `src/evals/sandbox.ts`).
   */
  launcher?: ProcessLauncher
}

export class ClaudeAdapter implements AgentAdapter {
  readonly id = "claude"
  private readonly launcher: ProcessLauncher

  constructor(
    private readonly command = "claude",
    options: ClaudeAdapterOptions = {},
  ) {
    this.launcher = options.launcher ?? hostLauncher
  }

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
            : "Claude command returned a non-zero status.",
      }
    } catch {
      return { available: false, detail: "Claude command was not found." }
    }
  }

  async run(request: AgentRunRequest): Promise<AgentRunResult> {
    // `--json-schema` takes inline JSON, so surface the schema file content.
    const outputSchemaJson = request.outputSchemaPath
      ? await readFile(request.outputSchemaPath, "utf8")
      : null
    const result = await runClaudeProcess(
      this.command,
      request,
      outputSchemaJson,
      this.launcher,
    )
    const events = parseJsonlEvents(result.stdout)
    const eventsPath = await persistAgentEvents(
      this.id,
      request.cwd,
      result.stdout,
    )
    const summary = summarizeClaudeEvents(events)
    return {
      exitCode: result.exitCode,
      events,
      eventsPath,
      lastMessage: summary.lastMessage,
      stderr: result.stderr,
      stderrTruncated: result.stderrTruncated,
      timedOut: result.timedOut,
      sessionId: summary.sessionId,
      usage: summary.usage,
    }
  }
}
