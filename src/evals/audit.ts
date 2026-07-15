import type { TaskScope } from "./task-package.js"

/**
 * Anti-loop and constraint AUDIT signals over an episode's captured event
 * stream (the "Better Harnesses, Smaller Models" validation-hook family). This
 * module is v1 = DETECTION, not intervention: every function is pure and returns
 * observations, never mutates a run, changes a disposition, or aborts an agent.
 *
 * Wiring is deliberately left to the report/adapt tooling rather than the live
 * harness. The runner persists one agent-event JSONL per agent call (direct: one
 * file; loop: one per spine phase) under each sandbox's `.runtime/agent-events/`.
 * The report tooling reads those files for BOTH arms uniformly, parses each into
 * `unknown[]`, and calls {@link auditEpisode}. Auditing only the direct arm from
 * inside the harness would be trivial (its `AgentRunResult.events` are in memory)
 * but the loop exec-plan phases expose only an `eventsPath`, so an in-harness
 * hook would annotate baseline/skip episodes and silently skip exec-plan ones —
 * an arm asymmetry in exactly the comparability dimension this suite guards.
 * Reading persisted event files symmetrically avoids that.
 *
 * The extractor normalizes both adapters' event shapes:
 * - Claude stream-json: `assistant` messages carry `tool_use` blocks; matching
 *   `user` messages carry `tool_result` blocks (correlated by `tool_use_id`).
 *   A tool result flags failure with `is_error`; it carries no exit code.
 * - Codex `--json`: tool activity is an `item.completed` whose `item.type` is
 *   `command_execution`, carrying `command`, `exit_code`, and `aggregated_output`.
 */

/** A normalized tool invocation lifted from a raw agent event stream. */
export type AuditToolCall = {
  /** Provider tool name (`Bash`, `Edit`, `command_execution`, ...). */
  tool: string
  /** The shell command when the tool ran one, else null. */
  command: string | null
  /** Serialized tool input (bounded), for scanning args such as URLs or paths. */
  inputText: string
  /** Captured result output/stderr for the call, "" when none was recorded. */
  output: string
  /** Structured exit code when the provider reports one (Codex), else null. */
  exitCode: number | null
  /** True when the provider flagged the call failed (Claude `is_error`; Codex non-zero exit / `failed`). */
  failed: boolean
}

export type AuditSignalKind =
  | "repeated-failing-command"
  | "exit-127"
  | "forbidden-path-touch"
  | "out-of-declared-network"

/** One detected audit observation. `heuristic` marks low-confidence signals. */
export type AuditSignal = {
  kind: AuditSignalKind
  detail: string
  evidence: string[]
  /** True when the signal rests on a text heuristic rather than a structured fact. */
  heuristic: boolean
}

const MAX_FIELD_CHARS = 20_000

function bounded(text: string): string {
  return text.length <= MAX_FIELD_CHARS ? text : text.slice(0, MAX_FIELD_CHARS)
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

/** The `content` array of a Claude message, or [] when absent/misshaped. */
function messageContent(message: unknown): unknown[] {
  const content = asRecord(message)?.content
  return Array.isArray(content) ? content : []
}

/** Flatten a Claude `tool_result.content` (string or block array) to text. */
function resultText(content: unknown): string {
  if (typeof content === "string") return content
  if (!Array.isArray(content)) return ""
  return content
    .map((block) => {
      const entry = asRecord(block)
      if (entry && typeof entry.text === "string") return entry.text
      return typeof block === "string" ? block : ""
    })
    .filter((text) => text !== "")
    .join("\n")
}

/**
 * Lift a normalized, order-preserving list of tool calls from a parsed event
 * stream. Handles both the Claude and Codex event shapes; unknown events and
 * non-tool blocks are ignored.
 */
export function extractToolCalls(events: unknown[]): AuditToolCall[] {
  const calls: AuditToolCall[] = []
  const byId = new Map<string, AuditToolCall>()
  for (const event of events) {
    const entry = asRecord(event)
    if (!entry) continue
    if (entry.type === "assistant") {
      for (const block of messageContent(entry.message)) {
        const b = asRecord(block)
        if (!b || b.type !== "tool_use") continue
        const input = asRecord(b.input)
        const call: AuditToolCall = {
          tool: typeof b.name === "string" ? b.name : "tool",
          command:
            input && typeof input.command === "string" ? input.command : null,
          inputText: input ? bounded(JSON.stringify(input)) : "",
          output: "",
          exitCode: null,
          failed: false,
        }
        calls.push(call)
        if (typeof b.id === "string") byId.set(b.id, call)
      }
      continue
    }
    if (entry.type === "user") {
      for (const block of messageContent(entry.message)) {
        const b = asRecord(block)
        if (!b || b.type !== "tool_result") continue
        const call =
          typeof b.tool_use_id === "string"
            ? byId.get(b.tool_use_id)
            : undefined
        if (!call) continue
        call.output = bounded(resultText(b.content))
        if (b.is_error === true) call.failed = true
      }
      continue
    }
    if (entry.type === "item.completed") {
      const item = asRecord(entry.item)
      if (!item || item.type !== "command_execution") continue
      const exitCode =
        typeof item.exit_code === "number" ? item.exit_code : null
      calls.push({
        tool: "command_execution",
        command: typeof item.command === "string" ? item.command : null,
        inputText: "",
        output: bounded(
          typeof item.aggregated_output === "string"
            ? item.aggregated_output
            : "",
        ),
        exitCode,
        failed:
          (exitCode !== null && exitCode !== 0) || item.status === "failed",
      })
    }
  }
  return calls
}

const SHELL_WRAPPER =
  /^\s*(?:\/\S+\/)?(?:zsh|bash|sh)\s+-l?c\s+(["'])([\s\S]*)\1\s*$/

/**
 * Canonicalize a command for equality and readable evidence: unwrap a
 * `/bin/zsh -lc "…"` / `sh -c '…'` shell wrapper (Codex wraps every command this
 * way) and collapse whitespace. Two spellings of the same inner command compare
 * equal, and signal evidence shows the command the model actually ran.
 */
export function normalizeCommand(command: string): string {
  const unwrapped = SHELL_WRAPPER.exec(command)?.[2] ?? command
  return unwrapped.trim().replace(/\s+/g, " ")
}

/**
 * (a) Anti-loop: the same command FAILING `minRepeats` (default 3) or more times
 * consecutively. Only command-bearing calls are considered, so interleaved edits
 * (Read/Edit/Write) do not break a run — the realistic "run test → fails → tweak
 * → run same test → fails → …" loop the paper's hook targets. A different command
 * or a success of the same command resets the run.
 */
export function detectRepeatedFailingCommand(
  calls: AuditToolCall[],
  opts: { minRepeats?: number } = {},
): AuditSignal[] {
  const minRepeats = opts.minRepeats ?? 3
  const signals: AuditSignal[] = []
  let runCommand: string | null = null
  let runCount = 0
  const flush = (): void => {
    if (runCommand !== null && runCount >= minRepeats) {
      signals.push({
        kind: "repeated-failing-command",
        detail: `the same command failed ${runCount} times in a row: ${runCommand}`,
        evidence: [runCommand],
        heuristic: false,
      })
    }
    runCommand = null
    runCount = 0
  }
  for (const call of calls) {
    if (call.command === null) continue
    if (!call.failed) {
      flush()
      continue
    }
    const normalized = normalizeCommand(call.command)
    if (normalized === runCommand) {
      runCount += 1
    } else {
      flush()
      runCommand = normalized
      runCount = 1
    }
  }
  flush()
  return signals
}

const NOT_FOUND_MARKER =
  /command not found|:\s*not found|\bexit(?:\s*code)?\s*127\b/i

/**
 * (b) Exit-127 / command-not-found: a missing executable, the grill-triage-002
 * failure the Loop CLI shim was built to close. Detected structurally when the
 * provider reports an exit code (Codex: `exit_code === 127`). The output marker
 * is only a FALLBACK for a provider that reports no exit code (Claude), and only
 * when the call actually failed — otherwise a legitimate probe such as
 * `command -v programmers-loop || true`, whose output contains "not found" on a
 * successful exit, false-positives. That noise was observed on real Codex/Claude
 * transcripts, so a call that carries any exit code is judged solely by it. The
 * marker path is flagged `heuristic`. One signal per distinct command.
 */
export function detectExit127(calls: AuditToolCall[]): AuditSignal[] {
  const signals: AuditSignal[] = []
  const seen = new Set<string>()
  for (const call of calls) {
    const structured = call.exitCode === 127
    const marker =
      call.exitCode === null &&
      call.failed &&
      NOT_FOUND_MARKER.test(call.output)
    if (!structured && !marker) continue
    const label = call.command ? normalizeCommand(call.command) : call.tool
    if (seen.has(label)) continue
    seen.add(label)
    signals.push({
      kind: "exit-127",
      detail: structured
        ? `command exited 127 (command not found): ${label}`
        : `failed command output reports a missing executable: ${label}`,
      evidence: [label],
      heuristic: !structured,
    })
  }
  return signals
}

/**
 * Compile one scope glob to an anchored regex matching the {@link TaskScope}
 * semantics: `**` matches across path segments, `*` matches within one segment
 * (never `/`), and every other character is literal.
 */
export function matchesGlob(candidate: string, glob: string): boolean {
  let pattern = ""
  for (let index = 0; index < glob.length; index += 1) {
    const char = glob[index] as string
    if (char === "*") {
      if (glob[index + 1] === "*") {
        pattern += ".*"
        index += 1
      } else {
        pattern += "[^/]*"
      }
    } else {
      pattern += char.replace(/[.+?^${}()|[\]\\]/g, "\\$&")
    }
  }
  return new RegExp(`^${pattern}$`).test(candidate)
}

/**
 * (c) Forbidden-path touch: changed paths (a git diff of the sandbox against the
 * runner's baseline commit, supplied by the caller) checked against the task's
 * scope globs. A path is flagged when it matches a `forbidden_paths` pattern OR
 * falls outside every `allowed_paths` pattern (the closed-world rule the hidden
 * grader also enforces). Structured, not heuristic. This mirrors the grader's own
 * scope check; the grader's per-task regexes are hidden and not importable, so
 * the glob matching is reimplemented minimally here against the public scope.
 */
export function detectForbiddenPathTouches(params: {
  changedPaths: string[]
  scope: TaskScope
}): AuditSignal[] {
  const signals: AuditSignal[] = []
  for (const changed of params.changedPaths) {
    const forbidden = params.scope.forbiddenPaths.some((glob) =>
      matchesGlob(changed, glob),
    )
    const allowed = params.scope.allowedPaths.some((glob) =>
      matchesGlob(changed, glob),
    )
    if (allowed && !forbidden) continue
    signals.push({
      kind: "forbidden-path-touch",
      detail: `changed path ${changed} ${
        forbidden
          ? "matches a forbidden_paths pattern"
          : "is outside every allowed_paths pattern"
      }`,
      evidence: [changed],
      heuristic: false,
    })
  }
  return signals
}

/** Loopback and wildcard hosts that never count as external network use. */
const DEFAULT_ALLOWED_HOSTS = ["localhost", "127.0.0.1", "0.0.0.0", "::1"]
const SCHEME_URL = /\b(?:https?|ftp|wss?|ssh|git):\/\/([^\s/'"()<>\\]+)/gi
const WWW_HOST = /\bwww\.[a-z0-9.-]+\.[a-z]{2,}/gi

/** Reduce a raw URL authority to a bare lowercase host (drop userinfo/port/path). */
function hostFrom(raw: string): string | null {
  let host = raw.trim()
  const at = host.lastIndexOf("@")
  if (at !== -1) host = host.slice(at + 1)
  host = host
    .replace(/[/:].*$/, "")
    .replace(/[.,;]+$/, "")
    .toLowerCase()
  return host === "" ? null : host
}

/**
 * (d) Out-of-declared-network: URLs/domains referenced in tool commands, inputs,
 * or output whose host is not a declared registry (tasks are `network: deny`, so
 * any external host is suspect). HEURISTIC and labeled as such: it is anchored to
 * scheme URLs (`https://…`, `ssh://…`) and `www.` hosts to avoid firing on bare
 * domains embedded in unrelated text (e.g. the sandbox git email
 * `evals@example.com`). `allowedHosts` extends the loopback defaults.
 */
export function detectOutOfDeclaredNetwork(
  calls: AuditToolCall[],
  opts: { allowedHosts?: string[] } = {},
): AuditSignal[] {
  const allowed = new Set(
    [...DEFAULT_ALLOWED_HOSTS, ...(opts.allowedHosts ?? [])].map((host) =>
      host.toLowerCase(),
    ),
  )
  const hits = new Map<string, string>()
  for (const call of calls) {
    const haystack = [call.command ?? "", call.inputText, call.output].join(
      "\n",
    )
    for (const match of haystack.matchAll(SCHEME_URL)) {
      const host = hostFrom(match[1] ?? "")
      if (host && !allowed.has(host)) hits.set(host, match[0])
    }
    for (const match of haystack.matchAll(WWW_HOST)) {
      const host = hostFrom(match[0])
      if (host && !allowed.has(host)) hits.set(host, match[0])
    }
  }
  return [...hits].map(([host, snippet]) => ({
    kind: "out-of-declared-network",
    detail: `network reference to an undeclared host (heuristic): ${host}`,
    evidence: [host, snippet.slice(0, 120)],
    heuristic: true,
  }))
}

/**
 * Run every audit detector over one episode. `events` is the parsed agent event
 * stream (concatenate an episode's per-phase JSONL for the loop arm). Scope and
 * `changedPaths` are optional — omit them to skip the forbidden-path detector
 * when a git diff is unavailable. Pure: the return value is the only output.
 */
export function auditEpisode(params: {
  events: unknown[]
  scope?: TaskScope
  changedPaths?: string[]
  allowedHosts?: string[]
  minRepeats?: number
}): AuditSignal[] {
  const calls = extractToolCalls(params.events)
  const signals: AuditSignal[] = [
    ...detectRepeatedFailingCommand(calls, { minRepeats: params.minRepeats }),
    ...detectExit127(calls),
    ...detectOutOfDeclaredNetwork(calls, { allowedHosts: params.allowedHosts }),
  ]
  if (params.scope && params.changedPaths) {
    signals.push(
      ...detectForbiddenPathTouches({
        changedPaths: params.changedPaths,
        scope: params.scope,
      }),
    )
  }
  return signals
}
