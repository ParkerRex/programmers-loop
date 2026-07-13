import { readFile } from "node:fs/promises"
import path from "node:path"

import YAML from "yaml"

export type ProgrammersLoopConfig = {
  schemaVersion: 1
  planningRoot: string
  agent: {
    adapter: string
    command: string
    model: string | null
    profile: string | null
  }
  github: {
    repository: string | null
  }
  proof: {
    commandTimeoutMs: number
    allowedCommandPrefixes: string[]
  }
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null
}

function record(value: unknown, name: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${name} must be a YAML object.`)
  }
  return value as Record<string, unknown>
}

export async function loadConfig(
  repoRoot: string,
): Promise<ProgrammersLoopConfig> {
  const configPath = path.join(repoRoot, "programmers-loop.config.yaml")
  const parsed = YAML.parse(await readFile(configPath, "utf8")) as unknown
  const root = record(parsed, "Configuration")
  const agent = record(root.agent, "agent")
  const github = record(root.github, "github")
  const proof = record(root.proof, "proof")

  if (root.schema_version !== 1) {
    throw new Error("Configuration schema_version must equal 1.")
  }
  if (
    typeof root.planning_root !== "string" ||
    root.planning_root.trim() === ""
  ) {
    throw new Error("planning_root must be a non-empty string.")
  }
  if (typeof agent.adapter !== "string" || agent.adapter.trim() === "") {
    throw new Error("agent.adapter must be a non-empty string.")
  }
  if (typeof agent.command !== "string" || agent.command.trim() === "") {
    throw new Error("agent.command must be a non-empty string.")
  }

  const timeout = Number(proof.command_timeout_ms)
  if (!Number.isInteger(timeout) || timeout <= 0) {
    throw new Error("proof.command_timeout_ms must be a positive integer.")
  }
  if (
    !Array.isArray(proof.allowed_command_prefixes) ||
    proof.allowed_command_prefixes.some(
      (value) => typeof value !== "string" || value.trim() === "",
    )
  ) {
    throw new Error("proof.allowed_command_prefixes must be a string list.")
  }

  return {
    schemaVersion: 1,
    planningRoot: root.planning_root,
    agent: {
      adapter: agent.adapter,
      command: agent.command,
      model: optionalString(agent.model),
      profile: optionalString(agent.profile),
    },
    github: {
      repository: optionalString(github.repository),
    },
    proof: {
      commandTimeoutMs: timeout,
      allowedCommandPrefixes: proof.allowed_command_prefixes as string[],
    },
  }
}

export async function findRepoRoot(startPath: string): Promise<string> {
  let current = path.resolve(startPath)
  while (true) {
    try {
      await readFile(path.join(current, "programmers-loop.config.yaml"), "utf8")
      return current
    } catch {
      const parent = path.dirname(current)
      if (parent === current) {
        throw new Error(
          "Could not find programmers-loop.config.yaml in this directory or a parent.",
        )
      }
      current = parent
    }
  }
}
