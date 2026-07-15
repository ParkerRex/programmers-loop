import type { ProgrammersLoopConfig } from "../config.js"
import { ClaudeAdapter } from "./claude.js"
import { CodexAdapter } from "./codex.js"
import type { AgentAdapter } from "./types.js"

export function createAgentAdapter(
  config: ProgrammersLoopConfig,
): AgentAdapter {
  if (config.agent.adapter === "codex") {
    return new CodexAdapter(config.agent.command)
  }
  if (config.agent.adapter === "claude") {
    return new ClaudeAdapter(config.agent.command)
  }
  throw new Error(`Unsupported agent adapter: ${String(config.agent.adapter)}.`)
}

export { estimateCostUsd, MODEL_LIST_PRICES } from "./types.js"
export type {
  AgentAdapter,
  AgentAuthMode,
  AgentHealth,
  AgentRunRequest,
  AgentRunResult,
  AgentSandbox,
  AgentUsage,
  ModelListPrice,
} from "./types.js"
