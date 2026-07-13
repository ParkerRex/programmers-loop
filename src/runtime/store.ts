import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import path from "node:path"
import { randomUUID } from "node:crypto"

import { assertWritePathInRepo, toRepoPath } from "../repo-path.js"

export function createRunId(prefix: string): string {
  const timestamp = new Date().toISOString().replaceAll(":", "-")
  return `${prefix}-${timestamp}-${randomUUID().slice(0, 8)}`
}

export async function writeRuntimeJson(params: {
  relativePath: string
  repoRoot: string
  value: unknown
}): Promise<string> {
  return writeRuntimeText({
    relativePath: params.relativePath,
    repoRoot: params.repoRoot,
    text: `${JSON.stringify(params.value, null, 2)}\n`,
  })
}

export async function writeRuntimeText(params: {
  relativePath: string
  repoRoot: string
  text: string
}): Promise<string> {
  const targetPath = path.resolve(params.repoRoot, params.relativePath)
  await assertWritePathInRepo(params.repoRoot, targetPath)
  await mkdir(path.dirname(targetPath), { recursive: true })
  const temporaryPath = `${targetPath}.${process.pid}.${randomUUID()}.tmp`
  await writeFile(temporaryPath, params.text, {
    encoding: "utf8",
    flag: "wx",
  })
  await rename(temporaryPath, targetPath)
  return toRepoPath(params.repoRoot, targetPath)
}

export async function readRuntimeJson<T>(params: {
  relativePath: string
  repoRoot: string
}): Promise<T | null> {
  const targetPath = path.resolve(params.repoRoot, params.relativePath)
  await assertWritePathInRepo(params.repoRoot, targetPath)
  try {
    return JSON.parse(await readFile(targetPath, "utf8")) as T
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === "ENOENT") return null
    throw error
  }
}
