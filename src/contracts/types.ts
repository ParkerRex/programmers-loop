export type LintIssue = {
  path: string
  message: string
}

export type LintReport = {
  checked: string[]
  issues: LintIssue[]
}

export function issue(path: string, message: string): LintIssue {
  return { path, message }
}
