import { readFile, stat } from "node:fs/promises"
import path from "node:path"

import {
  extractSection,
  parseMarkdownFrontmatter,
  validateMarkdownDocument,
} from "../markdown/frontmatter.js"
import {
  collectRepoMarkdownFiles,
  extractMarkdownLinks,
  lintMarkdownLinks,
  resolveLocalMarkdownTarget,
} from "./links.js"

export type DocsSpineDefinition = {
  entrypoint: string
  firstClass: Record<string, string[]>
  requiredFiles: string[]
  routedDocs: string[]
}

export type DocsSpineIssue = {
  path: string
  message: string
}

export type DocsSpineReport = {
  checked: string[]
  issues: DocsSpineIssue[]
}

export const DEFAULT_DOCS_SPINE: DocsSpineDefinition = {
  entrypoint: "docs/index.md",
  firstClass: {
    "docs/index.md": [
      "docs/ARCHITECTURE.md",
      "docs/CLI.md",
      "docs/CONFIGURATION.md",
      "docs/EXTRACTION.md",
      "docs/PLANS.md",
      "docs/DEVELOPMENT.md",
      "docs/RELIABILITY.md",
      "docs/SECURITY.md",
      "docs/assignments/README.md",
      "docs/prompts/README.md",
      "docs/skills/README.md",
    ],
    "docs/ARCHITECTURE.md": [
      "docs/index.md",
      "docs/CONFIGURATION.md",
      "docs/DEVELOPMENT.md",
      "docs/EXTRACTION.md",
      "docs/PLANS.md",
    ],
    "docs/PLANS.md": [
      "docs/assignments/README.md",
      "docs/contracts/assignment.md",
      "docs/contracts/program.md",
      "docs/contracts/exec-plan.md",
    ],
    "docs/DEVELOPMENT.md": [
      "docs/CLI.md",
      "docs/RELIABILITY.md",
      "docs/prompts/README.md",
      "docs/skills/README.md",
    ],
    "docs/CLI.md": [
      "docs/CONFIGURATION.md",
      "docs/DEVELOPMENT.md",
      "docs/PLANS.md",
      "docs/SECURITY.md",
      "docs/skills/README.md",
    ],
    "docs/RELIABILITY.md": [
      "docs/CONFIGURATION.md",
      "docs/DEVELOPMENT.md",
      "docs/SECURITY.md",
      "docs/assignments/README.md",
    ],
    "docs/SECURITY.md": [
      "docs/CONFIGURATION.md",
      "docs/RELIABILITY.md",
      "docs/DEVELOPMENT.md",
      "programmers-loop.config.yaml",
    ],
    "docs/CONFIGURATION.md": [
      "docs/ARCHITECTURE.md",
      "docs/CLI.md",
      "docs/RELIABILITY.md",
      "docs/SECURITY.md",
    ],
    "docs/EXTRACTION.md": [
      "docs/ARCHITECTURE.md",
      "docs/PLANS.md",
      "docs/CLI.md",
      "docs/prompts/README.md",
      "docs/skills/README.md",
    ],
    "docs/prompts/README.md": [
      "docs/contracts/exec-plan.md",
      "docs/contracts/program.md",
      "skills/run-exec-plan/SKILL.md",
      "skills/run-program/SKILL.md",
    ],
    "docs/skills/README.md": [
      "docs/index.md",
      "docs/contracts/assignment.md",
      "docs/contracts/program.md",
      "docs/contracts/exec-plan.md",
    ],
  },
  requiredFiles: [
    "README.md",
    "AGENTS.md",
    "package.json",
    "programmers-loop.config.yaml",
    "docs/index.md",
    "docs/ARCHITECTURE.md",
    "docs/CLI.md",
    "docs/CONFIGURATION.md",
    "docs/EXTRACTION.md",
    "docs/PLANS.md",
    "docs/DEVELOPMENT.md",
    "docs/RELIABILITY.md",
    "docs/SECURITY.md",
    "docs/assignments/README.md",
    "docs/contracts/assignment.md",
    "docs/contracts/program.md",
    "docs/contracts/exec-plan.md",
    "docs/prompts/README.md",
    "docs/skills/README.md",
  ],
  routedDocs: [
    "docs/index.md",
    "docs/ARCHITECTURE.md",
    "docs/CLI.md",
    "docs/CONFIGURATION.md",
    "docs/EXTRACTION.md",
    "docs/PLANS.md",
    "docs/DEVELOPMENT.md",
    "docs/RELIABILITY.md",
    "docs/SECURITY.md",
    "docs/assignments/README.md",
    "docs/contracts/assignment.md",
    "docs/contracts/program.md",
    "docs/contracts/exec-plan.md",
    "docs/prompts/README.md",
    "docs/skills/README.md",
  ],
}

function addIssue(
  issues: DocsSpineIssue[],
  repoPath: string,
  message: string,
): void {
  issues.push({ path: repoPath, message })
}

async function fileIsNonEmpty(
  repoRoot: string,
  repoPath: string,
): Promise<boolean> {
  try {
    const fileStat = await stat(path.join(repoRoot, repoPath))
    return fileStat.isFile() && fileStat.size > 0
  } catch {
    return false
  }
}

function linkedRepoPaths(sourcePath: string, source: string): string[] {
  return extractMarkdownLinks(source).flatMap((link) => {
    const resolved = resolveLocalMarkdownTarget({
      sourcePath,
      target: link.target,
    })
    return resolved ? [resolved.repoPath] : []
  })
}

export async function validateDocsSpine(params: {
  repoRoot: string
  definition?: DocsSpineDefinition
}): Promise<DocsSpineReport> {
  const definition = params.definition ?? DEFAULT_DOCS_SPINE
  const issues: DocsSpineIssue[] = []
  const checked = await collectRepoMarkdownFiles(params.repoRoot)
  const contents = new Map<string, string>()

  for (const requiredPath of definition.requiredFiles) {
    if (!(await fileIsNonEmpty(params.repoRoot, requiredPath))) {
      addIssue(
        issues,
        requiredPath,
        "Required docs-spine file is missing or empty.",
      )
    }
  }

  for (const markdownPath of checked) {
    const source = await readFile(
      path.join(params.repoRoot, markdownPath),
      "utf8",
    )
    contents.set(markdownPath, source)
    if (source.length === 0) {
      addIssue(issues, markdownPath, "Markdown file is empty.")
    }
    for (const linkIssue of await lintMarkdownLinks({
      repoRoot: params.repoRoot,
      source,
      sourcePath: markdownPath,
    })) {
      addIssue(
        issues,
        markdownPath,
        `Broken local link at line ${linkIssue.line}: ${linkIssue.message}`,
      )
    }
  }

  for (const [firstClassPath, requiredRoutes] of Object.entries(
    definition.firstClass,
  )) {
    const source = contents.get(firstClassPath)
    if (!source) continue
    const parsed = parseMarkdownFrontmatter(source)
    for (const message of [
      ...parsed.issues,
      ...validateMarkdownDocument({
        body: parsed.body,
        metadata: parsed.metadata,
        requiredKeys: ["title", "summary", "status", "read_when"],
        requiredSections: ["Owns", "Does Not Own", "Next"],
      }),
    ]) {
      addIssue(issues, firstClassPath, message)
    }
    if (parsed.metadata.status !== "active") {
      addIssue(
        issues,
        firstClassPath,
        "First-class docs must have status: active.",
      )
    }
    if (
      typeof parsed.metadata.summary !== "string" ||
      parsed.metadata.summary.trim() === ""
    ) {
      addIssue(issues, firstClassPath, "summary must be a non-empty string.")
    }

    const nextSection = extractSection(parsed.body, "Next") ?? ""
    const nextTargets = new Set(linkedRepoPaths(firstClassPath, nextSection))
    for (const requiredRoute of requiredRoutes) {
      if (!nextTargets.has(requiredRoute)) {
        addIssue(
          issues,
          firstClassPath,
          `## Next must link to ${requiredRoute}.`,
        )
      }
    }
  }

  const graph = new Map<string, string[]>()
  for (const [markdownPath, source] of contents) {
    graph.set(
      markdownPath,
      linkedRepoPaths(markdownPath, source).filter((target) =>
        contents.has(target),
      ),
    )
  }
  const reachable = new Set<string>()
  const queue = [definition.entrypoint]
  while (queue.length > 0) {
    const current = queue.shift()
    if (!current || reachable.has(current)) continue
    reachable.add(current)
    queue.push(...(graph.get(current) ?? []))
  }
  for (const routedDoc of definition.routedDocs) {
    if (!reachable.has(routedDoc)) {
      addIssue(
        issues,
        routedDoc,
        `Document is not reachable from ${definition.entrypoint}.`,
      )
    }
  }

  return {
    checked,
    issues: issues.toSorted((left, right) =>
      `${left.path}:${left.message}`.localeCompare(
        `${right.path}:${right.message}`,
      ),
    ),
  }
}
