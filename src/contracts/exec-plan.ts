import { access, readFile } from "node:fs/promises"
import path from "node:path"

import {
  extractH1,
  extractSection,
  parseMarkdownFrontmatter,
  validateMarkdownDocument,
} from "../markdown/frontmatter.js"
import {
  extractSubsection,
  isIsoDate,
  isMeaningfulText,
  isNonEmptyString,
  KEBAB_CASE,
  safeRepoRelativePath,
  subsectionIndex,
  validateAllowedKeys,
} from "./shared.js"
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

const OPTIONAL_KEYS = ["program_id", "planning_brief", "tier"] as const
const ALLOWED_KEYS = new Set<string>([...REQUIRED_KEYS, ...OPTIONAL_KEYS])

/**
 * Contract tier. `tier` is optional frontmatter; an absent key means `full`,
 * so every pre-tier plan keeps its exact existing requirements.
 */
export type ExecPlanTier = "full" | "lite"

const FULL_REQUIRED_SECTIONS = [
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

const LITE_REQUIRED_SECTIONS = [
  "Purpose / Big Picture",
  "Progress",
  "Context and Orientation",
  "Plan of Work",
  "Validation and Acceptance",
  "Outcomes & Retrospective",
] as const

const PLAN_PATH_PATTERN =
  /^docs\/assignments\/(active|completed)\/(?:\d{4}-\d{2}-\d{2}|YYYY-MM-DD)-[a-z0-9-]+\/(?:programs\/(active|completed)\/[a-z0-9-]+\/)?exec-plans\/(active|completed)\/(?:\d{4}-\d{2}-\d{2}|YYYY-MM-DD)-[a-z0-9-]+\.md$/

const VERSIONED_BRIEF_PATTERN =
  /^docs\/assignments\/(active|completed)\/((?:\d{4}-\d{2}-\d{2}|YYYY-MM-DD)-[a-z0-9-]+)\/programs\/(active|completed)\/([a-z0-9]+(?:-[a-z0-9]+)*)\/briefs\/planning-brief-([1-9]\d*)\.md$/

const PROGRAM_OWNED_PLAN_PATTERN =
  /^docs\/assignments\/(active|completed)\/((?:\d{4}-\d{2}-\d{2}|YYYY-MM-DD)-[a-z0-9-]+)\/programs\/(active|completed)\/([a-z0-9]+(?:-[a-z0-9]+)*)\/exec-plans\/(active|completed)\//

const MAINTENANCE_SENTENCE =
  "This ExecPlan must be maintained in accordance with `docs/contracts/exec-plan.md`."

export const EXEC_PLAN_PLACEHOLDER_MARKER =
  "<!-- programmers-loop:placeholder -->"

const PLACEHOLDER_TEXT = [
  /^- \[ \] Replace scaffold guidance with repository-specific steps\.$/m,
  /^1\. Replace scaffold text with a self-contained implementation plan\.$/m,
  /^- Define the bounded implementation work before execution\.$/m,
]

const KNOWN_COMMAND_STARTERS = new Set([
  "bash",
  "black",
  "bun",
  "bunx",
  "cargo",
  "cd",
  "curl",
  "docker",
  "docker-compose",
  "git",
  "go",
  "just",
  "make",
  "node",
  "npm",
  "npx",
  "oxfmt",
  "oxlint",
  "pnpm",
  "pytest",
  "python",
  "python3",
  "ruff",
  "sh",
  "uv",
  "wget",
  "yarn",
  "zsh",
])

function isRunnableCommandLine(line: string): boolean {
  const trimmed = line.trim().replace(/^\$\s*/, "")
  if (trimmed === "" || trimmed === "\\") return false
  const withoutEnvironment = trimmed.replace(
    /^(?:[A-Z_][A-Z0-9_]*=(?:"[^"]*"|'[^']*'|\S+)\s+)*/,
    "",
  )
  const command = withoutEnvironment.split(/\s+/)[0] ?? ""
  return (
    /^(?:\.\.?\/|~\/|\/)/.test(command) ||
    KNOWN_COMMAND_STARTERS.has(command) ||
    /^[a-z0-9][a-z0-9._+-]*$/.test(command)
  )
}

function hasRunnableCommand(sectionBody: string): boolean {
  let inFence = false
  for (const rawLine of sectionBody.split("\n")) {
    const trimmed = rawLine.trim()
    if (trimmed.startsWith("```")) {
      inFence = !inFence
      continue
    }
    if (trimmed === "") continue
    if (inFence && isRunnableCommandLine(trimmed)) return true
    if (/^(?: {4}|\t)/.test(rawLine) && isRunnableCommandLine(trimmed)) {
      return true
    }
    if (/^-\s+/.test(trimmed) && isRunnableCommandLine(trimmed.slice(2))) {
      return true
    }
  }
  return false
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath)
    return true
  } catch {
    return false
  }
}

function resolveTier(
  metadata: Record<string, unknown>,
  messages: string[],
): ExecPlanTier {
  const tier = metadata.tier
  if (tier === undefined || tier === "full") return "full"
  if (tier === "lite") return "lite"
  messages.push("tier must be full or lite.")
  return "full"
}

function validateScope(body: string, messages: string[]): void {
  const context = extractSection(body, "Context and Orientation")
  if (context === null) return
  const inScope = extractSubsection(context, "In Scope")
  const outOfScope = extractSubsection(context, "Out Of Scope")
  if (inScope === null) {
    messages.push(
      "Context and Orientation must include the exact subsection ### In Scope.",
    )
  } else if (inScope === "") {
    messages.push("The ### In Scope subsection must not be empty.")
  }
  if (outOfScope === null) {
    messages.push(
      "Context and Orientation must include the exact subsection ### Out Of Scope.",
    )
  } else if (outOfScope === "") {
    messages.push("The ### Out Of Scope subsection must not be empty.")
  }
  const inScopeIndex = subsectionIndex(context, "In Scope")
  const outOfScopeIndex = subsectionIndex(context, "Out Of Scope")
  if (
    inScopeIndex !== -1 &&
    outOfScopeIndex !== -1 &&
    outOfScopeIndex < inScopeIndex
  ) {
    messages.push("### In Scope must appear before ### Out Of Scope.")
  }
}

function validateTestCommands(body: string, messages: string[]): void {
  const validation = extractSection(body, "Validation and Acceptance")
  if (validation === null) return
  const commands = extractSubsection(validation, "Test Commands")
  if (commands === null) {
    messages.push(
      "Validation and Acceptance must include the exact subsection ### Test Commands.",
    )
  } else if (commands === "") {
    messages.push("The ### Test Commands subsection must not be empty.")
  } else if (!hasRunnableCommand(commands)) {
    messages.push(
      "The ### Test Commands subsection must include at least one runnable command.",
    )
  }
}

async function validateProgramLinkage(params: {
  messages: string[]
  metadata: Record<string, unknown>
  planRelativePath: string
  requireBriefExists: boolean
  repoRoot: string
}): Promise<void> {
  const programId = params.metadata.program_id
  const planningBrief = params.metadata.planning_brief
  const owner = params.planRelativePath.match(PROGRAM_OWNED_PLAN_PATTERN)
  if (programId === undefined && planningBrief === undefined) {
    if (owner) {
      params.messages.push(
        "Program-owned ExecPlans require program_id and planning_brief.",
      )
    }
    return
  }
  if (!owner) {
    params.messages.push(
      "program_id and planning_brief are only valid on a Program-owned ExecPlan path.",
    )
  }
  if (programId === undefined) {
    params.messages.push(
      "program_id is required when planning_brief is present.",
    )
  }
  if (planningBrief === undefined) {
    params.messages.push(
      "planning_brief is required when program_id is present.",
    )
  }
  if (programId === undefined || planningBrief === undefined) return
  if (!isNonEmptyString(programId) || !KEBAB_CASE.test(programId)) {
    params.messages.push("program_id must be a stable kebab-case slug.")
  }
  if (!isNonEmptyString(planningBrief)) {
    params.messages.push("planning_brief must be a non-empty string.")
    return
  }
  if (!safeRepoRelativePath(planningBrief)) {
    params.messages.push(
      "planning_brief must be a normalized repository-relative path.",
    )
    return
  }
  if (planningBrief.endsWith("current.txt")) {
    params.messages.push(
      "planning_brief must name an immutable versioned brief, not current.txt.",
    )
  }
  const match = planningBrief.match(VERSIONED_BRIEF_PATTERN)
  if (!match) {
    params.messages.push(
      "planning_brief must point to a versioned brief under the owning Program.",
    )
    return
  }
  if (isNonEmptyString(programId) && match[4] !== programId) {
    params.messages.push(
      `planning_brief must live under the ${programId} Program directory.`,
    )
  }
  if (owner) {
    if (isNonEmptyString(programId) && owner[4] !== programId) {
      params.messages.push(
        "program_id must match the Program directory that owns the ExecPlan.",
      )
    }
    if (match[2] !== owner[2] || match[4] !== owner[4]) {
      params.messages.push(
        "planning_brief must belong to the Assignment and Program that own the ExecPlan.",
      )
    }
    if (
      params.requireBriefExists &&
      (match[1] !== owner[1] || match[3] !== owner[3])
    ) {
      params.messages.push(
        "An active Program-owned ExecPlan and planning_brief must use the same active lanes.",
      )
    }
  }
  if (
    params.requireBriefExists &&
    !(await pathExists(path.join(params.repoRoot, planningBrief)))
  ) {
    params.messages.push(`planning_brief does not exist: ${planningBrief}.`)
  }
}

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
  const messages = [...parsed.issues]
  const tier = resolveTier(parsed.metadata, messages)
  messages.push(
    ...validateMarkdownDocument({
      body: parsed.body,
      metadata: parsed.metadata,
      requiredKeys: REQUIRED_KEYS,
      requiredSections:
        tier === "lite" ? LITE_REQUIRED_SECTIONS : FULL_REQUIRED_SECTIONS,
    }),
    ...validateAllowedKeys(parsed.metadata, ALLOWED_KEYS),
  )

  const pathMatch = relativePath.match(PLAN_PATH_PATTERN)
  if (!isNonEmptyString(parsed.metadata.summary)) {
    messages.push("summary must be a non-empty string.")
  }
  if (!isIsoDate(parsed.metadata.created_at)) {
    messages.push("created_at must be a real date in YYYY-MM-DD form.")
  }
  if (
    parsed.metadata.completed_at !== null &&
    !isIsoDate(parsed.metadata.completed_at)
  ) {
    messages.push("completed_at must be null or a real YYYY-MM-DD date.")
  }
  if (
    parsed.metadata.post_build_recap !== null &&
    !isNonEmptyString(parsed.metadata.post_build_recap)
  ) {
    messages.push("post_build_recap must be a non-empty string or null.")
  }

  const status = parsed.metadata.status
  if (status !== "active" && status !== "complete") {
    messages.push("status must be active or complete.")
  }
  const planLane = pathMatch?.[3]
  if (planLane === "active" && status === "complete") {
    messages.push("ExecPlans under exec-plans/active must use status: active.")
  }
  if (planLane === "completed" && status === "active") {
    messages.push(
      "ExecPlans under exec-plans/completed must use status: complete.",
    )
  }
  if (status === "active" && parsed.metadata.completed_at !== null) {
    messages.push("An active ExecPlan must have completed_at: null.")
  }
  if (status === "active" && parsed.metadata.post_build_recap !== null) {
    messages.push("An active ExecPlan must have post_build_recap: null.")
  }
  if (status === "complete") {
    if (!isIsoDate(parsed.metadata.completed_at)) {
      messages.push("A complete ExecPlan must have a real completed_at date.")
    }
    if (!isNonEmptyString(parsed.metadata.post_build_recap)) {
      messages.push(
        "A complete ExecPlan must have a non-empty post_build_recap.",
      )
    }
    if (
      !isMeaningfulText(extractSection(parsed.body, "Outcomes & Retrospective"))
    ) {
      messages.push(
        "A complete ExecPlan must contain a meaningful Outcomes & Retrospective section.",
      )
    }
  }

  if (extractH1(parsed.body) !== parsed.metadata.title) {
    messages.push("The body H1 must exactly match frontmatter title.")
  }
  if (!parsed.body.includes(MAINTENANCE_SENTENCE)) {
    messages.push(
      `The plan must include the exact maintenance sentence: ${MAINTENANCE_SENTENCE}`,
    )
  }
  validateScope(parsed.body, messages)
  validateTestCommands(parsed.body, messages)
  await validateProgramLinkage({
    messages,
    metadata: parsed.metadata,
    planRelativePath: relativePath,
    requireBriefExists: status === "active",
    repoRoot: params.repoRoot,
  })

  return [...new Set(messages)].map((message) => issue(relativePath, message))
}

export async function lintExecPlanReadiness(params: {
  planPath: string
  repoRoot: string
}): Promise<LintIssue[]> {
  const issues = await lintExecPlan(params)
  if (issues.length > 0) return issues
  const source = await readFile(params.planPath, "utf8")
  if (
    source.includes(EXEC_PLAN_PLACEHOLDER_MARKER) ||
    PLACEHOLDER_TEXT.some((pattern) => pattern.test(source))
  ) {
    issues.push(
      issue(
        path
          .relative(params.repoRoot, params.planPath)
          .split(path.sep)
          .join("/"),
        "ExecPlan still contains scaffold placeholders and cannot authorize execution.",
      ),
    )
  }
  return issues
}
