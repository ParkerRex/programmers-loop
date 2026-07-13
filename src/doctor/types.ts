export type CheckStatus = "pass" | "warn" | "fail"

export type DoctorCheck = {
  id: string
  scope: "local" | "github"
  status: CheckStatus
  detail: string
}

export type DoctorReport = {
  status: CheckStatus
  checks: DoctorCheck[]
}

export function summarizeChecks(checks: DoctorCheck[]): CheckStatus {
  if (checks.some((check) => check.status === "fail")) return "fail"
  if (checks.some((check) => check.status === "warn")) return "warn"
  return "pass"
}
