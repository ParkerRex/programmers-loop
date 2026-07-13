import type { ProgrammersLoopConfig } from "../config.js"
import { runGitHubDoctor } from "./github.js"
import { runLocalDoctor } from "./local.js"
import { summarizeChecks, type DoctorReport } from "./types.js"

export async function runDoctor(params: {
  config: ProgrammersLoopConfig
  includeGitHub: boolean
  repoRoot: string
}): Promise<DoctorReport> {
  const local = await runLocalDoctor(params)
  const checks = [...local.checks]
  if (params.includeGitHub) {
    checks.push(...(await runGitHubDoctor(params)).checks)
  }
  return { status: summarizeChecks(checks), checks }
}

export type { CheckStatus, DoctorCheck, DoctorReport } from "./types.js"
