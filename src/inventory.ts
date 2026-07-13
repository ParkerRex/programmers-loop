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
  "exec-plans/validate",
  "exec-plans/write",
  "programs/converge",
  "programs/orchestrate",
  "programs/refresh",
  "programs/research",
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
        title: extractH1(source) ?? entry.name.slice(0, -3),
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
  return issues
}
