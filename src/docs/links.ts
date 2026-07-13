import { readdir, readFile, stat } from "node:fs/promises"
import path from "node:path"

export type MarkdownLink = {
  line: number
  target: string
}

export type MarkdownLinkIssue = MarkdownLink & {
  message: string
  sourcePath: string
}

const EXCLUDED_DIRECTORIES = new Set([
  ".git",
  ".runtime",
  "dist",
  "node_modules",
])

function withoutFencedCode(source: string): string {
  return source.replace(/```[\s\S]*?```/g, (block) =>
    block.replace(/[^\n]/g, " "),
  )
}

export function extractMarkdownLinks(source: string): MarkdownLink[] {
  const searchable = withoutFencedCode(source)
  const links: MarkdownLink[] = []
  const pattern = /!?\[[^\]]*\]\(([^)]+)\)/g
  for (const match of searchable.matchAll(pattern)) {
    const rawTarget = match[1]?.trim() ?? ""
    const target =
      rawTarget.startsWith("<") && rawTarget.endsWith(">")
        ? rawTarget.slice(1, -1)
        : (rawTarget.split(/\s+["']/)[0] ?? rawTarget)
    if (target === "") continue
    const index = match.index ?? 0
    links.push({
      line: searchable.slice(0, index).split("\n").length,
      target,
    })
  }
  return links
}

function isExternalTarget(target: string): boolean {
  return /^(?:https?:|mailto:|tel:)/i.test(target)
}

export function resolveLocalMarkdownTarget(params: {
  sourcePath: string
  target: string
}): { anchor: string | null; repoPath: string } | null {
  if (isExternalTarget(params.target) || params.target.startsWith("#")) {
    return null
  }

  const [targetPath, anchor] = params.target.split("#", 2)
  if (!targetPath) return null
  let decodedPath: string
  try {
    decodedPath = decodeURIComponent(targetPath)
  } catch {
    decodedPath = targetPath
  }
  const repoPath = path.posix.normalize(
    decodedPath.startsWith("/")
      ? decodedPath.slice(1)
      : path.posix.join(path.posix.dirname(params.sourcePath), decodedPath),
  )
  return { anchor: anchor || null, repoPath }
}

function headingAnchors(source: string): Set<string> {
  const anchors = new Set<string>()
  const counts = new Map<string, number>()
  for (const match of source.matchAll(/^#{1,6}\s+(.+)$/gm)) {
    const base = (match[1] ?? "")
      .trim()
      .toLowerCase()
      .replace(/[`*_~]/g, "")
      .replace(/[^\p{L}\p{N}\s-]/gu, "")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
    const count = counts.get(base) ?? 0
    counts.set(base, count + 1)
    anchors.add(count === 0 ? base : `${base}-${count}`)
  }
  return anchors
}

export async function lintMarkdownLinks(params: {
  repoRoot: string
  source: string
  sourcePath: string
}): Promise<MarkdownLinkIssue[]> {
  const issues: MarkdownLinkIssue[] = []
  for (const link of extractMarkdownLinks(params.source)) {
    if (link.target.startsWith("#")) {
      const anchor = link.target.slice(1)
      if (!headingAnchors(params.source).has(anchor)) {
        issues.push({
          ...link,
          sourcePath: params.sourcePath,
          message: `Heading anchor does not exist: #${anchor}.`,
        })
      }
      continue
    }
    const resolved = resolveLocalMarkdownTarget({
      sourcePath: params.sourcePath,
      target: link.target,
    })
    if (!resolved) continue

    const absolutePath = path.resolve(params.repoRoot, resolved.repoPath)
    const relativeFromRoot = path.relative(params.repoRoot, absolutePath)
    if (
      relativeFromRoot.startsWith("..") ||
      path.isAbsolute(relativeFromRoot)
    ) {
      issues.push({
        ...link,
        sourcePath: params.sourcePath,
        message: "Local link escapes the repository root.",
      })
      continue
    }

    let targetStat
    try {
      targetStat = await stat(absolutePath)
    } catch {
      issues.push({
        ...link,
        sourcePath: params.sourcePath,
        message: `Local link target does not exist: ${resolved.repoPath}.`,
      })
      continue
    }

    if (resolved.anchor) {
      if (!targetStat.isFile() || !resolved.repoPath.endsWith(".md")) {
        issues.push({
          ...link,
          sourcePath: params.sourcePath,
          message: "Heading anchors require a Markdown file target.",
        })
        continue
      }
      const targetSource = await readFile(absolutePath, "utf8")
      if (!headingAnchors(targetSource).has(resolved.anchor)) {
        issues.push({
          ...link,
          sourcePath: params.sourcePath,
          message: `Heading anchor does not exist in ${resolved.repoPath}: #${resolved.anchor}.`,
        })
      }
    }
  }
  return issues
}

export async function collectRepoMarkdownFiles(
  repoRoot: string,
): Promise<string[]> {
  const matches: string[] = []

  async function visit(absoluteDirectory: string): Promise<void> {
    for (const entry of await readdir(absoluteDirectory, {
      withFileTypes: true,
    })) {
      if (entry.isDirectory() && EXCLUDED_DIRECTORIES.has(entry.name)) continue
      const absolutePath = path.join(absoluteDirectory, entry.name)
      if (entry.isDirectory()) {
        await visit(absolutePath)
      } else if (entry.isFile() && entry.name.endsWith(".md")) {
        matches.push(
          path.relative(repoRoot, absolutePath).split(path.sep).join("/"),
        )
      }
    }
  }

  await visit(repoRoot)
  return matches.toSorted()
}
