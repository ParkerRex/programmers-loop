import type { ProgrammersLoopConfig } from "../config.js"
import { runProcess } from "../process.js"
import {
  summarizeChecks,
  type DoctorCheck,
  type DoctorReport,
} from "./types.js"

export async function runGitHubDoctor(params: {
  config: ProgrammersLoopConfig
  repoRoot: string
}): Promise<DoctorReport> {
  const checks: DoctorCheck[] = []
  let ghAvailable = false
  try {
    const version = await runProcess({
      command: "gh",
      args: ["--version"],
      cwd: params.repoRoot,
      timeoutMs: 10_000,
    })
    ghAvailable = version.exitCode === 0
  } catch {
    ghAvailable = false
  }
  checks.push({
    id: "github-cli",
    scope: "github",
    status: ghAvailable ? "pass" : "fail",
    detail: ghAvailable
      ? "GitHub CLI is available."
      : "GitHub CLI was not found.",
  })

  if (!ghAvailable) {
    return { status: summarizeChecks(checks), checks }
  }

  const auth = await runProcess({
    command: "gh",
    args: ["auth", "status"],
    cwd: params.repoRoot,
    timeoutMs: 15_000,
  })
  checks.push({
    id: "github-auth",
    scope: "github",
    status: auth.exitCode === 0 ? "pass" : "warn",
    detail:
      auth.exitCode === 0
        ? "GitHub CLI authentication is valid."
        : "GitHub CLI is not authenticated for repository reads.",
  })

  const configuredRepository = params.config.github.repository
  const remote = await runProcess({
    command: "git",
    args: ["remote", "get-url", "origin"],
    cwd: params.repoRoot,
    timeoutMs: 10_000,
  })
  const hasRepository =
    configuredRepository !== null ||
    (remote.exitCode === 0 && remote.stdout.trim() !== "")
  checks.push({
    id: "github-repository",
    scope: "github",
    status: hasRepository ? "pass" : "warn",
    detail: hasRepository
      ? "A GitHub repository target is configured."
      : "No GitHub repository target or origin remote is configured yet.",
  })

  if (hasRepository && auth.exitCode === 0) {
    const args = ["repo", "view", "--json", "nameWithOwner"]
    if (configuredRepository) args.splice(2, 0, configuredRepository)
    const view = await runProcess({
      command: "gh",
      args,
      cwd: params.repoRoot,
      timeoutMs: 15_000,
    })
    checks.push({
      id: "github-repository-read",
      scope: "github",
      status: view.exitCode === 0 ? "pass" : "warn",
      detail:
        view.exitCode === 0
          ? "GitHub repository metadata is readable."
          : "GitHub repository metadata could not be read.",
    })
  }

  return { status: summarizeChecks(checks), checks }
}
