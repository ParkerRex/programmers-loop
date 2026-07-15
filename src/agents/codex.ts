import { mkdir, open } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { runProcess } from "../process.js"
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

function safeRunId(): string {
  return `${new Date().toISOString().replaceAll(":", "-")}-${process.pid}`
}

export function buildCodexExecArgs(
  request: AgentRunRequest,
  lastMessagePath: string,
  reasoningEffort: string | null = null,
): string[] {
  // Codex sets reasoning effort per run via `-c model_reasoning_effort=<level>`;
  // verified against codex-cli 0.144.3 (`high` accepted, exit 0). The value is
  // parsed as TOML, so it is quoted exactly like the approval-policy override.
  const effortArgs = reasoningEffort
    ? ["--config", `model_reasoning_effort="${reasoningEffort}"`]
    : []
  if (request.sessionId) {
    const args = [
      "exec",
      "resume",
      request.sessionId,
      "--json",
      "--output-last-message",
      lastMessagePath,
      "--config",
      'approval_policy="never"',
      ...effortArgs,
    ]
    if (request.model) args.push("--model", request.model)
    if (request.outputSchemaPath) {
      args.push("--output-schema", request.outputSchemaPath)
    }
    args.push("-")
    return args
  }
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
    ...effortArgs,
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

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function numeric(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

/**
 * Codex item types that represent tool activity rather than model prose.
 * Inferred defensively; unknown types simply do not count as tool calls.
 */
const CODEX_TOOL_ITEM_TYPES = new Set([
  "command_execution",
  "custom_tool_call",
  "file_change",
  "function_call",
  "local_shell_call",
  "mcp_tool_call",
  "patch_apply",
  "web_search",
])

function codexTokenUsage(value: unknown): AgentUsage | null {
  const source = record(value)
  if (!source) return null
  const input = numeric(source.input_tokens)
  const cached =
    numeric(source.cached_input_tokens) ??
    numeric(source.cache_read_input_tokens)
  const output = numeric(source.output_tokens)
  const reasoning =
    numeric(source.reasoning_output_tokens) ?? numeric(source.reasoning_tokens)
  if (
    input === null &&
    cached === null &&
    output === null &&
    reasoning === null
  ) {
    return null
  }
  const usage = emptyAgentUsage()
  // Codex reports OpenAI-style input counts that include cached tokens;
  // normalize to the cache-exclusive convention AgentUsage documents. Verified
  // against a live codex-cli 0.144.3 `--json` transcript, whose
  // `turn.completed.usage.input_tokens` includes `cached_input_tokens`
  // (e.g. input_tokens=18117 with cached_input_tokens=9984 => 8133 fresh input).
  usage.inputTokens = input === null ? null : Math.max(input - (cached ?? 0), 0)
  usage.cachedInputTokens = cached
  usage.outputTokens = output
  usage.reasoningTokens = reasoning
  return usage
}

/**
 * Accumulates AgentUsage from Codex `--json` events. The live shape verified on
 * codex-cli 0.144.3 is a per-turn `usage` object carried on each
 * `turn.completed` event; per-turn usages are summed. A cumulative
 * `total_token_usage`/`info.total_token_usage` report — not emitted by 0.144.3
 * but retained as a defensive fallback for other/older CLI shapes — wins over
 * the sum when present. Fields the stream never reported stay null. Codex emits
 * no cost field, so costUsd stays null unless a `total_cost_usd` ever appears;
 * auth mode is not in the event stream and is attached by the adapter from
 * `~/.codex/auth.json` (see {@link codexAuthMode}).
 */
export function parseCodexUsage(events: unknown[]): AgentUsage | null {
  let cumulative: AgentUsage | null = null
  let summed: AgentUsage | null = null
  let usageEvents = 0
  let itemEvents = 0
  let toolCalls = 0
  let costUsd: number | null = null
  for (const event of events) {
    const entry = record(event)
    if (!entry) continue
    const info = record(entry.info) ?? record(record(entry.payload)?.info)
    const total =
      codexTokenUsage(entry.total_token_usage) ??
      codexTokenUsage(info?.total_token_usage)
    if (total) cumulative = total
    const perEvent =
      codexTokenUsage(entry.usage) ??
      (total !== null
        ? null
        : (codexTokenUsage(info?.last_token_usage) ??
          (typeof entry.type === "string" && entry.type.includes("token_count")
            ? codexTokenUsage(entry)
            : null)))
    if (perEvent) {
      usageEvents += 1
      summed = summed ? addAgentUsage(summed, perEvent) : perEvent
    }
    const cost = numeric(entry.total_cost_usd)
    if (cost !== null) costUsd = cost
    if (entry.type === "item.completed") {
      itemEvents += 1
      const item = record(entry.item)
      const itemType =
        typeof item?.type === "string"
          ? item.type
          : typeof item?.item_type === "string"
            ? item.item_type
            : ""
      if (CODEX_TOOL_ITEM_TYPES.has(itemType)) toolCalls += 1
    }
  }
  const tokens = cumulative ?? summed
  if (!tokens && itemEvents === 0 && costUsd === null) return null
  const usage = tokens ? { ...tokens } : emptyAgentUsage()
  // Per-event usage reports approximate model calls (turns for Codex); a
  // cumulative-only stream leaves the call count unknown.
  usage.modelCalls = cumulative === null && usageEvents > 0 ? usageEvents : null
  usage.toolCalls = itemEvents > 0 ? toolCalls : null
  usage.costUsd = costUsd
  return hasAgentUsageSignal(usage) ? usage : null
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

function findSessionId(events: unknown[]): string | undefined {
  for (const event of events) {
    const entry = record(event)
    if (!entry) continue
    for (const key of ["thread_id", "session_id"] as const) {
      if (typeof entry[key] === "string") return entry[key]
    }
    if (
      entry.type === "thread.started" &&
      typeof entry.thread_id === "string"
    ) {
      return entry.thread_id
    }
  }
  return undefined
}

async function readBoundedText(
  filePath: string,
  maxBytes: number,
): Promise<string> {
  const handle = await open(filePath, "r")
  try {
    const buffer = Buffer.alloc(maxBytes)
    const { bytesRead } = await handle.read(buffer, 0, maxBytes, 0)
    return buffer.subarray(0, bytesRead).toString("utf8")
  } finally {
    await handle.close()
  }
}

/**
 * Resolve the Codex auth mode from the raw contents of `~/.codex/auth.json`.
 * Codex serializes its `AuthMode` enum lowercase (verified against codex-cli
 * 0.144.3 and the codex `AuthMode` definition, `#[serde(rename_all =
 * "lowercase")]`): `chatgpt` and the internal `chatgptAuthTokens` are ChatGPT
 * subscription auth; `apikey` is a stored OpenAI API key. A non-empty
 * `OPENAI_API_KEY` is the API-key fallback when `auth_mode` is missing.
 * Anything unrecognized or unparseable yields null — the mode is never guessed.
 */
export function codexAuthMode(authText: string | null): AgentAuthMode | null {
  if (authText === null) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(authText)
  } catch {
    return null
  }
  const root = record(parsed)
  if (!root) return null
  const mode = root.auth_mode
  if (mode === "chatgpt" || mode === "chatgptAuthTokens") return "subscription"
  if (mode === "apikey") return "api-key"
  const apiKey = root.OPENAI_API_KEY
  if (typeof apiKey === "string" && apiKey.trim() !== "") return "api-key"
  return null
}

/** `$CODEX_HOME`, else the conventional `~/.codex`. */
function defaultCodexHome(): string {
  const fromEnv = process.env.CODEX_HOME
  return fromEnv && fromEnv.trim() !== ""
    ? fromEnv
    : path.join(os.homedir(), ".codex")
}

/**
 * Best-effort read of the Codex auth mode. A missing or unreadable auth file is
 * not an error: authMode simply stays null (never guessed).
 */
async function readCodexAuthMode(
  codexHome: string,
): Promise<AgentAuthMode | null> {
  try {
    return codexAuthMode(
      await readBoundedText(path.join(codexHome, "auth.json"), 64 * 1024),
    )
  } catch {
    return null
  }
}

export type CodexAdapterOptions = {
  /** Directory holding `auth.json`; defaults to `$CODEX_HOME` or `~/.codex`. */
  codexHome?: string
  /** Reasoning-effort level passed as `-c model_reasoning_effort`. */
  reasoningEffort?: string | null
  /**
   * Wraps the host spawn (e.g. inside `docker run` for a containerized eval
   * run); defaults to {@link hostLauncher}, which runs the CLI on the host
   * exactly as before. The Codex argv this adapter builds references the
   * sandbox by absolute path, so a container launcher must bind-mount that path
   * identically for the argv to resolve unchanged (see `src/evals/sandbox.ts`).
   */
  launcher?: ProcessLauncher
}

export class CodexAdapter implements AgentAdapter {
  readonly id = "codex"
  private readonly codexHome: string
  private readonly reasoningEffort: string | null
  private readonly launcher: ProcessLauncher

  constructor(
    private readonly command = "codex",
    options: CodexAdapterOptions = {},
  ) {
    this.codexHome = options.codexHome ?? defaultCodexHome()
    this.reasoningEffort = options.reasoningEffort ?? null
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
    // A per-run request effort wins over the adapter-level default so a single
    // adapter instance can pin effort per episode (Decision D3); the constructor
    // option remains the fallback for programmatic callers that set it once.
    const reasoningEffort = request.reasoningEffort ?? this.reasoningEffort
    // Apply the launcher seam: host mode is the identity transform; container
    // mode rewrites this into `docker run … codex …`. The last-message file and
    // event transcript live under `request.cwd/.runtime`, which the container
    // launcher bind-mounts identically, so the host-side reads below still find
    // them regardless of where the process ran. `cleanup` reclaims any container
    // even when the run times out.
    const launched = this.launcher({
      command: this.command,
      args: buildCodexExecArgs(request, lastMessagePath, reasoningEffort),
      cwd: request.cwd,
    })
    let result
    try {
      result = await runProcess({
        command: launched.command,
        args: launched.args,
        cwd: launched.cwd,
        input: request.prompt,
        maxOutputBytes: request.maxOutputBytes,
        timeoutMs: request.timeoutMs,
      })
    } finally {
      await launched.cleanup()
    }
    const events = parseJsonlEvents(result.stdout)
    const eventsPath = await persistAgentEvents(
      this.id,
      request.cwd,
      result.stdout,
    )
    let lastMessage = ""
    try {
      lastMessage = await readBoundedText(
        lastMessagePath,
        request.maxOutputBytes ?? 1024 * 1024,
      )
    } catch {
      lastMessage = ""
    }
    // Codex never reports auth mode in the event stream; read it from the
    // local auth file so every episode records how the run was authenticated
    // (Decision 12). Attach it even when token usage is absent.
    const authMode = await readCodexAuthMode(this.codexHome)
    const parsedUsage = parseCodexUsage(events)
    const usage =
      authMode === null
        ? parsedUsage
        : parsedUsage
          ? { ...parsedUsage, authMode }
          : { ...emptyAgentUsage(), authMode }
    return {
      exitCode: result.exitCode,
      events,
      eventsPath,
      lastMessage,
      stderr: result.stderr,
      stderrTruncated: result.stderrTruncated,
      timedOut: result.timedOut,
      sessionId: findSessionId(events),
      usage,
    }
  }
}
