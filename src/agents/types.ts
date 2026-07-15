export type AgentSandbox = "read-only" | "workspace-write"

export type AgentHealth = {
  available: boolean
  detail: string
}

/**
 * The three fields of a child-process spawn a {@link ProcessLauncher} may
 * rewrite: the executable, its argv, and its working directory. Deliberately a
 * subset of the full `runProcess` params — a launcher never touches stdin,
 * output limits, or the timeout, which stay the adapter's concern.
 */
export type ProcessLaunchSpec = {
  command: string
  args: string[]
  cwd: string
}

/**
 * A launched (possibly rewritten) spawn plus a teardown hook. `cleanup` runs
 * in the adapter's `finally` after the process resolves OR throws, so a
 * launcher that starts out-of-process resources (a container) can reclaim them
 * even when the run times out and `runProcess` SIGKILLs only the client.
 */
export type LaunchedProcess = ProcessLaunchSpec & {
  cleanup: () => Promise<void>
}

/**
 * Transforms an adapter's intended host spawn into the spawn actually executed.
 * This is the single seam that lets the eval runner wrap every adapter
 * invocation in a container (`docker run …`) without forking any adapter logic:
 * the adapter still builds its own CLI argv against the sandbox path, and the
 * launcher wraps that command/argv/cwd. {@link hostLauncher} is the identity
 * transform used everywhere except containerized eval runs, so host behavior is
 * provably unchanged (same command, same args, same cwd, no-op cleanup).
 */
export type ProcessLauncher = (spec: ProcessLaunchSpec) => LaunchedProcess

/** Identity launcher: runs the spawn exactly as the adapter intended. */
export const hostLauncher: ProcessLauncher = (spec) => ({
  ...spec,
  cleanup: async () => {},
})

/**
 * How the provider authenticated a run. Subscription runs report advisory,
 * unbilled API-equivalent costs; api-key runs bill per token.
 */
export type AgentAuthMode = "subscription" | "api-key"

/**
 * Normalized per-run usage. Fields are null whenever the provider did not
 * report the value; missing data is never guessed.
 *
 * - inputTokens counts non-cache-read input tokens. For Claude this includes
 *   cache-creation tokens, which actually bill at a premium that
 *   estimateCostUsd does not model.
 * - cachedInputTokens counts cache-read input tokens.
 * - reasoningTokens is the informational subset of outputTokens when the
 *   provider reports it separately.
 * - costUsd is the provider-reported total for the run; under subscription
 *   auth it is advisory only (nothing was billed per token).
 */
export type AgentUsage = {
  inputTokens: number | null
  outputTokens: number | null
  cachedInputTokens: number | null
  reasoningTokens: number | null
  modelCalls: number | null
  toolCalls: number | null
  costUsd: number | null
  authMode: AgentAuthMode | null
}

export type AgentRunRequest = {
  cwd: string
  prompt: string
  sandbox: AgentSandbox
  model?: string | null
  profile?: string | null
  ephemeral?: boolean
  maxOutputBytes?: number
  /** Upper bound on agent turns for CLIs that support it; Codex ignores it. */
  maxTurns?: number
  outputSchemaPath?: string
  /**
   * Reasoning-effort level to pin for this run (Decision D3). Codex emits it as
   * `-c model_reasoning_effort="<level>"`; Claude passes it as `--effort
   * <level>`. Null or absent leaves the CLI on its ambient/global default.
   */
  reasoningEffort?: string | null
  sessionId?: string
  timeoutMs?: number
}

export type AgentRunResult = {
  exitCode: number
  events: unknown[]
  /**
   * Repo-relative path to the durable JSONL transcript of raw provider
   * events, or null when capture failed.
   */
  eventsPath: string | null
  lastMessage: string
  stderr: string
  stderrTruncated: boolean
  timedOut: boolean
  sessionId?: string
  usage: AgentUsage | null
}

export interface AgentAdapter {
  readonly id: string
  doctor(cwd: string): Promise<AgentHealth>
  run(request: AgentRunRequest): Promise<AgentRunResult>
}

export function emptyAgentUsage(): AgentUsage {
  return {
    inputTokens: null,
    outputTokens: null,
    cachedInputTokens: null,
    reasoningTokens: null,
    modelCalls: null,
    toolCalls: null,
    costUsd: null,
    authMode: null,
  }
}

export function hasAgentUsageSignal(usage: AgentUsage): boolean {
  return Object.values(usage).some((value) => value !== null)
}

function addCounts(left: number | null, right: number | null): number | null {
  if (left === null && right === null) return null
  return (left ?? 0) + (right ?? 0)
}

/** Field-wise, null-aware accumulation; disagreeing auth modes become null. */
export function addAgentUsage(left: AgentUsage, right: AgentUsage): AgentUsage {
  return {
    inputTokens: addCounts(left.inputTokens, right.inputTokens),
    outputTokens: addCounts(left.outputTokens, right.outputTokens),
    cachedInputTokens: addCounts(
      left.cachedInputTokens,
      right.cachedInputTokens,
    ),
    reasoningTokens: addCounts(left.reasoningTokens, right.reasoningTokens),
    modelCalls: addCounts(left.modelCalls, right.modelCalls),
    toolCalls: addCounts(left.toolCalls, right.toolCalls),
    costUsd: addCounts(left.costUsd, right.costUsd),
    authMode: left.authMode === right.authMode ? left.authMode : null,
  }
}

export function parseJsonlEvents(stdout: string): unknown[] {
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

export type ModelListPrice = {
  inputUsdPerMTok: number
  cachedInputUsdPerMTok: number
  outputUsdPerMTok: number
  /**
   * Set when the row's figures could not be confirmed against the provider's
   * live pricing page and rest on secondary research instead. Repricing outputs
   * should flag any run whose model resolves to an unverified row.
   */
  unverified?: boolean
  /** Per-row pricing date when it differs from the table's `asOf`. */
  asOf?: string
}

/**
 * Advisory list prices pinned as of 2026-07-14. The claude-sonnet-5 and
 * claude-haiku-4-5 rows reproduce Claude Code 2.1.206 cost accounting
 * observed on that date; the remaining rows are provider list prices as last
 * announced and must be re-verified before any billing-grade use.
 */
export const MODEL_LIST_PRICES: {
  asOf: string
  models: Record<string, ModelListPrice>
} = {
  asOf: "2026-07-14",
  models: {
    "claude-sonnet-5": {
      inputUsdPerMTok: 3,
      cachedInputUsdPerMTok: 0.3,
      outputUsdPerMTok: 15,
    },
    "claude-haiku-4-5": {
      inputUsdPerMTok: 1,
      cachedInputUsdPerMTok: 0.1,
      outputUsdPerMTok: 5,
    },
    "claude-opus-4-5": {
      inputUsdPerMTok: 5,
      cachedInputUsdPerMTok: 0.5,
      outputUsdPerMTok: 25,
    },
    "gpt-5.1": {
      inputUsdPerMTok: 1.25,
      cachedInputUsdPerMTok: 0.125,
      outputUsdPerMTok: 10,
    },
    // GPT-5.6 tiers (Decision D2 same-family pair is Terra/Sol). Figures come
    // from the design review's web research (openai.com/index/gpt-5-6, as of
    // 2026-07) and could NOT be re-confirmed here: openai.com returned HTTP 403
    // to automated fetches of both the launch page and /api/pricing, so every
    // row is marked `unverified` until a human confirms it. Cached-input rates
    // were not quotable from the blocked page; they follow the GPT-5 family's
    // published 10%-of-input cache discount (matching the gpt-5.1 row above),
    // and are unverified for the same reason.
    "gpt-5.6-sol": {
      inputUsdPerMTok: 5,
      cachedInputUsdPerMTok: 0.5,
      outputUsdPerMTok: 30,
      unverified: true,
      asOf: "2026-07",
    },
    "gpt-5.6-terra": {
      inputUsdPerMTok: 2.5,
      cachedInputUsdPerMTok: 0.25,
      outputUsdPerMTok: 15,
      unverified: true,
      asOf: "2026-07",
    },
    "gpt-5.6-luna": {
      inputUsdPerMTok: 1,
      cachedInputUsdPerMTok: 0.1,
      outputUsdPerMTok: 6,
      unverified: true,
      asOf: "2026-07",
    },
  },
}

/**
 * Advisory cost estimate from token counts and one model's list prices.
 * Returns null when no token counts are known at all. Unknown components
 * count as zero, and cache-write premiums or server-tool surcharges are not
 * modeled, so the estimate is a floor rather than an invoice.
 */
export function estimateCostUsd(
  usage: Pick<AgentUsage, "cachedInputTokens" | "inputTokens" | "outputTokens">,
  price: ModelListPrice,
): number | null {
  if (
    usage.inputTokens === null &&
    usage.cachedInputTokens === null &&
    usage.outputTokens === null
  ) {
    return null
  }
  return (
    ((usage.inputTokens ?? 0) * price.inputUsdPerMTok +
      (usage.cachedInputTokens ?? 0) * price.cachedInputUsdPerMTok +
      (usage.outputTokens ?? 0) * price.outputUsdPerMTok) /
    1_000_000
  )
}
