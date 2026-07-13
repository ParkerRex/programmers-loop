import path from "node:path"
import { realpath } from "node:fs/promises"

export class UserInputError extends Error {}

function assertContained(
  repoRoot: string,
  resolved: string,
  inputPath: string,
): void {
  const relative = path.relative(repoRoot, resolved)
  if (
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new UserInputError(
      `Path must stay inside the repository: ${inputPath}`,
    )
  }
}

export function toRepoPath(repoRoot: string, filePath: string): string {
  return path.relative(repoRoot, filePath).split(path.sep).join("/")
}

export function resolveRepoPath(repoRoot: string, inputPath: string): string {
  const resolved = path.resolve(repoRoot, inputPath)
  assertContained(repoRoot, resolved, inputPath)
  return resolved
}

export async function resolveExistingRepoPath(
  repoRoot: string,
  inputPath: string,
): Promise<string> {
  const lexicalPath = resolveRepoPath(repoRoot, inputPath)
  const [realRoot, realPath] = await Promise.all([
    realpath(repoRoot),
    realpath(lexicalPath),
  ])
  assertContained(realRoot, realPath, inputPath)
  return lexicalPath
}

export async function assertWritePathInRepo(
  repoRoot: string,
  targetPath: string,
): Promise<void> {
  const lexicalPath = resolveRepoPath(repoRoot, targetPath)
  let ancestor = path.dirname(lexicalPath)
  while (true) {
    let realAncestor: string
    try {
      realAncestor = await realpath(ancestor)
    } catch (error) {
      if (
        error === null ||
        typeof error !== "object" ||
        !("code" in error) ||
        error.code !== "ENOENT"
      ) {
        throw error
      }
      const parent = path.dirname(ancestor)
      if (parent === ancestor || ancestor === path.resolve(repoRoot))
        throw error
      ancestor = parent
      continue
    }
    const realRoot = await realpath(repoRoot)
    assertContained(realRoot, realAncestor, targetPath)
    return
  }
}

export function assertKebabCase(value: string, label: string): void {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)) {
    throw new UserInputError(`${label} must be a lowercase kebab-case value.`)
  }
}

export function assertIsoDate(value: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new UserInputError("date must use YYYY-MM-DD form.")
  }
  const parsed = new Date(`${value}T00:00:00.000Z`)
  if (
    Number.isNaN(parsed.valueOf()) ||
    parsed.toISOString().slice(0, 10) !== value
  ) {
    throw new UserInputError(
      "date must be a real calendar date in YYYY-MM-DD form.",
    )
  }
}
