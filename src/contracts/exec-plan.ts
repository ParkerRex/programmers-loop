import { readFile } from "node:fs/promises"
import path from "node:path"

import {
  extractSection,
  parseMarkdownFrontmatter,
  validateMarkdownDocument,
} from "../markdown/frontmatter.js"
import { issue, type LintIssue } from "./types.js"

const REQUIRED_KEYS = [
  "title",
  "status",
  "created_at",
  "completed_at",
  "summary",
  "post_build_recap",
  "read_when",
] as const

const REQUIRED_SECTIONS = [
  "Purpose / Big Picture",
  "Progress",
  "Surprises & Discoveries",
  "Decision Log",
  "Outcomes & Retrospective",
  "Context and Orientation",
  "Plan of Work",
  "Milestones",
  "Concrete Steps",
  "Validation and Acceptance",
  "Idempotence and Recovery",
  "Artifacts and Notes",
  "Interfaces and Dependencies",
] as const

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

export async function lintExecPlan(params: {
  planPath: string
  repoRoot: string
}): Promise<LintIssue[]> {
  const relativePath = path
    .relative(params.repoRoot, params.planPath)
    .split(path.sep)
    .join("/")
  const parsed = parseMarkdownFrontmatter(
    await readFile(params.planPath, "utf8"),
  )
  const messages = [
    ...parsed.issues,
    ...validateMarkdownDocument({
      body: parsed.body,
      metadata: parsed.metadata,
      requiredKeys: REQUIRED_KEYS,
      requiredSections: REQUIRED_SECTIONS,
    }),
  ]

  if (!new Set(["active", "complete"]).has(String(parsed.metadata.status))) {
    messages.push("status must be active or complete.")
  }
  if (
    typeof parsed.metadata.created_at !== "string" ||
    !ISO_DATE.test(parsed.metadata.created_at)
  ) {
    messages.push("created_at must be an ISO date in YYYY-MM-DD form.")
  }
  if (
    parsed.metadata.status === "active" &&
    parsed.metadata.completed_at !== null
  ) {
    messages.push("An active ExecPlan must have completed_at: null.")
  }
  if (
    parsed.metadata.status === "complete" &&
    (typeof parsed.metadata.completed_at !== "string" ||
      !ISO_DATE.test(parsed.metadata.completed_at))
  ) {
    messages.push("A complete ExecPlan must have an ISO completed_at date.")
  }
  if (
    (parsed.metadata.program_id === undefined) !==
    (parsed.metadata.planning_brief === undefined)
  ) {
    messages.push("program_id and planning_brief must appear together.")
  }

  const planOfWork = extractSection(parsed.body, "Plan of Work") ?? ""
  if (!planOfWork.includes("### In Scope")) {
    messages.push("Plan of Work must include ### In Scope.")
  }
  if (!planOfWork.includes("### Out of Scope")) {
    messages.push("Plan of Work must include ### Out of Scope.")
  }

  const validation =
    extractSection(parsed.body, "Validation and Acceptance") ?? ""
  if (!validation.includes("### Test Commands")) {
    messages.push("Validation and Acceptance must include ### Test Commands.")
  } else if (!/```(?:bash|sh|shell)\n[\s\S]*?\n```/.test(validation)) {
    messages.push("Test Commands must contain a shell fenced code block.")
  }

  return messages.map((message) => issue(relativePath, message))
}
