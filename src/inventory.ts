import { access, readdir, readFile } from "node:fs/promises"
import path from "node:path"

import YAML from "yaml"

import { extractH1, parseMarkdownFrontmatter } from "./markdown/frontmatter.js"
import { toRepoPath } from "./repo-path.js"

export type SkillInventoryItem = {
  name: string
  description: string
  path: string
  interfacePath: string
}

export type PromptInventoryItem = {
  category: string
  name: string
  title: string
  path: string
}

export type InventoryIssue = {
  path: string
  message: string
}

export const REQUIRED_SKILLS = [
  "diagnose-programmers-loop",
  "maintain-docs-spine",
  "plan-assignment",
  "programmers-loop",
  "run-exec-plan",
  "run-program",
  "run-standup",
  "verify-programmers-loop",
  "workshop-system",
] as const

export const REQUIRED_PROMPTS = [
  "exec-plans/execute",
  "exec-plans/grill",
  "exec-plans/outline",
  "exec-plans/validate",
  "exec-plans/workflow",
  "exec-plans/write",
  "programs/completion-review",
  "programs/converge",
  "programs/cross-repo-review",
  "programs/dependency-graph",
  "programs/docs-sync",
  "programs/funnel",
  "programs/initialize",
  "programs/loop",
  "programs/normalize",
  "programs/orchestrate",
  "programs/planning-brief",
  "programs/refresh",
  "programs/research",
  "programs/split",
  "programs/synthesize",
] as const

const PROMPT_CONTRACTS: Record<
  (typeof REQUIRED_PROMPTS)[number],
  readonly string[]
> = {
  "exec-plans/execute": [
    "Implement only the approved bounded slice",
    "Maintain the ExecPlan as a living document",
    "Only after deterministic acceptance succeeds",
  ],
  "exec-plans/grill": [
    "Ask one blocking question at a time",
    "AUTOMATION_STATUS: question|complete|blocked",
    "Run the focused linter before declaring the grill complete",
  ],
  "exec-plans/outline": [
    "## Goal",
    "## User-visible outcome",
    "## In Scope",
    "## Out Of Scope",
    "## Constraints",
    "## Relevant repository surfaces",
    "## Test Commands",
    "## Open Questions",
    "## Evidence Notes",
  ],
  "exec-plans/validate": [
    "exact command set",
    "bounded repair attempt",
    "silently authorizing it",
  ],
  "exec-plans/workflow": [
    "Required sequence:",
    "deterministic receipt",
    "return control to the Program refresh loop",
  ],
  "exec-plans/write": [
    "the exact target path",
    "This ExecPlan must be maintained in accordance with `docs/contracts/exec-plan.md`.",
    "programmers-loop:placeholder",
    "run the focused ExecPlan linter",
  ],
  "programs/completion-review": [
    "Completion criteria:",
    "No required next slice remains",
    "programs/completed/",
  ],
  "programs/converge": [
    "# Converged Decision Packet",
    "## Goal And Observable Outcome",
    "## Converged Decisions",
    "## Evidence And Rationale",
    "## Tensions Or Open Questions",
    "## Constraints And Non-Goals",
    "## Interfaces And State Ownership",
    "## Failure And Recovery Expectations",
    "## Proof Expectations",
    "## Candidate Slices",
  ],
  "programs/cross-repo-review": [
    "## What Holds Up",
    "## Missing Surfaces Or Owners",
    "## Ordering Findings",
    "## Scope Findings",
    "## Migration And Recovery Findings",
    "## Proof Findings",
    "## Required Corrections",
    "## Final Recommended First Plan",
  ],
  "programs/dependency-graph": [
    "## Nodes",
    "## Dependency Order",
    "## Critical Path",
    "## Parallel Work",
    "## Interface Boundaries",
    "## Unsafe Orders To Avoid",
    "## Verification Boundaries",
  ],
  "programs/docs-sync": [
    "Do not create duplicate truth",
    "validation receipt",
    "remaining debt",
  ],
  "programs/funnel": [
    "source inventory",
    "independent research tracks",
    "Do not turn stakeholder repetition into confidence",
  ],
  "programs/initialize": [
    "Scaffold markers are not evidence",
    "Do not invent conclusions",
    "focused Program structural lint",
  ],
  "programs/loop": [
    "Planning sequence:",
    "Validation must precede docs sync",
    "move to the completed Program lane",
  ],
  "programs/normalize": [
    "## Vocabulary",
    "## Facts",
    "## Agreements",
    "## Conflicts",
    "## Dependencies",
    "## Risks",
    "## Unsupported Claims",
    "## Missing Evidence",
    "## Recommendation",
    "## Source Mapping",
    "Do not erase minority evidence",
    "Replace only the normalization scaffold",
  ],
  "programs/orchestrate": [
    "Classify durable state in this order:",
    "Select exactly the first unmet state",
    "Modify only the artifact class owned by that transition",
  ],
  "programs/planning-brief": [
    "## Goal",
    "## Converged Decisions",
    "## Open Questions",
    "## Final Plan Split",
    "## Final Dependency Order",
    "## First ExecPlan To Write",
    "## Why This First",
    "`superseded`; never rewrite",
    "execution-readiness validation",
  ],
  "programs/refresh": [
    "## What Changed",
    "## What Still Holds",
    "## Boundary Changes",
    "## Dependency Changes",
    "## Next Plan Recommendation",
    "## Risks To Carry Forward",
    "rewrite historical brief bodies",
  ],
  "programs/research": [
    "## Question",
    "## Sources Inspected",
    "## Facts",
    "## Inferences",
    "## Conflicts And Uncertainty",
    "## Implications",
    "## Recommendation",
    "## What Would Change The Recommendation",
    "Do not normalize across tracks",
  ],
  "programs/split": [
    "## Recommended Number Of Plans",
    "## Slice Summaries",
    "## Dependency Order",
    "## First Plan To Write",
    "## Boundaries Between Plans",
    "## Deferred Or Optional Work",
    "## Unsafe Consolidations",
    "Prefer vertical capabilities",
  ],
  "programs/synthesize": [
    "fresh reader can reconstruct current",
    "Slice Ledger names every child slice",
    "No required next slice remains",
  ],
}

const FORBIDDEN_PROMPT_TEXT = [
  "docs/assignments/contracts/",
  "CONTEXT-MAP.md",
  "bun run programs:lint",
] as const

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath)
    return true
  } catch {
    return false
  }
}

export async function listSkills(
  repoRoot: string,
): Promise<SkillInventoryItem[]> {
  const root = path.join(repoRoot, "skills")
  const entries = await readdir(root, { withFileTypes: true })
  const skills: SkillInventoryItem[] = []
  for (const entry of entries.toSorted((left, right) =>
    left.name.localeCompare(right.name),
  )) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue
    const skillPath = path.join(root, entry.name, "SKILL.md")
    if (!(await exists(skillPath))) continue
    const parsed = parseMarkdownFrontmatter(await readFile(skillPath, "utf8"))
    skills.push({
      name:
        typeof parsed.metadata.name === "string"
          ? parsed.metadata.name
          : entry.name,
      description:
        typeof parsed.metadata.description === "string"
          ? parsed.metadata.description
          : "",
      path: toRepoPath(repoRoot, skillPath),
      interfacePath: toRepoPath(
        repoRoot,
        path.join(root, entry.name, "agents", "openai.yaml"),
      ),
    })
  }
  return skills
}

export async function validateSkillPack(
  repoRoot: string,
): Promise<InventoryIssue[]> {
  const issues: InventoryIssue[] = []
  const skills = await listSkills(repoRoot)
  const names = new Set(skills.map((skill) => skill.name))
  for (const required of REQUIRED_SKILLS) {
    if (!names.has(required)) {
      issues.push({
        path: `skills/${required}/SKILL.md`,
        message: "Required portable skill is missing.",
      })
    }
  }
  for (const skill of skills) {
    const skillSource = parseMarkdownFrontmatter(
      await readFile(path.join(repoRoot, skill.path), "utf8"),
    )
    for (const message of skillSource.issues) {
      issues.push({ path: skill.path, message })
    }
    for (const key of Object.keys(skillSource.metadata)) {
      if (key !== "name" && key !== "description") {
        issues.push({
          path: skill.path,
          message: `Unsupported skill frontmatter key: ${key}.`,
        })
      }
    }
    const folderName = path.basename(path.dirname(skill.path))
    if (skill.name !== folderName) {
      issues.push({
        path: skill.path,
        message: "Skill name must match its directory name.",
      })
    }
    if (skill.description.trim() === "") {
      issues.push({
        path: skill.path,
        message: "Skill description is required.",
      })
    }
    const interfacePath = path.join(repoRoot, skill.interfacePath)
    if (!(await exists(interfacePath))) {
      issues.push({
        path: skill.interfacePath,
        message: "Skill must include agents/openai.yaml.",
      })
      continue
    }
    let parsed: unknown
    try {
      parsed = YAML.parse(await readFile(interfacePath, "utf8")) as unknown
    } catch (error) {
      issues.push({
        path: skill.interfacePath,
        message:
          error instanceof Error
            ? `Invalid interface YAML: ${error.message}`
            : "Invalid interface YAML.",
      })
      continue
    }
    if (
      parsed === null ||
      typeof parsed !== "object" ||
      Array.isArray(parsed)
    ) {
      issues.push({
        path: skill.interfacePath,
        message: "Interface metadata must be a YAML object.",
      })
      continue
    }
    const interfaceValue = (parsed as Record<string, unknown>).interface
    if (
      interfaceValue === null ||
      typeof interfaceValue !== "object" ||
      Array.isArray(interfaceValue)
    ) {
      issues.push({
        path: skill.interfacePath,
        message: "Missing interface metadata.",
      })
      continue
    }
    const metadata = interfaceValue as Record<string, unknown>
    for (const key of ["display_name", "short_description", "default_prompt"]) {
      if (typeof metadata[key] !== "string" || metadata[key].trim() === "") {
        issues.push({
          path: skill.interfacePath,
          message: `interface.${key} must be a non-empty string.`,
        })
      }
    }
    if (
      typeof metadata.default_prompt === "string" &&
      !metadata.default_prompt.includes(`$${skill.name}`)
    ) {
      issues.push({
        path: skill.interfacePath,
        message: `interface.default_prompt must mention $${skill.name}.`,
      })
    }
  }
  return issues
}

export async function listPrompts(
  repoRoot: string,
): Promise<PromptInventoryItem[]> {
  const promptsRoot = path.join(repoRoot, "prompts")
  const categories = await readdir(promptsRoot, { withFileTypes: true })
  const prompts: PromptInventoryItem[] = []
  for (const category of categories.toSorted((left, right) =>
    left.name.localeCompare(right.name),
  )) {
    if (!category.isDirectory() || category.name.startsWith(".")) continue
    const categoryRoot = path.join(promptsRoot, category.name)
    const entries = await readdir(categoryRoot, { withFileTypes: true })
    for (const entry of entries.toSorted((left, right) =>
      left.name.localeCompare(right.name),
    )) {
      if (!entry.isFile() || !entry.name.endsWith(".md")) continue
      const promptPath = path.join(categoryRoot, entry.name)
      const source = await readFile(promptPath, "utf8")
      prompts.push({
        category: category.name,
        name: entry.name.slice(0, -3),
        title: extractH1(source) ?? "",
        path: toRepoPath(repoRoot, promptPath),
      })
    }
  }
  return prompts
}

export async function validatePromptPack(
  repoRoot: string,
): Promise<InventoryIssue[]> {
  const prompts = await listPrompts(repoRoot)
  const names = new Set(
    prompts.map((prompt) => `${prompt.category}/${prompt.name}`),
  )
  const issues: InventoryIssue[] = []
  for (const required of REQUIRED_PROMPTS) {
    if (!names.has(required)) {
      issues.push({
        path: `prompts/${required}.md`,
        message: "Required runtime prompt is missing.",
      })
    }
  }
  for (const prompt of prompts) {
    if (prompt.title.trim() === "") {
      issues.push({
        path: prompt.path,
        message: "Prompt must have an H1 title.",
      })
    }
  }
  for (const required of REQUIRED_PROMPTS) {
    if (!names.has(required)) continue
    const promptPath = path.join(repoRoot, "prompts", `${required}.md`)
    const source = await readFile(promptPath, "utf8")
    const lineCount = source
      .split(/\r?\n/)
      .filter((line) => line.trim() !== "").length
    if (lineCount < 12) {
      issues.push({
        path: toRepoPath(repoRoot, promptPath),
        message:
          "Runtime prompt is too short to preserve its operating contract.",
      })
    }
    for (const requiredText of PROMPT_CONTRACTS[required]) {
      if (!source.includes(requiredText)) {
        issues.push({
          path: toRepoPath(repoRoot, promptPath),
          message: `Prompt contract is missing required text: ${requiredText}`,
        })
      }
    }
    for (const forbiddenText of FORBIDDEN_PROMPT_TEXT) {
      if (source.includes(forbiddenText)) {
        issues.push({
          path: toRepoPath(repoRoot, promptPath),
          message: `Prompt contains source-specific text: ${forbiddenText}`,
        })
      }
    }
  }
  return issues
}
