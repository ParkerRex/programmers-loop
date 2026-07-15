import { readFile } from "node:fs/promises"
import path from "node:path"

import YAML from "yaml"

import {
  DEFAULT_SANDBOX_IMAGE,
  type ResolvedSandboxConfig,
  type SandboxMode,
  type SandboxNetworkPolicy,
} from "./evals/sandbox.js"

/**
 * Curated procedural skill layer budget and ablation filter (SkillsBench,
 * arXiv 2602.12670; Decision D18). `maxPerPhase` is the per-phase selection
 * cap; the SkillsBench "2-3 short skills optimal" finding is why it defaults to
 * 3, and the ≤60-line-per-skill budget is a code invariant (see
 * src/workflows/curated-skills.ts), not config.
 */
export type ResolvedSkillsConfig = {
  maxPerPhase: number
  /**
   * Skill-ablation allowlist (Decision D18): the slugs the loader may select
   * from, null for the full pack. `[]` is the no-skill arm. Because the filter
   * changes the effective treatment without changing pack bytes, it joins the
   * eval's frozen config inputs (`RunConfigInputs.skillsInclude`); it is
   * normalized here (deduplicated, sorted) so equal sets are one identity.
   */
  include: string[] | null
}

export type ProgrammersLoopConfig = {
  schemaVersion: 1
  planningRoot: string
  /**
   * Where scored eval episodes execute (Decisions D10/D11/D12). Optional and
   * defaulting to host so every existing config and test literal stays valid;
   * `loadConfig` always resolves it to a concrete {@link ResolvedSandboxConfig}.
   */
  sandbox?: ResolvedSandboxConfig
  /**
   * Curated-skills budget. Optional and defaulting so every existing config and
   * test literal stays valid; `loadConfig` always resolves it. Omitted or null
   * yields the default per-phase cap.
   */
  skills?: ResolvedSkillsConfig
  agent: {
    adapter: "codex" | "claude"
    command: string
    maxOutputBytes: number
    model: string | null
    profile: string | null
    /**
     * Reasoning-effort level pinned for every subject-model run (Decision D3).
     * Null leaves the CLI on its ambient default (for Codex, the global
     * `~/.codex/config.toml` `model_reasoning_effort`). Optional so existing
     * config objects and fixtures without the key remain valid; `loadConfig`
     * always resolves it to a string or null.
     */
    reasoningEffort?: string | null
    runTimeoutMs: number
  }
  github: {
    repository: string | null
  }
  proof: {
    maxOutputBytes: number
    commandTimeoutMs: number
    allowedCommandPrefixes: string[]
  }
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null
}

/**
 * Resolve the optional `sandbox` block. Omitting it (as every current config
 * and test literal does) yields host mode, so behavior is unchanged unless a
 * config opts in. Validates the enumerations strictly so a typo fails loudly
 * rather than silently falling back to a weaker isolation posture.
 */
function resolveSandbox(value: unknown): ResolvedSandboxConfig {
  const defaults: ResolvedSandboxConfig = {
    mode: "host",
    image: DEFAULT_SANDBOX_IMAGE,
    network: "none",
    allowlist: [],
  }
  if (value === undefined || value === null) return defaults
  const block = record(value, "sandbox")
  const mode = block.mode === undefined ? "host" : block.mode
  if (mode !== "host" && mode !== "container") {
    throw new Error('sandbox.mode must be "host" or "container".')
  }
  const network = block.network === undefined ? "none" : block.network
  if (network !== "none" && network !== "allowlist") {
    throw new Error('sandbox.network must be "none" or "allowlist".')
  }
  if (
    block.allowlist !== undefined &&
    (!Array.isArray(block.allowlist) ||
      block.allowlist.some((v) => typeof v !== "string" || v.trim() === ""))
  ) {
    throw new Error("sandbox.allowlist must be a string list.")
  }
  return {
    mode: mode as SandboxMode,
    image: optionalString(block.image) ?? DEFAULT_SANDBOX_IMAGE,
    network: network as SandboxNetworkPolicy,
    allowlist: (block.allowlist as string[] | undefined) ?? [],
  }
}

/**
 * Resolve the optional `skills` block. Omitting it (as every current config and
 * test literal does) yields the default per-phase cap of 3 — the SkillsBench
 * "2-3 short skills optimal" finding, matching CURATED_SKILLS_MAX_PER_PHASE in
 * src/workflows/curated-skills.ts. A negative or non-integer cap fails loudly.
 */
function resolveSkills(value: unknown): ResolvedSkillsConfig {
  const DEFAULT_MAX_PER_PHASE = 3
  if (value === undefined || value === null) {
    return { include: null, maxPerPhase: DEFAULT_MAX_PER_PHASE }
  }
  const block = record(value, "skills")
  let maxPerPhase = DEFAULT_MAX_PER_PHASE
  if (block.max_per_phase !== undefined) {
    const max = Number(block.max_per_phase)
    if (!Number.isInteger(max) || max < 0) {
      throw new Error("skills.max_per_phase must be a non-negative integer.")
    }
    maxPerPhase = max
  }
  let include: string[] | null = null
  if (block.include !== undefined && block.include !== null) {
    if (
      !Array.isArray(block.include) ||
      block.include.some((v) => typeof v !== "string" || v.trim() === "")
    ) {
      throw new Error("skills.include must be a list of skill slugs.")
    }
    // Canonical form: an include-list is a SET of slugs. Deduplicating and
    // sorting here means two spellings of the same set resolve to one value and
    // therefore one configHash.
    include = [...new Set(block.include as string[])].toSorted()
  }
  return { include, maxPerPhase }
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
  const adapter = agent.adapter === undefined ? "codex" : agent.adapter
  if (adapter !== "codex" && adapter !== "claude") {
    throw new Error('agent.adapter must be "codex" or "claude".')
  }
  if (typeof agent.command !== "string" || agent.command.trim() === "") {
    throw new Error("agent.command must be a non-empty string.")
  }

  const agentTimeout = Number(agent.run_timeout_ms)
  if (!Number.isInteger(agentTimeout) || agentTimeout <= 0) {
    throw new Error("agent.run_timeout_ms must be a positive integer.")
  }
  const agentMaxOutput = Number(agent.max_output_bytes)
  if (!Number.isInteger(agentMaxOutput) || agentMaxOutput <= 0) {
    throw new Error("agent.max_output_bytes must be a positive integer.")
  }

  const timeout = Number(proof.command_timeout_ms)
  if (!Number.isInteger(timeout) || timeout <= 0) {
    throw new Error("proof.command_timeout_ms must be a positive integer.")
  }
  const proofMaxOutput = Number(proof.max_output_bytes)
  if (!Number.isInteger(proofMaxOutput) || proofMaxOutput <= 0) {
    throw new Error("proof.max_output_bytes must be a positive integer.")
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
    sandbox: resolveSandbox(root.sandbox),
    skills: resolveSkills(root.skills),
    agent: {
      adapter,
      command: agent.command,
      maxOutputBytes: agentMaxOutput,
      model: optionalString(agent.model),
      profile: optionalString(agent.profile),
      reasoningEffort: optionalString(agent.reasoning_effort),
      runTimeoutMs: agentTimeout,
    },
    github: {
      repository: optionalString(github.repository),
    },
    proof: {
      maxOutputBytes: proofMaxOutput,
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
