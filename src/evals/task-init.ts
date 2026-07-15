import { spawnSync } from "node:child_process"
import { createHash, randomUUID } from "node:crypto"
import {
  access,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import YAML from "yaml"

import { UserInputError } from "../repo-path.js"
import {
  HIDDEN_DIRECTORIES,
  loadTaskPackage,
  TASK_MANIFEST_FILENAME,
  TASK_PACKAGE_SCHEMA_VERSION,
  WORKSPACE_DIRECTORY,
} from "./task-package.js"

/**
 * Authoring toolkit that turns a source repo + accepted commit into a
 * task-package skeleton (see `src/evals/task-package.ts` for the contract).
 *
 * The workspace snapshot is the **parent** of the accepted commit, so the
 * evaluated agent starts from the pre-change tree and the accepted commit is
 * one valid answer. A fresh skeleton is deliberately incomplete: `task.yaml`
 * carries `TODO` markers, and `graders/grade.mjs` is a scaffold whose
 * functional/regression sections are stubbed. Everything else is filled so
 * `loadTaskPackage` reports exactly the expected `TODO`-class issues.
 */

/** Default output root. Under `.runtime/` so headline tasks stay private. */
export const DEFAULT_PRIVATE_TASKS_DIR = ".runtime/evals/private-tasks"

const KEBAB_CASE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

const DEFAULT_BUDGETS = {
  max_phases: 6,
  max_turns: 80,
  max_wall_ms: 1_800_000,
} as const

const DEFAULT_GRADER_TIMEOUT_MS = 60_000

const PLACEHOLDER_REQUEST =
  "TODO: describe, in one concise paragraph, the change the agent must make."

/**
 * The single schema issue a correctly generated skeleton is expected to
 * carry: `workflow_shape` is left as the sentinel `TODO`, which is not a
 * valid enum value. Any other `loadTaskPackage` issue is a generator bug.
 */
const EXPECTED_TODO_ISSUE_MATCHERS: readonly RegExp[] = [
  /^workflow_shape must be one of/,
]

export type TaskInitStatus =
  | "previewed"
  | "skeleton-written"
  | "invalid-skeleton"

export type TaskInitResult = {
  execute: boolean
  status: TaskInitStatus
  /** Absolute package directory (`<output>/<slug>`). */
  packageDir: string
  slug: string
  title: string
  /** Full SHA of the accepted commit. */
  acceptedCommit: string
  /** Full SHA of the parent commit (the workspace snapshot). */
  parentCommit: string
  /** Guessed `scope.allowed_paths`: files the accepted commit changed. */
  changedFiles: string[]
  /** Number of files in the parent snapshot. */
  workspaceFileCount: number
  /** Workspace-relative file that carries the canary comment. */
  canaryFile: string
  canary: string
  /** Package-relative entries the toolkit creates. */
  filesPlanned: string[]
  /** Non-fatal warnings (e.g. output points inside the tracked tree). */
  warnings: string[]
  /** Curated authoring TODOs, including grader work invisible to loadTaskPackage. */
  checklist: string[]
  /** Every issue `loadTaskPackage` reported (empty in preview). */
  schemaIssues: string[]
  /** Subset of `schemaIssues` that is unexpected (a generator bug). */
  hardIssues: string[]
}

export type InitTaskPackageOptions = {
  repoRoot: string
  cwd: string
  /** Path to the source git repository (relative to `cwd`, or absolute). */
  sourcePath: string
  /** The accepted-work commit; its parent becomes the workspace snapshot. */
  commit: string
  /** Kebab-case task slug; also the package directory name. */
  slug: string
  /** Output directory (relative to `repoRoot`, or absolute). */
  outputDir: string
  /** Developer-facing request; a placeholder is used when omitted. */
  request?: string
  execute: boolean
  /** Injectable clock for deterministic tests. Defaults to `new Date()`. */
  now?: Date
}

type CommentStyle = "hash" | "slashes" | "block" | "html" | "dashes"

const EXTENSION_STYLES: Record<string, CommentStyle> = {
  ".c": "slashes",
  ".cc": "slashes",
  ".cfg": "hash",
  ".cjs": "slashes",
  ".conf": "hash",
  ".cpp": "slashes",
  ".cts": "slashes",
  ".dart": "slashes",
  ".ex": "hash",
  ".exs": "hash",
  ".go": "slashes",
  ".h": "slashes",
  ".hpp": "slashes",
  ".htm": "html",
  ".html": "html",
  ".ini": "hash",
  ".java": "slashes",
  ".jl": "hash",
  ".js": "slashes",
  ".jsx": "slashes",
  ".kt": "slashes",
  ".kts": "slashes",
  ".less": "slashes",
  ".lua": "dashes",
  ".markdown": "html",
  ".md": "html",
  ".mjs": "slashes",
  ".mts": "slashes",
  ".php": "slashes",
  ".pl": "hash",
  ".py": "hash",
  ".r": "hash",
  ".rb": "hash",
  ".rs": "slashes",
  ".scala": "slashes",
  ".scss": "slashes",
  ".sh": "hash",
  ".sql": "dashes",
  ".svg": "html",
  ".swift": "slashes",
  ".toml": "hash",
  ".ts": "slashes",
  ".tsx": "slashes",
  ".vue": "html",
  ".xml": "html",
  ".yaml": "hash",
  ".yml": "hash",
  ".css": "block",
  ".bash": "hash",
  ".zsh": "hash",
}

const BASENAME_STYLES: Record<string, CommentStyle> = {
  ".env": "hash",
  ".gitignore": "hash",
  Dockerfile: "hash",
  Makefile: "hash",
}

function commentStyleFor(relPath: string): CommentStyle | null {
  const base = relPath.split("/").at(-1) ?? relPath
  if (base in BASENAME_STYLES) return BASENAME_STYLES[base] ?? null
  const dot = base.lastIndexOf(".")
  const ext = dot > 0 ? base.slice(dot).toLowerCase() : ""
  return EXTENSION_STYLES[ext] ?? null
}

function wrapCanaryComment(style: CommentStyle, text: string): string {
  switch (style) {
    case "hash":
      return `# ${text}`
    case "slashes":
      return `// ${text}`
    case "block":
      return `/* ${text} */`
    case "html":
      return `<!-- ${text} -->`
    case "dashes":
      return `-- ${text}`
  }
}

const REGEXP_SPECIAL = new Set([
  ".",
  "+",
  "?",
  "^",
  "$",
  "(",
  ")",
  "{",
  "}",
  "|",
  "[",
  "]",
  "\\",
])

/** Convert a workspace glob to an anchored RegExp (`*` within a segment, `**` across). */
function globToRegExp(glob: string): RegExp {
  const segments = glob.split("**").map((part) =>
    Array.from(part, (ch) => {
      if (ch === "*") return "[^/]*"
      return REGEXP_SPECIAL.has(ch) ? `\\${ch}` : ch
    }).join(""),
  )
  return new RegExp(`^${segments.join(".*")}$`)
}

function makeIsAllowed(globs: string[]): (relPath: string) => boolean {
  const matchers = globs.map(globToRegExp)
  return (relPath) => matchers.some((matcher) => matcher.test(relPath))
}

function pathSortKey(relPath: string): [number, string] {
  return [relPath.split("/").length, relPath]
}

function byShallowThenName(left: string, right: string): number {
  const [leftDepth, leftPath] = pathSortKey(left)
  const [rightDepth, rightPath] = pathSortKey(right)
  if (leftDepth !== rightDepth) return leftDepth - rightDepth
  return leftPath < rightPath ? -1 : leftPath > rightPath ? 1 : 0
}

/**
 * Deterministically pick the workspace file that will carry the canary: the
 * shallowest, lexicographically-first comment-friendly file the agent has no
 * reason to touch (i.e. outside `allowed_paths`), falling back to an
 * allowed-path file, then to `null` (meaning: create a dedicated file).
 */
function pickCanaryHost(
  relPaths: string[],
  allowedGlobs: string[],
): { relPath: string; style: CommentStyle } | null {
  const isAllowed = makeIsAllowed(allowedGlobs)
  const outside = relPaths
    .filter((entry) => !isAllowed(entry))
    .toSorted(byShallowThenName)
  const inside = relPaths
    .filter((entry) => isAllowed(entry))
    .toSorted(byShallowThenName)
  for (const group of [outside, inside]) {
    for (const relPath of group) {
      const style = commentStyleFor(relPath)
      if (style) return { relPath, style }
    }
  }
  return null
}

function git(
  source: string,
  args: string[],
): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync("git", ["-C", source, ...args], {
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  })
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  }
}

function gitOut(source: string, args: string[], context: string): string {
  const result = git(source, args)
  if (result.status !== 0) {
    throw new UserInputError(
      `${context}: ${result.stderr.trim() || "git command failed"}`,
    )
  }
  return result.stdout
}

/** Non-empty, deduplicated, sorted lines. */
function nonEmptyLines(text: string): string[] {
  return [
    ...new Set(
      text
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line !== ""),
    ),
  ].toSorted()
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await access(target)
    return true
  } catch {
    return false
  }
}

/** Sorted, POSIX-relative regular-file paths under `root`. */
async function walkWorkspace(root: string, prefix = ""): Promise<string[]> {
  const files: string[] = []
  const dirents = await readdir(
    prefix === "" ? root : path.join(root, prefix),
    {
      withFileTypes: true,
    },
  )
  dirents.sort((left, right) => (left.name < right.name ? -1 : 1))
  for (const dirent of dirents) {
    const relPath = prefix === "" ? dirent.name : `${prefix}/${dirent.name}`
    if (dirent.isDirectory()) {
      files.push(...(await walkWorkspace(root, relPath)))
    } else if (dirent.isFile()) {
      files.push(relPath)
    }
  }
  return files
}

function isInsideTrackedTree(repoRoot: string, targetAbs: string): boolean {
  const relative = path.relative(repoRoot, targetAbs)
  const inside =
    relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative)
  if (!inside) return false
  // `check-ignore -q` exits 0 when the path is git-ignored (safe), 1 when it
  // is not (i.e. it would land in the tracked tree), 128 when repoRoot has no
  // git. Only a definitive "not ignored" is worth warning about.
  const result = git(repoRoot, ["check-ignore", "-q", "--", targetAbs])
  return result.status === 1
}

function buildContaminationNotes(params: {
  sourcePath: string
  acceptedCommit: string
  parentCommit: string
  canaryFile: string
  date: string
}): string {
  return [
    "Reconstructed for LoopBench from a private source repository.",
    `Source: ${params.sourcePath}`,
    `Accepted commit: ${params.acceptedCommit}`,
    `Workspace snapshot: parent ${params.parentCommit}`,
    `Generated: ${params.date}`,
    "The source is private with no public mirror and its history postdates",
    "the model training cutoff, so current-model contamination is negligible.",
    "Treat any score as calibration until independently verified.",
    `Canary embedded as a comment in workspace/${params.canaryFile}.`,
  ].join("\n")
}

function setTrailingComment(
  doc: YAML.Document,
  key: string,
  text: string,
): void {
  const node = doc.get(key, true)
  if (YAML.isNode(node)) node.comment = text
}

function setCommentBeforeKey(
  container: unknown,
  key: string,
  text: string,
): void {
  if (!YAML.isMap(container)) return
  const pair = container.items.find(
    (item) => YAML.isScalar(item.key) && item.key.value === key,
  )
  if (pair && YAML.isNode(pair.key)) pair.key.commentBefore = text
}

function buildManifestYaml(params: {
  slug: string
  title: string
  request: string
  requestIsPlaceholder: boolean
  allowedPaths: string[]
  contaminationNotes: string
  canary: string
}): string {
  const doc = new YAML.Document({
    schema_version: TASK_PACKAGE_SCHEMA_VERSION,
    id: params.slug,
    version: 1,
    title: params.title,
    request: params.request,
    setup_command: null,
    tool_policy: { network: "deny" },
    budgets: {
      max_wall_ms: DEFAULT_BUDGETS.max_wall_ms,
      max_phases: DEFAULT_BUDGETS.max_phases,
      max_turns: DEFAULT_BUDGETS.max_turns,
    },
    workflow_shape: "TODO",
    expected_stratum: null,
    scope: { allowed_paths: params.allowedPaths, forbidden_paths: [] },
    provenance: {
      source: "private",
      contamination_notes: params.contaminationNotes,
      canary: params.canary,
    },
    grader: {
      command: ["graders/grade.mjs"],
      timeout_ms: DEFAULT_GRADER_TIMEOUT_MS,
    },
  })

  if (params.requestIsPlaceholder) {
    setTrailingComment(
      doc,
      "request",
      " TODO: replace this placeholder with the developer-facing prompt",
    )
  }
  setTrailingComment(
    doc,
    "setup_command",
    " TODO: null, or a sandbox setup command (e.g. bun install --frozen-lockfile)",
  )
  setTrailingComment(
    doc,
    "workflow_shape",
    " TODO: choose skip | exec-plan | program (sentinel fails validation)",
  )
  setTrailingComment(doc, "expected_stratum", " leave null until calibrated")
  setCommentBeforeKey(
    doc.contents,
    "budgets",
    " TODO: tune these episode ceilings for the task",
  )
  const scopeNode = doc.get("scope", true)
  setCommentBeforeKey(
    scopeNode,
    "allowed_paths",
    " TODO: confirm/trim these guessed paths; populate forbidden_paths",
  )
  setCommentBeforeKey(
    doc.contents,
    "provenance",
    " Private headline task — never commit under a tracked path (Decision D5)",
  )

  return String(doc)
}

// ── grader scaffold ────────────────────────────────────────────────────────
// The scope machinery is copied verbatim (behaviorally) from the smoke-task
// graders: git-diff against the baseline commit, degrading to sha256 content
// baselines when the sandbox is not a git repo. Kept free of `${` and
// backticks so it can be embedded as a String.raw body below.

const GRADER_BODY = String.raw`
const notes = []

function describe(error) {
  const text = error instanceof Error ? error.message : String(error)
  return text.split("\n")[0]
}

async function passes(component, name, run) {
  try {
    await run()
    return true
  } catch (error) {
    notes.push(component + ": " + name + ": " + describe(error))
    return false
  }
}

const REGEXP_SPECIAL = new Set([
  ".", "+", "?", "^", "$", "(", ")", "{", "}", "|", "[", "]", "\\",
])

function globToRegExp(glob) {
  const segments = glob.split("**").map((part) =>
    Array.from(part, (ch) =>
      ch === "*" ? "[^/]*" : REGEXP_SPECIAL.has(ch) ? "\\" + ch : ch,
    ).join(""),
  )
  return new RegExp("^" + segments.join(".*") + "$")
}

const ALLOWED_MATCHERS = ALLOWED_GLOBS.map(globToRegExp)

function isAllowedPath(relativePath) {
  return ALLOWED_MATCHERS.some((matcher) => matcher.test(relativePath))
}

function runGit(sandboxDir, args) {
  const result = spawnSync("git", ["-C", sandboxDir, ...args], {
    encoding: "utf8",
  })
  return result.status === 0 ? result.stdout : null
}

// Changed paths since the runner's baseline commit, or null when the sandbox
// itself is not a usable git repository.
function gitChangedPaths(sandboxDir) {
  const inside = runGit(sandboxDir, ["rev-parse", "--is-inside-work-tree"])
  if (inside === null || inside.trim() !== "true") return null
  const top = runGit(sandboxDir, ["rev-parse", "--show-toplevel"])
  if (top === null) return null
  let sandboxReal = path.resolve(sandboxDir)
  try {
    sandboxReal = realpathSync(sandboxDir)
  } catch {
    return null
  }
  if (path.resolve(top.trim()) !== sandboxReal) return null
  const roots = runGit(sandboxDir, ["rev-list", "--max-parents=0", "HEAD"])
  if (roots === null) return null
  const rootCommit = roots.trim().split("\n")[0]
  const committed = runGit(sandboxDir, [
    "diff",
    "--name-only",
    rootCommit,
    "HEAD",
  ])
  const status = runGit(sandboxDir, ["status", "--porcelain"])
  if (committed === null || status === null) return null
  const changed = new Set()
  for (const line of committed.split("\n")) {
    if (line.trim() !== "") changed.add(line.trim())
  }
  for (const line of status.split("\n")) {
    if (line.trim() === "") continue
    const entry = line.slice(3)
    const target = entry.includes(" -> ") ? entry.split(" -> ")[1] : entry
    changed.add(target.replace(/^"|"$/g, ""))
  }
  return [...changed].sort()
}

async function walkFiles(root, prefix = "") {
  const files = []
  const dirents = await readdir(
    prefix === "" ? root : path.join(root, prefix),
    { withFileTypes: true },
  )
  dirents.sort((left, right) => (left.name < right.name ? -1 : 1))
  for (const dirent of dirents) {
    if (dirent.name === ".git") continue
    const relativePath =
      prefix === "" ? dirent.name : prefix + "/" + dirent.name
    if (dirent.isDirectory()) {
      files.push(...(await walkFiles(root, relativePath)))
    } else {
      files.push(relativePath)
    }
  }
  return files
}

async function scopeViolations(sandboxDir) {
  const changed = gitChangedPaths(sandboxDir)
  if (changed !== null) {
    notes.push("scope: checked with git diff against the baseline commit")
    return changed.filter((entry) => !isAllowedPath(entry))
  }
  notes.push("scope: git unavailable; compared file contents to baselines")
  const violations = []
  const files = await walkFiles(sandboxDir)
  for (const relativePath of files) {
    if (isAllowedPath(relativePath)) continue
    const expected = BASELINE_HASHES[relativePath]
    if (expected === undefined) {
      violations.push("unexpected new file: " + relativePath)
      continue
    }
    const digest = createHash("sha256")
      .update(await readFile(path.join(sandboxDir, relativePath)))
      .digest("hex")
    if (digest !== expected) violations.push("modified: " + relativePath)
  }
  for (const relativePath of Object.keys(BASELINE_HASHES)) {
    if (!files.includes(relativePath)) {
      violations.push("deleted: " + relativePath)
    }
  }
  return violations
}

async function grade(sandboxDir) {
  // ── functional ───────────────────────────────────────────────────────
  // TODO(author): assert the requested behavior. Import the module under
  // test from the sandbox, e.g.
  //   const { pathToFileURL } = await import("node:url")
  //   const target = path.resolve(sandboxDir, "<entry>")
  //   const mod = await import(pathToFileURL(target).href)
  // or drive an injectable seam. Accept ANY correct implementation, never a
  // single blessed diff, and add stricter hidden cases than the visible
  // tests. Leave this false until implemented so nothing grades green by
  // accident, and confirm it fails the pristine workspace and a naive fix.
  let functional = false
  notes.push("functional: TODO — hidden acceptance not implemented yet")

  // ── regression ───────────────────────────────────────────────────────
  // TODO(author): assert pre-existing behavior is intact (existing flags,
  // outputs, exit codes, adjacent modules the change must not break).
  let regression = false
  notes.push("regression: TODO — regression checks not implemented yet")

  // ── scope (working) ──────────────────────────────────────────────────
  let scope = true
  scope &&= await passes("scope", "only allowed files changed", async () => {
    const violations = await scopeViolations(sandboxDir)
    assert.deepEqual(violations, [])
  })

  return { functional, regression, scope }
}

const sandboxDir = process.argv[2]
let result = { functional: false, regression: false, scope: false }
if (sandboxDir === undefined) {
  notes.push("usage: node graders/grade.mjs <sandboxDir>")
} else {
  result = await grade(sandboxDir)
}

console.log(JSON.stringify({ ...result, notes }))
process.exitCode =
  result.functional && result.regression && result.scope ? 0 : 1
`

function graderScaffold(
  slug: string,
  allowedGlobs: string[],
  baseline: Record<string, string>,
): string {
  const header = [
    "#!/usr/bin/env node",
    `// Hidden grader SCAFFOLD for ${slug}.`,
    "// Generated by `evals task-init`. Implement the functional and",
    "// regression TODO sections in grade(); the scope check already works.",
    "// Contract: print one JSON line {functional, regression, scope, notes}",
    "// to stdout and exit 0 only when every component passes.",
    "// Usage: node graders/grade.mjs <sandboxDir>",
    'import assert from "node:assert/strict"',
    'import { spawnSync } from "node:child_process"',
    'import { createHash } from "node:crypto"',
    'import { realpathSync } from "node:fs"',
    'import { readdir, readFile } from "node:fs/promises"',
    'import path from "node:path"',
    "",
    "// Workspace-relative globs the agent MAY modify (mirror scope.allowed_paths).",
    `const ALLOWED_GLOBS = ${JSON.stringify(allowedGlobs, null, 2)}`,
    "",
    "// sha256 of every workspace file OUTSIDE the allowed globs, for the",
    "// no-git fallback. Regenerate these if you change the workspace.",
    `const BASELINE_HASHES = ${JSON.stringify(baseline, null, 2)}`,
  ].join("\n")
  return `${header}\n${GRADER_BODY}`
}

function buildChecklist(params: {
  requestIsPlaceholder: boolean
  changedCount: number
  workspaceFileCount: number
}): string[] {
  const items = [
    "workflow_shape: choose skip | exec-plan | program (currently TODO — fails schema)",
    "graders/grade.mjs: implement the functional acceptance (hidden; accept any correct impl)",
    "graders/grade.mjs: implement the regression checks",
  ]
  if (params.requestIsPlaceholder) {
    items.push(
      "request: replace the placeholder with the developer-facing prompt",
    )
  }
  items.push(
    `workspace/: trim the ${params.workspaceFileCount}-file snapshot to the minimal deterministic slice`,
    `scope.allowed_paths: confirm/trim the ${params.changedCount} guessed path(s); add forbidden_paths`,
    "setup_command: decide null or a real sandbox setup command",
    "budgets: tune max_wall_ms / max_phases / max_turns",
    "expected_stratum: leave null until calibrated against model tiers",
    "provenance.contamination_notes: review the prefilled provenance",
    "verify: grader fails the pristine workspace and a naive fix, and passes 2+ distinct correct fixes",
  )
  return items
}

function buildReferenceNotes(params: {
  slug: string
  title: string
  sourcePath: string
  acceptedCommit: string
  parentCommit: string
  canaryFile: string
  canary: string
  date: string
  message: string
  diffstat: string
  changedFiles: string[]
  checklist: string[]
}): string {
  const lines = [
    `# ${params.slug} authoring notes (hidden — never shipped to a sandbox)`,
    "",
    `Generated by \`evals task-init\` on ${params.date}.`,
    "",
    "## Provenance",
    "",
    `- Source repository: ${params.sourcePath}`,
    `- Accepted commit: ${params.acceptedCommit} — ${params.title}`,
    `- Workspace snapshot: parent ${params.parentCommit}`,
    `- Canary GUID \`${params.canary}\` embedded as a comment in \`workspace/${params.canaryFile}\`.`,
    "",
    "## Accepted commit message",
    "",
    "```",
    params.message.trimEnd(),
    "```",
    "",
    "## Diffstat (parent -> accepted)",
    "",
    "```",
    params.diffstat.trimEnd(),
    "```",
    "",
    "## Changed files (guessed allowed_paths)",
    "",
    ...params.changedFiles.map((file) => `- ${file}`),
    "",
    "## Authoring checklist",
    "",
    ...params.checklist.map((item) => `- [ ] ${item}`),
    "",
  ]
  return lines.join("\n")
}

/**
 * Generate (preview) or write (`execute`) a task-package skeleton from a
 * source repo + accepted commit. Read-only in preview: it resolves commits,
 * changed files, and the snapshot file list via git without extracting or
 * writing anything.
 */
export async function initTaskPackage(
  options: InitTaskPackageOptions,
): Promise<TaskInitResult> {
  const { slug } = options
  if (!KEBAB_CASE.test(slug)) {
    throw new UserInputError("--slug must be a lowercase kebab-case value.")
  }

  const sourceAbs = path.resolve(options.cwd, options.sourcePath)
  const worktree = git(sourceAbs, ["rev-parse", "--is-inside-work-tree"])
  if (worktree.status !== 0 || worktree.stdout.trim() !== "true") {
    throw new UserInputError(
      `--source is not a git repository: ${options.sourcePath}`,
    )
  }

  const acceptedCommit = gitOut(
    sourceAbs,
    ["rev-parse", "--verify", `${options.commit}^{commit}`],
    "resolve --commit",
  ).trim()
  const parentProbe = git(sourceAbs, [
    "rev-parse",
    "--verify",
    `${acceptedCommit}^`,
  ])
  if (parentProbe.status !== 0) {
    throw new UserInputError(
      `commit ${options.commit} has no parent; cannot snapshot a pre-change workspace.`,
    )
  }
  const parentCommit = parentProbe.stdout.trim()

  const changedFiles = nonEmptyLines(
    gitOut(
      sourceAbs,
      [
        "-c",
        "core.quotePath=false",
        "diff",
        "--name-only",
        parentCommit,
        acceptedCommit,
      ],
      "list changed files",
    ),
  )
  if (changedFiles.length === 0) {
    throw new UserInputError(
      `commit ${options.commit} changes no files against its parent.`,
    )
  }

  const title =
    gitOut(
      sourceAbs,
      ["log", "-1", "--format=%s", acceptedCommit],
      "read commit subject",
    ).trim() || slug
  const message = gitOut(
    sourceAbs,
    ["log", "-1", "--format=%B", acceptedCommit],
    "read commit message",
  )
  const diffstat = gitOut(
    sourceAbs,
    [
      "-c",
      "core.quotePath=false",
      "diff",
      "--stat",
      parentCommit,
      acceptedCommit,
    ],
    "read diffstat",
  )
  const snapshotFiles = nonEmptyLines(
    gitOut(
      sourceAbs,
      [
        "-c",
        "core.quotePath=false",
        "ls-tree",
        "-r",
        "--name-only",
        parentCommit,
      ],
      "list snapshot files",
    ),
  )

  const outputAbs = path.isAbsolute(options.outputDir)
    ? options.outputDir
    : path.resolve(options.repoRoot, options.outputDir)
  const packageDir = path.join(outputAbs, slug)

  const warnings: string[] = []
  if (isInsideTrackedTree(options.repoRoot, packageDir)) {
    warnings.push(
      `--output points inside the repository's tracked tree (${packageDir}). ` +
        "Headline tasks are PRIVATE and must never be committed (Decision D5). " +
        `Use the default ${DEFAULT_PRIVATE_TASKS_DIR} or another git-ignored location.`,
    )
  }

  const request = options.request?.trim()
    ? options.request.trim()
    : PLACEHOLDER_REQUEST
  const requestIsPlaceholder = request === PLACEHOLDER_REQUEST
  const canary = randomUUID()
  const now = options.now ?? new Date()
  const date = now.toISOString().slice(0, 10)

  const predictedHost = pickCanaryHost(snapshotFiles, changedFiles)
  const predictedCanaryFile = predictedHost?.relPath ?? "CANARY"

  const checklist = buildChecklist({
    changedCount: changedFiles.length,
    requestIsPlaceholder,
    workspaceFileCount: snapshotFiles.length,
  })

  const filesPlanned = [
    TASK_MANIFEST_FILENAME,
    `${WORKSPACE_DIRECTORY}/ (${snapshotFiles.length} file(s))`,
    `${HIDDEN_DIRECTORIES[0]}/grade.mjs`,
    `${HIDDEN_DIRECTORIES[1]}/notes.md`,
  ]

  const baseResult: TaskInitResult = {
    acceptedCommit,
    canary,
    canaryFile: predictedCanaryFile,
    changedFiles,
    checklist,
    execute: options.execute,
    filesPlanned,
    hardIssues: [],
    packageDir,
    parentCommit,
    schemaIssues: [],
    slug,
    status: "previewed",
    title,
    warnings,
    workspaceFileCount: snapshotFiles.length,
  }

  if (!options.execute) return baseResult

  if (await pathExists(packageDir)) {
    throw new UserInputError(
      `refusing to overwrite an existing path: ${packageDir}`,
    )
  }

  const workspaceDir = path.join(packageDir, WORKSPACE_DIRECTORY)
  const gradersDir = path.join(packageDir, HIDDEN_DIRECTORIES[0])
  const referenceDir = path.join(packageDir, HIDDEN_DIRECTORIES[1])
  await mkdir(workspaceDir, { recursive: true })
  await mkdir(gradersDir, { recursive: true })
  await mkdir(referenceDir, { recursive: true })

  // Extract the parent snapshot via `git archive` (never includes .git or history).
  const tarDir = await mkdtemp(path.join(tmpdir(), "task-init-"))
  try {
    const tarPath = path.join(tarDir, "workspace.tar")
    gitOut(
      sourceAbs,
      ["archive", "--format=tar", "-o", tarPath, parentCommit],
      "archive parent snapshot",
    )
    const extract = spawnSync("tar", ["-xf", tarPath, "-C", workspaceDir], {
      encoding: "utf8",
    })
    if (extract.status !== 0) {
      throw new Error(
        `tar extraction failed: ${extract.stderr.trim() || "unknown error"}`,
      )
    }
  } finally {
    await rm(tarDir, { force: true, recursive: true })
  }

  if (await pathExists(path.join(workspaceDir, ".git"))) {
    throw new Error("workspace snapshot unexpectedly contains a .git entry.")
  }

  // Inject the canary into the chosen file (recomputed from the real tree).
  const workspaceFiles = await walkWorkspace(workspaceDir)
  const host = pickCanaryHost(workspaceFiles, changedFiles)
  const canaryText = `provenance-canary: ${canary}`
  let canaryFile: string
  if (host === null) {
    canaryFile = "CANARY"
    await writeFile(
      path.join(workspaceDir, canaryFile),
      `${canaryText}\n`,
      "utf8",
    )
  } else {
    canaryFile = host.relPath
    const hostAbs = path.join(workspaceDir, canaryFile)
    let content = await readFile(hostAbs, "utf8")
    if (content.length > 0 && !content.endsWith("\n")) content += "\n"
    content += `${wrapCanaryComment(host.style, canaryText)}\n`
    await writeFile(hostAbs, content, "utf8")
  }

  // Baseline hashes must be computed AFTER injection so the canary host (a
  // non-allowed file) hashes to its on-disk, canary-bearing content.
  const isAllowed = makeIsAllowed(changedFiles)
  const baseline: Record<string, string> = {}
  for (const relPath of await walkWorkspace(workspaceDir)) {
    if (isAllowed(relPath)) continue
    baseline[relPath] = createHash("sha256")
      .update(await readFile(path.join(workspaceDir, relPath)))
      .digest("hex")
  }

  const contaminationNotes = buildContaminationNotes({
    acceptedCommit,
    canaryFile,
    date,
    parentCommit,
    sourcePath: options.sourcePath,
  })

  await writeFile(
    path.join(gradersDir, "grade.mjs"),
    graderScaffold(slug, changedFiles, baseline),
    "utf8",
  )
  await writeFile(
    path.join(referenceDir, "notes.md"),
    buildReferenceNotes({
      acceptedCommit,
      canary,
      canaryFile,
      changedFiles,
      checklist,
      date,
      diffstat,
      message,
      parentCommit,
      slug,
      sourcePath: options.sourcePath,
      title,
    }),
    "utf8",
  )
  await writeFile(
    path.join(packageDir, TASK_MANIFEST_FILENAME),
    buildManifestYaml({
      allowedPaths: changedFiles,
      canary,
      contaminationNotes,
      request,
      requestIsPlaceholder,
      slug,
      title,
    }),
    "utf8",
  )

  const loaded = await loadTaskPackage(packageDir)
  const schemaIssues = loaded.issues
  const hardIssues = schemaIssues.filter(
    (issue) =>
      !EXPECTED_TODO_ISSUE_MATCHERS.some((matcher) => matcher.test(issue)),
  )

  return {
    ...baseResult,
    canaryFile,
    hardIssues,
    schemaIssues,
    status: hardIssues.length > 0 ? "invalid-skeleton" : "skeleton-written",
    workspaceFileCount: workspaceFiles.length,
  }
}

export const TASK_INIT_HELP = `evals task-init

Scaffold a private task-package skeleton from a source repo + accepted commit.

Usage:
  programmers-loop evals task-init --source <repo> --commit <sha> --slug <slug> [--output <dir>] [--request <text>] [--execute] [--json]

The workspace snapshot is the PARENT of --commit, so the evaluated agent starts
from the pre-change tree and the accepted commit is one valid answer. Preview is
the default; --execute writes the package. The default --output is
${DEFAULT_PRIVATE_TASKS_DIR} (git-ignored); a loud warning fires if --output
points inside the repository's tracked tree (headline tasks stay private,
Decision D5).

A fresh skeleton is intentionally incomplete: task.yaml carries TODO markers and
graders/grade.mjs stubs its functional/regression sections. The command prints an
authoring checklist and the loadTaskPackage validation issues; exit 0 means the
skeleton was written with only expected TODOs, exit 1 means an unexpected
(generator-bug) issue, exit 2 is a usage error.
`
