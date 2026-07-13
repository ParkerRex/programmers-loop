import type { ProgrammersLoopConfig } from "../config.js"
import { CodexAdapter } from "./codex.js"
import type { AgentAdapter } from "./types.js"

export function createAgentAdapter(
  config: ProgrammersLoopConfig,
): AgentAdapter {
  if (config.agent.adapter === "codex") {
    return new CodexAdapter(config.agent.command)
  }
  throw new Error(`Unsupported agent adapter: ${config.agent.adapter}.`)
}

export type {
  AgentAdapter,
  AgentHealth,
  AgentRunRequest,
  AgentRunResult,
  AgentSandbox,
} from "./types.js"
