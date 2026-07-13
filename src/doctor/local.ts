import { access } from "node:fs/promises"
import path from "node:path"

import { createAgentAdapter } from "../agents/index.js"
import type { ProgrammersLoopConfig } from "../config.js"
import { validateDocsSpine } from "../docs/spine.js"
import { validatePromptPack, validateSkillPack } from "../inventory.js"
import { lintPlanningTree } from "../lint.js"
import { runProcess } from "../process.js"
import {
  summarizeChecks,
  type DoctorCheck,
  type DoctorReport,
} from "./types.js"

async function commandCheck(params: {
  command: string
  id: string
  repoRoot: string
}): Promise<DoctorCheck> {
  try {
    const result = await runProcess({
      command: params.command,
      args: ["--version"],
      cwd: params.repoRoot,
      timeoutMs: 10_000,
    })
    return {
      id: params.id,
      scope: "local",
      status: result.exitCode === 0 ? "pass" : "fail",
      detail:
        result.exitCode === 0
          ? `${params.command} is available.`
          : `${params.command} returned a non-zero status.`,
    }
  } catch {
    return {
      id: params.id,
      scope: "local",
      status: "fail",
      detail: `${params.command} was not found.`,
    }
  }
}

async function requiredPathCheck(
  repoRoot: string,
  relativePath: string,
): Promise<DoctorCheck> {
  try {
    await access(path.join(repoRoot, relativePath))
    return {
      id: `path:${relativePath}`,
      scope: "local",
      status: "pass",
      detail: `${relativePath} exists.`,
    }
  } catch {
    return {
      id: `path:${relativePath}`,
      scope: "local",
      status: "fail",
      detail: `${relativePath} is missing.`,
    }
  }
}

export async function runLocalDoctor(params: {
  config: ProgrammersLoopConfig
  repoRoot: string
}): Promise<DoctorReport> {
  const checks: DoctorCheck[] = []
  const major = Number(process.versions.node.split(".")[0])
  checks.push({
    id: "node-version",
    scope: "local",
    status: major >= 24 ? "pass" : "fail",
    detail: `Node ${process.versions.node}; version 24 or newer is required.`,
  })
  checks.push(
    await commandCheck({
      command: "git",
      id: "git",
      repoRoot: params.repoRoot,
    }),
    await commandCheck({
      command: "bun",
      id: "bun",
      repoRoot: params.repoRoot,
    }),
  )

  const requiredPaths = [
    "programmers-loop.config.yaml",
    "bun.lock",
    "docs/index.md",
    "docs/contracts/assignment.md",
    "docs/contracts/program.md",
    "docs/contracts/exec-plan.md",
  ]
  for (const relativePath of requiredPaths) {
    checks.push(await requiredPathCheck(params.repoRoot, relativePath))
  }

  const shellPrefixes = params.config.proof.allowedCommandPrefixes.filter(
    (prefix) =>
      new Set(["sh", "bash", "zsh", "fish", "cmd", "powershell", "pwsh"]).has(
        prefix.trim().split(/\s+/)[0] ?? "",
      ),
  )
  checks.push({
    id: "proof-shell-boundary",
    scope: "local",
    status: shellPrefixes.length === 0 ? "pass" : "fail",
    detail:
      shellPrefixes.length === 0
        ? "Proof prefixes do not authorize a shell interpreter."
        : `Shell interpreters are not safe proof prefixes: ${shellPrefixes.join(", ")}.`,
  })
  const broadPrefixes = params.config.proof.allowedCommandPrefixes.filter(
    (prefix) => prefix.trim().split(/\s+/).length === 1,
  )
  checks.push({
    id: "proof-prefix-specificity",
    scope: "local",
    status: broadPrefixes.length === 0 ? "pass" : "warn",
    detail:
      broadPrefixes.length === 0
        ? "Proof prefixes include an executable and subcommand."
        : `Broad proof prefixes grant every subcommand: ${broadPrefixes.join(", ")}.`,
  })

  try {
    const adapter = createAgentAdapter(params.config)
    const health = await adapter.doctor(params.repoRoot)
    checks.push({
      id: `agent:${adapter.id}`,
      scope: "local",
      status: health.available ? "pass" : "fail",
      detail: health.detail,
    })
  } catch (error) {
    checks.push({
      id: "agent:configuration",
      scope: "local",
      status: "fail",
      detail:
        error instanceof Error ? error.message : "Invalid agent configuration.",
    })
  }

  try {
    const planning = await lintPlanningTree(params)
    checks.push({
      id: "planning-contracts",
      scope: "local",
      status: planning.issues.length === 0 ? "pass" : "fail",
      detail:
        planning.issues.length === 0
          ? `Validated ${planning.checked.length} planning artifacts.`
          : `${planning.issues.length} planning contract issue(s) found.`,
    })
  } catch (error) {
    checks.push({
      id: "planning-contracts",
      scope: "local",
      status: "fail",
      detail:
        error instanceof Error ? error.message : "Planning validation failed.",
    })
  }

  try {
    const docs = await validateDocsSpine({ repoRoot: params.repoRoot })
    checks.push({
      id: "docs-spine",
      scope: "local",
      status: docs.issues.length === 0 ? "pass" : "fail",
      detail:
        docs.issues.length === 0
          ? `Validated ${docs.checked.length} Markdown files and spine routes.`
          : `${docs.issues.length} documentation issue(s) found.`,
    })
  } catch (error) {
    checks.push({
      id: "docs-spine",
      scope: "local",
      status: "fail",
      detail:
        error instanceof Error ? error.message : "Docs validation failed.",
    })
  }

  try {
    const skillIssues = await validateSkillPack(params.repoRoot)
    checks.push({
      id: "skill-pack",
      scope: "local",
      status: skillIssues.length === 0 ? "pass" : "fail",
      detail:
        skillIssues.length === 0
          ? "Validated the portable skill pack and interface metadata."
          : `${skillIssues.length} skill-pack issue(s) found.`,
    })
  } catch (error) {
    checks.push({
      id: "skill-pack",
      scope: "local",
      status: "fail",
      detail:
        error instanceof Error ? error.message : "Skill validation failed.",
    })
  }

  try {
    const promptIssues = await validatePromptPack(params.repoRoot)
    checks.push({
      id: "prompt-pack",
      scope: "local",
      status: promptIssues.length === 0 ? "pass" : "fail",
      detail:
        promptIssues.length === 0
          ? "Validated the Program and ExecPlan prompt pack."
          : `${promptIssues.length} prompt-pack issue(s) found.`,
    })
  } catch (error) {
    checks.push({
      id: "prompt-pack",
      scope: "local",
      status: "fail",
      detail:
        error instanceof Error ? error.message : "Prompt validation failed.",
    })
  }

  try {
    const gitStatus = await runProcess({
      command: "git",
      args: ["status", "--porcelain"],
      cwd: params.repoRoot,
      timeoutMs: 10_000,
    })
    checks.push({
      id: "git-worktree",
      scope: "local",
      status: gitStatus.stdout.trim() === "" ? "pass" : "warn",
      detail:
        gitStatus.stdout.trim() === ""
          ? "Git worktree is clean."
          : "Git worktree has uncommitted changes.",
    })
  } catch (error) {
    checks.push({
      id: "git-worktree",
      scope: "local",
      status: "fail",
      detail: error instanceof Error ? error.message : "Git status failed.",
    })
  }

  return { status: summarizeChecks(checks), checks }
}
