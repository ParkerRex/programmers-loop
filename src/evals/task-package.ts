import { createHash } from "node:crypto"
import { copyFile, mkdir, readdir, readFile } from "node:fs/promises"
import path from "node:path"

import YAML from "yaml"

import {
  isNonEmptyString,
  KEBAB_CASE,
  safeRepoRelativePath,
} from "../contracts/shared.js"

/**
 * Versioned on-disk contract for one evaluation task package.
 *
 * Layout of a package directory:
 *
 * ```text
 * evals/tasks/<id>/
 *   task.yaml     public manifest (validated here)
 *   workspace/    starting repository snapshot given to the evaluated agent
 *   graders/      HIDDEN acceptance; never materialized into a sandbox
 *   reference/    HIDDEN authoring aids; never materialized into a sandbox
 * ```
 *
 * The evaluated agent only ever sees a materialized copy of `workspace/`.
 * Hidden acceptance lives in `graders/` and is executed by the episode
 * runner as `node <packageDir>/<grader.command[0]> ...grader.command.slice(1)
 * <sandboxDir>` with the package directory as the working directory. A
 * grader prints one JSON {@link TaskGraderSummary} line to stdout and exits
 * zero only when every component passes.
 */
export const TASK_PACKAGE_SCHEMA_VERSION = 1

/** Manifest file name inside a task package directory. */
export const TASK_MANIFEST_FILENAME = "task.yaml"

/** Directory holding the public starting snapshot. */
export const WORKSPACE_DIRECTORY = "workspace"

/**
 * Directory names that hold hidden acceptance material. These names are
 * reserved: they must not appear as a path segment anywhere inside
 * `workspace/`, and {@link materializeWorkspace} refuses to produce a
 * sandbox that contains them.
 */
export const HIDDEN_DIRECTORIES = ["graders", "reference"] as const

export const WORKFLOW_SHAPES = ["skip", "exec-plan", "program"] as const

/** Smallest Programmers Loop route the task is expected to exercise. */
export type TaskWorkflowShape = (typeof WORKFLOW_SHAPES)[number]

export const TASK_STRATA = [
  "saturation",
  "substitution",
  "frontier-overhang",
  "reliability",
] as const

/** Difficulty stratum from the model-overhang evaluation specification. */
export type TaskStratum = (typeof TASK_STRATA)[number]

export const PROVENANCE_SOURCES = ["synthetic-public", "private"] as const

export type TaskProvenanceSource = (typeof PROVENANCE_SOURCES)[number]

/** Declared tool policy. Only fully offline tasks are supported today. */
export type TaskToolPolicy = {
  network: "deny"
  /**
   * Optional named-tool allow/deny lists (the "Better Harnesses" tool-filtering
   * hook), threaded to the agent adapter as its `AgentToolPolicy`. Absent leaves
   * the adapter's sandbox-mode defaults. Names are provider tool identifiers
   * (e.g. `Bash`, `Edit`, a scoped `Bash(git *)`), not shell commands. Enforced
   * by the Claude arm via `--allowedTools`/`--disallowedTools`; declared-but-not-
   * enforced by the Codex arm, which has no named-tool CLI surface.
   */
  tools?: {
    allowed?: string[]
    disallowed?: string[]
  }
}

export type TaskBudgets = {
  maxWallMs: number
  maxPhases: number
  maxTurns: number
}

/**
 * Scope contract for the evaluated agent, expressed as globs relative to
 * the workspace root (`*` matches within one path segment, `**` matches
 * across segments). Hidden graders enforce the same boundary independently.
 */
export type TaskScope = {
  allowedPaths: string[]
  forbiddenPaths: string[]
}

export type TaskProvenance = {
  source: TaskProvenanceSource
  contaminationNotes: string
  /**
   * GUID embedded verbatim in at least one workspace file. Seeing this
   * value in model output or training data proves contamination.
   */
  canary: string
}

/**
 * Hidden grader invocation. `command[0]` is a path relative to the package
 * directory and must live under `graders/`; the runner appends the sandbox
 * directory as the final argument and executes the script with Node.
 */
export type TaskGraderSpec = {
  command: string[]
  timeoutMs: number
}

/** Parsed, validated view of one task package. */
export type TaskPackage = {
  /** Absolute path of the package directory. */
  dir: string
  schemaVersion: typeof TASK_PACKAGE_SCHEMA_VERSION
  id: string
  version: number
  title: string
  /** Concise developer-facing prompt handed to the evaluated agent. */
  request: string
  /** Command run inside the sandbox before the agent starts, or null. */
  setupCommand: string | null
  toolPolicy: TaskToolPolicy
  budgets: TaskBudgets
  workflowShape: TaskWorkflowShape
  /** Null until the task has been calibrated against real model tiers. */
  expectedStratum: TaskStratum | null
  scope: TaskScope
  provenance: TaskProvenance
  grader: TaskGraderSpec
}

export type LoadedTaskPackage = {
  /** Non-null exactly when `issues` is empty. */
  pkg: TaskPackage | null
  issues: string[]
}

/**
 * Component result a grader prints as a single JSON line on stdout.
 * The grader process exits zero only when every component is true.
 */
export type TaskGraderSummary = {
  functional: boolean
  regression: boolean
  scope: boolean
  notes: string[]
}

const GUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

const ALLOWED_MANIFEST_KEYS = new Set([
  "schema_version",
  "id",
  "version",
  "title",
  "request",
  "setup_command",
  "tool_policy",
  "budgets",
  "workflow_shape",
  "expected_stratum",
  "scope",
  "provenance",
  "grader",
])

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function unexpectedKeyIssues(
  record: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  label: string,
): string[] {
  return Object.keys(record)
    .filter((key) => !allowed.has(key))
    .toSorted()
    .map((key) => `Unexpected ${label} key: ${key}.`)
}

function requireString(
  record: Record<string, unknown>,
  key: string,
  issues: string[],
): string {
  const value = record[key]
  if (isNonEmptyString(value)) return value
  issues.push(`${key} must be a non-empty string.`)
  return ""
}

function requirePositiveInteger(
  record: Record<string, unknown>,
  key: string,
  issues: string[],
): number {
  const value = record[key]
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return value
  }
  issues.push(`${key} must be a positive integer.`)
  return 0
}

function requireEnum<T extends string>(
  record: Record<string, unknown>,
  key: string,
  values: readonly T[],
  issues: string[],
): T {
  const value = record[key]
  const match = values.find((candidate) => candidate === value)
  if (match !== undefined) return match
  issues.push(`${key} must be one of: ${values.join(", ")}.`)
  return values[0] as T
}

function requireNullableString(
  record: Record<string, unknown>,
  key: string,
  issues: string[],
): string | null {
  if (!(key in record)) {
    issues.push(`${key} must be present; use null when it does not apply.`)
    return null
  }
  const value = record[key]
  if (value === null || value === undefined) return null
  if (isNonEmptyString(value)) return value
  issues.push(`${key} must be null or a non-empty string.`)
  return null
}

function requirePathPatternList(
  record: Record<string, unknown>,
  key: string,
  issues: string[],
  options: { allowEmpty: boolean },
): string[] {
  const value = record[key]
  if (!Array.isArray(value)) {
    issues.push(`${key} must be a string list.`)
    return []
  }
  const entries = value.filter(isNonEmptyString)
  if (entries.length !== value.length) {
    issues.push(`${key} entries must be non-empty strings.`)
    return []
  }
  if (!options.allowEmpty && entries.length === 0) {
    issues.push(`${key} must not be empty.`)
    return []
  }
  for (const entry of entries) {
    if (!safeRepoRelativePath(entry)) {
      issues.push(
        `${key} entries must be normalized workspace-relative paths or globs: ${entry}.`,
      )
    }
  }
  return entries
}

/**
 * Optional string-list field under `tool_policy.tools`. Absent yields undefined
 * (the field is optional); a present-but-malformed value records an issue.
 */
function parseToolNameList(
  record: Record<string, unknown>,
  key: string,
  issues: string[],
): string[] | undefined {
  if (!(key in record)) return undefined
  const value = record[key]
  if (!Array.isArray(value)) {
    issues.push(`tool_policy.tools.${key} must be a string list.`)
    return undefined
  }
  const entries = value.filter(isNonEmptyString)
  if (entries.length !== value.length) {
    issues.push(`tool_policy.tools.${key} entries must be non-empty strings.`)
    return undefined
  }
  return entries
}

/** Validate the optional `tool_policy.tools` allow/deny object. */
function parseToolNamePolicy(
  value: unknown,
  issues: string[],
): { allowed?: string[]; disallowed?: string[] } | undefined {
  if (!isRecord(value)) {
    issues.push("tool_policy.tools must be a YAML object.")
    return undefined
  }
  issues.push(
    ...unexpectedKeyIssues(
      value,
      new Set(["allowed", "disallowed"]),
      "tool_policy.tools",
    ),
  )
  const allowed = parseToolNameList(value, "allowed", issues)
  const disallowed = parseToolNameList(value, "disallowed", issues)
  const result: { allowed?: string[]; disallowed?: string[] } = {}
  if (allowed !== undefined) result.allowed = allowed
  if (disallowed !== undefined) result.disallowed = disallowed
  return result
}

type TreeEntry = {
  absolutePath: string
  kind: "directory" | "file"
  relativePath: string
}

/**
 * Deterministic depth-first walk: entries of every directory are visited in
 * sorted name order, so two walks of identical trees produce identical
 * sequences on every platform. Symbolic links and special files are
 * rejected because they cannot be reset deterministically.
 */
async function walkTree(root: string): Promise<TreeEntry[]> {
  const entries: TreeEntry[] = []
  async function visit(directory: string, prefix: string): Promise<void> {
    const dirents = await readdir(directory, { withFileTypes: true })
    dirents.sort((left, right) => (left.name < right.name ? -1 : 1))
    for (const dirent of dirents) {
      const absolutePath = path.join(directory, dirent.name)
      const relativePath =
        prefix === "" ? dirent.name : `${prefix}/${dirent.name}`
      if (dirent.isSymbolicLink()) {
        throw new Error(
          `Task package trees must not contain symbolic links: ${relativePath}`,
        )
      }
      if (dirent.isDirectory()) {
        entries.push({ absolutePath, kind: "directory", relativePath })
        await visit(absolutePath, relativePath)
      } else if (dirent.isFile()) {
        entries.push({ absolutePath, kind: "file", relativePath })
      } else {
        throw new Error(
          `Task package trees must contain only regular files and directories: ${relativePath}`,
        )
      }
    }
  }
  await visit(root, "")
  return entries
}

function reservedSegment(relativePath: string): string | null {
  for (const segment of relativePath.split("/")) {
    for (const reserved of HIDDEN_DIRECTORIES) {
      if (segment === reserved) return reserved
    }
  }
  return null
}

async function isDirectory(candidate: string): Promise<boolean> {
  try {
    await readdir(candidate)
    return true
  } catch {
    return false
  }
}

async function isReadableFile(candidate: string): Promise<boolean> {
  try {
    await readFile(candidate)
    return true
  } catch {
    return false
  }
}

/**
 * Load and validate one task package directory.
 *
 * Beyond field validation this verifies the structural contract: the id
 * matches the directory name, `workspace/` exists and contains no reserved
 * hidden-directory names, the grader entry script exists under `graders/`,
 * and the provenance canary GUID appears verbatim in at least one workspace
 * file. `pkg` is non-null exactly when `issues` is empty.
 */
export async function loadTaskPackage(dir: string): Promise<LoadedTaskPackage> {
  const packageDir = path.resolve(dir)
  const issues: string[] = []

  let manifestSource: string
  try {
    manifestSource = await readFile(
      path.join(packageDir, TASK_MANIFEST_FILENAME),
      "utf8",
    )
  } catch {
    return {
      pkg: null,
      issues: [`Missing readable ${TASK_MANIFEST_FILENAME} in ${packageDir}.`],
    }
  }

  const document = YAML.parseDocument(manifestSource)
  for (const error of document.errors) issues.push(error.message)
  const parsed = document.toJS() as unknown
  if (!isRecord(parsed)) {
    issues.push(`${TASK_MANIFEST_FILENAME} must parse to a YAML object.`)
    return { pkg: null, issues }
  }

  issues.push(...unexpectedKeyIssues(parsed, ALLOWED_MANIFEST_KEYS, "manifest"))

  if (parsed.schema_version !== TASK_PACKAGE_SCHEMA_VERSION) {
    issues.push(`schema_version must equal ${TASK_PACKAGE_SCHEMA_VERSION}.`)
  }

  const id = requireString(parsed, "id", issues)
  if (id !== "" && !KEBAB_CASE.test(id)) {
    issues.push("id must be a kebab-case slug.")
  }
  if (id !== "" && path.basename(packageDir) !== id) {
    issues.push(
      `id must match the package directory name: ${path.basename(packageDir)}.`,
    )
  }

  const version = requirePositiveInteger(parsed, "version", issues)
  const title = requireString(parsed, "title", issues)
  const request = requireString(parsed, "request", issues)
  const setupCommand = requireNullableString(parsed, "setup_command", issues)

  const toolPolicy: TaskToolPolicy = { network: "deny" }
  if (!isRecord(parsed.tool_policy)) {
    issues.push("tool_policy must be a YAML object.")
  } else {
    issues.push(
      ...unexpectedKeyIssues(
        parsed.tool_policy,
        new Set(["network", "tools"]),
        "tool_policy",
      ),
    )
    if (parsed.tool_policy.network !== "deny") {
      issues.push('tool_policy.network must be "deny".')
    }
    // `tools` is an optional additive field; absent or null keeps the sandbox
    // defaults, a present object is validated as allow/deny string lists.
    if ("tools" in parsed.tool_policy && parsed.tool_policy.tools !== null) {
      const tools = parseToolNamePolicy(parsed.tool_policy.tools, issues)
      if (tools) toolPolicy.tools = tools
    }
  }

  const budgets: TaskBudgets = { maxPhases: 0, maxTurns: 0, maxWallMs: 0 }
  if (!isRecord(parsed.budgets)) {
    issues.push("budgets must be a YAML object.")
  } else {
    issues.push(
      ...unexpectedKeyIssues(
        parsed.budgets,
        new Set(["max_wall_ms", "max_phases", "max_turns"]),
        "budgets",
      ),
    )
    budgets.maxWallMs = requirePositiveInteger(
      parsed.budgets,
      "max_wall_ms",
      issues,
    )
    budgets.maxPhases = requirePositiveInteger(
      parsed.budgets,
      "max_phases",
      issues,
    )
    budgets.maxTurns = requirePositiveInteger(
      parsed.budgets,
      "max_turns",
      issues,
    )
  }

  const workflowShape = requireEnum(
    parsed,
    "workflow_shape",
    WORKFLOW_SHAPES,
    issues,
  )

  let expectedStratum: TaskStratum | null = null
  if (!("expected_stratum" in parsed)) {
    issues.push(
      "expected_stratum must be present; use null before calibration.",
    )
  } else if (parsed.expected_stratum !== null) {
    expectedStratum = requireEnum(
      parsed,
      "expected_stratum",
      TASK_STRATA,
      issues,
    )
  }

  const scope: TaskScope = { allowedPaths: [], forbiddenPaths: [] }
  if (!isRecord(parsed.scope)) {
    issues.push("scope must be a YAML object.")
  } else {
    issues.push(
      ...unexpectedKeyIssues(
        parsed.scope,
        new Set(["allowed_paths", "forbidden_paths"]),
        "scope",
      ),
    )
    scope.allowedPaths = requirePathPatternList(
      parsed.scope,
      "allowed_paths",
      issues,
      { allowEmpty: false },
    )
    scope.forbiddenPaths = requirePathPatternList(
      parsed.scope,
      "forbidden_paths",
      issues,
      { allowEmpty: true },
    )
  }

  const provenance: TaskProvenance = {
    canary: "",
    contaminationNotes: "",
    source: "synthetic-public",
  }
  if (!isRecord(parsed.provenance)) {
    issues.push("provenance must be a YAML object.")
  } else {
    issues.push(
      ...unexpectedKeyIssues(
        parsed.provenance,
        new Set(["source", "contamination_notes", "canary"]),
        "provenance",
      ),
    )
    provenance.source = requireEnum(
      parsed.provenance,
      "source",
      PROVENANCE_SOURCES,
      issues,
    )
    provenance.contaminationNotes = requireString(
      parsed.provenance,
      "contamination_notes",
      issues,
    )
    provenance.canary = requireString(parsed.provenance, "canary", issues)
    if (provenance.canary !== "" && !GUID_PATTERN.test(provenance.canary)) {
      issues.push("provenance.canary must be a lowercase GUID.")
      provenance.canary = ""
    }
  }

  const grader: TaskGraderSpec = { command: [], timeoutMs: 0 }
  if (!isRecord(parsed.grader)) {
    issues.push("grader must be a YAML object.")
  } else {
    issues.push(
      ...unexpectedKeyIssues(
        parsed.grader,
        new Set(["command", "timeout_ms"]),
        "grader",
      ),
    )
    const command = parsed.grader.command
    if (!Array.isArray(command) || command.length === 0) {
      issues.push("grader.command must be a non-empty string list.")
    } else {
      const tokens = command.filter(isNonEmptyString)
      if (tokens.length !== command.length) {
        issues.push("grader.command entries must be non-empty strings.")
      } else {
        grader.command = tokens
        const entry = tokens[0] as string
        if (
          !safeRepoRelativePath(entry) ||
          !entry.startsWith(`${HIDDEN_DIRECTORIES[0]}/`)
        ) {
          issues.push(
            "grader.command[0] must be a normalized path under graders/.",
          )
        } else if (!(await isReadableFile(path.join(packageDir, entry)))) {
          issues.push(`grader.command[0] does not exist: ${entry}.`)
        }
      }
    }
    grader.timeoutMs = requirePositiveInteger(
      parsed.grader,
      "timeout_ms",
      issues,
    )
  }

  const workspaceDir = path.join(packageDir, WORKSPACE_DIRECTORY)
  if (!(await isDirectory(workspaceDir))) {
    issues.push(`Missing ${WORKSPACE_DIRECTORY}/ directory.`)
  } else {
    try {
      const entries = await walkTree(workspaceDir)
      const files = entries.filter((entry) => entry.kind === "file")
      if (files.length === 0) {
        issues.push(`${WORKSPACE_DIRECTORY}/ must contain at least one file.`)
      }
      for (const entry of entries) {
        const reserved = reservedSegment(entry.relativePath)
        if (reserved !== null) {
          issues.push(
            `${WORKSPACE_DIRECTORY}/ must not contain the reserved name ${reserved}: ${entry.relativePath}.`,
          )
        }
      }
      if (provenance.canary !== "") {
        let found = false
        for (const file of files) {
          if (
            (await readFile(file.absolutePath, "utf8")).includes(
              provenance.canary,
            )
          ) {
            found = true
            break
          }
        }
        if (!found) {
          issues.push("provenance.canary was not found in any workspace file.")
        }
      }
    } catch (error) {
      issues.push(error instanceof Error ? error.message : String(error))
    }
  }

  if (issues.length > 0) return { pkg: null, issues }
  return {
    issues,
    pkg: {
      budgets,
      dir: packageDir,
      expectedStratum,
      grader,
      id,
      provenance,
      request,
      schemaVersion: TASK_PACKAGE_SCHEMA_VERSION,
      scope,
      setupCommand,
      title,
      toolPolicy,
      version,
      workflowShape,
    },
  }
}

/**
 * Materialize the public workspace snapshot into `destDir`.
 *
 * Copies `workspace/` recursively in deterministic (sorted) order and
 * nothing else: hidden `graders/` and `reference/` content is excluded by
 * construction, and the destination tree is re-walked afterwards to verify
 * that no path uses a reserved hidden-directory name. `destDir` is created
 * if needed and must be empty, so repeated resets are byte-identical (see
 * {@link workspaceFingerprint}).
 */
export async function materializeWorkspace(
  pkg: TaskPackage,
  destDir: string,
): Promise<void> {
  const workspaceDir = path.join(pkg.dir, WORKSPACE_DIRECTORY)
  if (!(await isDirectory(workspaceDir))) {
    throw new Error(`Task package has no workspace directory: ${workspaceDir}`)
  }
  await mkdir(destDir, { recursive: true })
  if ((await readdir(destDir)).length > 0) {
    throw new Error(
      `materializeWorkspace requires an empty destination: ${destDir}`,
    )
  }
  for (const entry of await walkTree(workspaceDir)) {
    const reserved = reservedSegment(entry.relativePath)
    if (reserved !== null) {
      throw new Error(
        `Workspace uses the reserved name ${reserved}: ${entry.relativePath}`,
      )
    }
    const target = path.join(destDir, entry.relativePath)
    if (entry.kind === "directory") {
      await mkdir(target, { recursive: true })
    } else {
      await copyFile(entry.absolutePath, target)
    }
  }
  for (const entry of await walkTree(destDir)) {
    if (reservedSegment(entry.relativePath) !== null) {
      throw new Error(
        `Hidden acceptance content leaked into the sandbox: ${entry.relativePath}`,
      )
    }
  }
}

/**
 * Stable sha256 fingerprint of a directory tree: relative paths plus file
 * bytes, walked in deterministic order. Two materializations of the same
 * task package version produce identical fingerprints, which is how reset
 * determinism is asserted.
 */
export async function workspaceFingerprint(dir: string): Promise<string> {
  const hash = createHash("sha256")
  for (const entry of await walkTree(path.resolve(dir))) {
    if (entry.kind === "directory") {
      hash.update(`D ${entry.relativePath}\n`)
    } else {
      const content = createHash("sha256")
        .update(await readFile(entry.absolutePath))
        .digest("hex")
      hash.update(`F ${entry.relativePath} ${content}\n`)
    }
  }
  return hash.digest("hex")
}

/**
 * Parse the single JSON summary line a grader prints to stdout. Returns a
 * validated {@link TaskGraderSummary} or issues describing the violation;
 * `summary` is non-null exactly when `issues` is empty.
 */
export function parseGraderSummary(text: string): {
  issues: string[]
  summary: TaskGraderSummary | null
} {
  const issues: string[] = []
  let parsed: unknown
  try {
    parsed = JSON.parse(text.trim())
  } catch {
    return { issues: ["Grader stdout must be one JSON object."], summary: null }
  }
  if (!isRecord(parsed)) {
    return { issues: ["Grader summary must be a JSON object."], summary: null }
  }
  issues.push(
    ...unexpectedKeyIssues(
      parsed,
      new Set(["functional", "regression", "scope", "notes"]),
      "grader summary",
    ),
  )
  for (const key of ["functional", "regression", "scope"] as const) {
    if (typeof parsed[key] !== "boolean") {
      issues.push(`Grader summary ${key} must be a boolean.`)
    }
  }
  let notes: string[] = []
  if (!Array.isArray(parsed.notes)) {
    issues.push("Grader summary notes must be a string list.")
  } else {
    notes = parsed.notes.filter(
      (entry): entry is string => typeof entry === "string",
    )
    if (notes.length !== parsed.notes.length) {
      issues.push("Grader summary notes must be a string list.")
    }
  }
  if (issues.length > 0) return { issues, summary: null }
  return {
    issues,
    summary: {
      functional: parsed.functional === true,
      notes,
      regression: parsed.regression === true,
      scope: parsed.scope === true,
    },
  }
}
