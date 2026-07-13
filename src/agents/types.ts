export type AgentSandbox = "read-only" | "workspace-write"

export type AgentHealth = {
  available: boolean
  detail: string
}

export type AgentRunRequest = {
  cwd: string
  prompt: string
  sandbox: AgentSandbox
  model?: string | null
  profile?: string | null
  ephemeral?: boolean
  maxOutputBytes?: number
  outputSchemaPath?: string
  timeoutMs?: number
}

export type AgentRunResult = {
  exitCode: number
  events: unknown[]
  lastMessage: string
  stderr: string
  stderrTruncated: boolean
  timedOut: boolean
  sessionId?: string
}

export interface AgentAdapter {
  readonly id: string
  doctor(cwd: string): Promise<AgentHealth>
  run(request: AgentRunRequest): Promise<AgentRunResult>
}
