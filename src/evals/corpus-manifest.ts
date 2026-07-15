import { createHash } from "node:crypto"
import { readdir, readFile } from "node:fs/promises"
import path from "node:path"

import { UserInputError } from "../repo-path.js"
import {
  HIDDEN_DIRECTORIES,
  loadTaskPackage,
  TASK_MANIFEST_FILENAME,
  type TaskStratum,
  type TaskWorkflowShape,
  WORKSPACE_DIRECTORY,
  workspaceFingerprint,
} from "./task-package.js"

/**
 * Versioned freeze artifact pinning a whole task corpus (issue #3, the one
 * unmet criterion). Where {@link buildManifest} pins one RUN's configuration
 * and episode list, this pins the CORPUS itself: for every task package it
 * records the version and the content hashes that make the package immutable —
 * the public workspace fingerprint, the `task.yaml` bytes, and every hidden
 * grader file. #14 hashes this document to prove the scored corpus never
 * shifted under a study.
 *
 * Output is deterministic: task packages are validated with {@link
 * loadTaskPackage} and emitted sorted by id, grader hashes sorted by path, so
 * two builds of an unchanged corpus are byte-identical and any single changed
 * byte changes the manifest.
 */
export const CORPUS_MANIFEST_SCHEMA_VERSION = 1

export type CorpusTaskEntry = {
  id: string
  version: number
  workflowShape: TaskWorkflowShape
  expectedStratum: TaskStratum | null
  /** sha256 of the public starting workspace tree (paths + bytes). */
  workspaceFingerprint: string
  /** sha256 of the public `task.yaml` manifest bytes. */
  taskYamlSha256: string
  /** Package-relative grader file path -> sha256, sorted by path. */
  graderSha256: Record<string, string>
}

export type CorpusManifest = {
  schemaVersion: typeof CORPUS_MANIFEST_SCHEMA_VERSION
  taskCount: number
  /** Task entries sorted by id. */
  tasks: CorpusTaskEntry[]
}

async function sha256File(file: string): Promise<string> {
  return createHash("sha256")
    .update(await readFile(file))
    .digest("hex")
}

/**
 * Sorted package-relative paths of every regular file under `dir`, walked in
 * deterministic name order. Returns [] when the directory is absent.
 */
async function walkFiles(dir: string, prefix: string): Promise<string[]> {
  let dirents
  try {
    dirents = await readdir(dir, { withFileTypes: true })
  } catch {
    return []
  }
  const files: string[] = []
  for (const dirent of dirents.toSorted((l, r) => (l.name < r.name ? -1 : 1))) {
    const rel = prefix === "" ? dirent.name : `${prefix}/${dirent.name}`
    if (dirent.isDirectory()) {
      files.push(...(await walkFiles(path.join(dir, dirent.name), rel)))
    } else if (dirent.isFile()) {
      files.push(rel)
    }
  }
  return files
}

/**
 * Walk `tasksDir`, validate every package, and build the versioned corpus
 * manifest. Throws {@link UserInputError} when the directory is missing, empty,
 * or holds an invalid package (nothing is pinned that would not load).
 */
export async function buildCorpusManifest(params: {
  tasksDir: string
}): Promise<CorpusManifest> {
  const tasksAbs = path.resolve(params.tasksDir)
  let entries
  try {
    entries = await readdir(tasksAbs, { withFileTypes: true })
  } catch {
    throw new UserInputError(`Task directory not found: ${tasksAbs}`)
  }
  const names = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .toSorted((left, right) => (left < right ? -1 : 1))

  const tasks: CorpusTaskEntry[] = []
  for (const name of names) {
    const packageDir = path.join(tasksAbs, name)
    const loaded = await loadTaskPackage(packageDir)
    if (loaded.pkg === null) {
      throw new UserInputError(
        `Task package ${name} is invalid: ${loaded.issues[0] ?? "unknown issue"}`,
      )
    }
    const pkg = loaded.pkg
    const graderRelPaths = await walkFiles(
      path.join(packageDir, HIDDEN_DIRECTORIES[0]),
      HIDDEN_DIRECTORIES[0],
    )
    const graderSha256: Record<string, string> = {}
    for (const rel of graderRelPaths) {
      graderSha256[rel] = await sha256File(path.join(packageDir, rel))
    }
    tasks.push({
      expectedStratum: pkg.expectedStratum,
      graderSha256,
      id: pkg.id,
      taskYamlSha256: await sha256File(
        path.join(packageDir, TASK_MANIFEST_FILENAME),
      ),
      version: pkg.version,
      workflowShape: pkg.workflowShape,
      workspaceFingerprint: await workspaceFingerprint(
        path.join(packageDir, WORKSPACE_DIRECTORY),
      ),
    })
  }
  if (tasks.length === 0) {
    throw new UserInputError(`No task packages found in ${tasksAbs}`)
  }
  tasks.sort((left, right) => (left.id < right.id ? -1 : 1))
  return {
    schemaVersion: CORPUS_MANIFEST_SCHEMA_VERSION,
    taskCount: tasks.length,
    tasks,
  }
}

/** Stable pretty-printed JSON with a trailing newline; the freeze artifact form. */
export function serializeCorpusManifest(manifest: CorpusManifest): string {
  return `${JSON.stringify(manifest, null, 2)}\n`
}
