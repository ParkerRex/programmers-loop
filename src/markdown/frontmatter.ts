import YAML from "yaml"

export type FrontmatterRecord = Record<string, unknown>

export type ParsedMarkdown = {
  body: string
  metadata: FrontmatterRecord
  issues: string[]
}

export function parseMarkdownFrontmatter(source: string): ParsedMarkdown {
  if (!source.startsWith("---\n")) {
    return {
      body: source,
      metadata: {},
      issues: ["Missing YAML frontmatter block at the top of the document."],
    }
  }

  const closingIndex = source.indexOf("\n---\n", 4)
  if (closingIndex === -1) {
    return {
      body: source,
      metadata: {},
      issues: ["Missing closing YAML frontmatter delimiter."],
    }
  }

  const document = YAML.parseDocument(source.slice(4, closingIndex))
  const issues = document.errors.map((error) => error.message)
  const parsed = document.toJS() as unknown
  const metadata =
    parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as FrontmatterRecord)
      : {}

  if (Object.keys(metadata).length === 0 && issues.length === 0) {
    issues.push("Frontmatter must parse to a non-empty YAML object.")
  }

  return {
    body: source.slice(closingIndex + 5).trim(),
    metadata,
    issues,
  }
}

export function extractH1(body: string): string | null {
  return body.match(/^# (.+)$/m)?.[1]?.trim() ?? null
}

export function extractSection(body: string, heading: string): string | null {
  const lines = body.split("\n")
  const start = lines.findIndex((line) => line === `## ${heading}`)
  if (start === -1) {
    return null
  }

  const next = lines.findIndex(
    (line, index) => index > start && line.startsWith("## "),
  )
  return lines
    .slice(start + 1, next === -1 ? undefined : next)
    .join("\n")
    .trim()
}

export function validateMarkdownDocument(params: {
  body: string
  metadata: FrontmatterRecord
  requiredKeys: readonly string[]
  requiredSections?: readonly string[]
}): string[] {
  const issues: string[] = []
  for (const key of params.requiredKeys) {
    if (!(key in params.metadata)) {
      issues.push(`Missing required frontmatter key: ${key}.`)
    }
  }

  const title = params.metadata.title
  const h1 = extractH1(params.body)
  if (typeof title !== "string" || title.trim().length === 0) {
    issues.push("Frontmatter title must be a non-empty string.")
  } else if (h1 !== title) {
    issues.push("The body H1 must exactly match frontmatter title.")
  }

  for (const heading of params.requiredSections ?? []) {
    if (extractSection(params.body, heading) === null) {
      issues.push(`Missing required section: ## ${heading}.`)
    }
  }

  const readWhen = params.metadata.read_when
  if (
    !Array.isArray(readWhen) ||
    readWhen.length === 0 ||
    readWhen.some((entry) => typeof entry !== "string" || entry.trim() === "")
  ) {
    issues.push("Frontmatter read_when must be a non-empty string list.")
  }

  return issues
}
