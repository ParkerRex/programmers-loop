import { access, lstat, readFile } from "node:fs/promises"
import path from "node:path"

import YAML from "yaml"

import {
  parseMarkdownFrontmatter,
  validateMarkdownDocument,
} from "../markdown/frontmatter.js"
import { validateAllowedKeys } from "./shared.js"
import { issue, type LintIssue } from "./types.js"

const ASSIGNMENT_PATH_PATTERN =
  /^docs\/assignments\/(active|completed)\/((?:\d{4}-\d{2}-\d{2}|YYYY-MM-DD)-([a-z0-9]+(?:-[a-z0-9]+)*))$/

const ALLOWED_STATUSES = new Set([
  "draft",
  "active",
  "ready",
  "in_progress",
  "blocked",
  "needs_owner",
  "review",
  "complete",
  "completed",
  "archived",
])

const LIFECYCLE_STATES = [
  "not_applicable",
  "missing",
  "ready",
  "in_progress",
  "blocked",
  "needs_owner",
  "complete",
] as const

const LIFECYCLE_SEGMENTS = [
  "research",
  "architecture",
  "ux",
  "ui",
  "program",
  "execplans",
  "unlocks",
  "proof",
  "review",
  "receipts",
] as const

const CLOSEOUT_SEGMENTS = [
  "execplans",
  "unlocks",
  "proof",
  "review",
  "receipts",
]
const READY_STATES = new Set(["complete", "not_applicable"])
const ALLOWED_METADATA_KEYS = new Set([
  "schema_version",
  "assignment_id",
  "assignment_slug",
  "title",
  "status",
  "root_path",
  "owner_role",
  "support_roles",
  "customer_job",
  "primary_surface",
  "validation",
  "extensions",
  "local_mirror",
  "lifecycle",
  "derived_segments",
])
const ALLOWED_LIFECYCLE_KEYS = new Set(["states", "order", "segments"])
const ALLOWED_SEGMENT_KEYS = new Set([
  "state",
  "artifact",
  "artifacts",
  "blocked_by",
  "complete_when",
  "not_applicable_reason",
])

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath)
    return true
  } catch {
    return false
  }
}

async function isRegularFile(filePath: string): Promise<boolean> {
  try {
    return (await lstat(filePath)).isFile()
  } catch {
    return false
  }
}

function stringField(
  record: Record<string, unknown>,
  name: string,
  issues: LintIssue[],
  metadataPath: string,
): string | null {
  const value = record[name]
  if (typeof value !== "string" || value.trim() === "") {
    issues.push(issue(metadataPath, `${name} must be a non-empty string.`))
    return null
  }
  return value
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function stringArray(value: unknown): string[] | null {
  return Array.isArray(value) &&
    value.every((entry) => typeof entry === "string" && entry.trim() !== "")
    ? value
    : null
}

function exactArray(value: unknown, expected: readonly string[]): boolean {
  const actual = stringArray(value)
  return (
    actual !== null &&
    actual.length === expected.length &&
    actual.every((entry, index) => entry === expected[index])
  )
}

function safeAssignmentArtifact(value: string): boolean {
  return (
    !path.isAbsolute(value) &&
    !path.win32.isAbsolute(value) &&
    !value.includes("\\") &&
    path.posix.normalize(value) === value &&
    !value
      .split("/")
      .some((segment) => segment === "" || segment === "." || segment === "..")
  )
}

async function validateLifecycle(params: {
  assignmentRoot: string
  issues: LintIssue[]
  metadata: Record<string, unknown>
  metadataPath: string
  status: string | null
}): Promise<void> {
  const lifecycle = params.metadata.lifecycle
  if (!isRecord(lifecycle)) {
    params.issues.push(
      issue(params.metadataPath, "lifecycle must be a YAML object."),
    )
    return
  }
  for (const message of validateAllowedKeys(
    lifecycle,
    ALLOWED_LIFECYCLE_KEYS,
  )) {
    params.issues.push(issue(params.metadataPath, message))
  }
  if (!exactArray(lifecycle.states, LIFECYCLE_STATES)) {
    params.issues.push(
      issue(
        params.metadataPath,
        `lifecycle.states must equal: ${LIFECYCLE_STATES.join(", ")}.`,
      ),
    )
  }
  if (!exactArray(lifecycle.order, LIFECYCLE_SEGMENTS)) {
    params.issues.push(
      issue(
        params.metadataPath,
        `lifecycle.order must equal: ${LIFECYCLE_SEGMENTS.join(", ")}.`,
      ),
    )
  }

  const segments = lifecycle.segments
  if (!isRecord(segments)) {
    params.issues.push(
      issue(params.metadataPath, "lifecycle.segments must be a YAML object."),
    )
    return
  }
  const states = new Map<string, string>()
  const dependencies = new Map<string, string[]>()
  for (const segmentId of LIFECYCLE_SEGMENTS) {
    const segment = segments[segmentId]
    if (!isRecord(segment)) {
      params.issues.push(
        issue(
          params.metadataPath,
          `lifecycle.segments.${segmentId} must be a YAML object.`,
        ),
      )
      continue
    }
    for (const message of validateAllowedKeys(segment, ALLOWED_SEGMENT_KEYS)) {
      params.issues.push(issue(params.metadataPath, `${segmentId}: ${message}`))
    }
    const state = segment.state
    if (
      typeof state !== "string" ||
      !(LIFECYCLE_STATES as readonly string[]).includes(state)
    ) {
      params.issues.push(
        issue(
          params.metadataPath,
          `lifecycle.segments.${segmentId}.state is invalid.`,
        ),
      )
      continue
    }
    states.set(segmentId, state)
    const blockedBy = stringArray(segment.blocked_by)
    if (blockedBy === null) {
      params.issues.push(
        issue(
          params.metadataPath,
          `lifecycle.segments.${segmentId}.blocked_by must be a string list.`,
        ),
      )
    } else {
      dependencies.set(segmentId, blockedBy)
      if (new Set(blockedBy).size !== blockedBy.length) {
        params.issues.push(
          issue(
            params.metadataPath,
            `lifecycle.segments.${segmentId}.blocked_by must not contain duplicates.`,
          ),
        )
      }
      for (const dependency of blockedBy) {
        if (!(LIFECYCLE_SEGMENTS as readonly string[]).includes(dependency)) {
          params.issues.push(
            issue(
              params.metadataPath,
              `lifecycle.segments.${segmentId}.blocked_by names unknown segment ${dependency}.`,
            ),
          )
        }
        if (dependency === segmentId) {
          params.issues.push(
            issue(
              params.metadataPath,
              `lifecycle.segments.${segmentId} must not block itself.`,
            ),
          )
        }
      }
    }
    const completeWhen =
      segment.complete_when === undefined
        ? undefined
        : stringArray(segment.complete_when)
    if (
      completeWhen !== undefined &&
      (!completeWhen || completeWhen.length === 0)
    ) {
      params.issues.push(
        issue(
          params.metadataPath,
          `lifecycle.segments.${segmentId}.complete_when must be a non-empty string list.`,
        ),
      )
    }
    if (
      state === "not_applicable" &&
      (typeof segment.not_applicable_reason !== "string" ||
        segment.not_applicable_reason.trim() === "")
    ) {
      params.issues.push(
        issue(
          params.metadataPath,
          `lifecycle.segments.${segmentId}.not_applicable_reason is required.`,
        ),
      )
    }
    const artifacts = [
      ...(typeof segment.artifact === "string" ? [segment.artifact] : []),
      ...(stringArray(segment.artifacts) ?? []),
    ]
    if (
      segment.artifact !== undefined &&
      (typeof segment.artifact !== "string" || segment.artifact.trim() === "")
    ) {
      params.issues.push(
        issue(
          params.metadataPath,
          `lifecycle.segments.${segmentId}.artifact must be a non-empty string.`,
        ),
      )
    }
    if (
      segment.artifacts !== undefined &&
      stringArray(segment.artifacts) === null
    ) {
      params.issues.push(
        issue(
          params.metadataPath,
          `lifecycle.segments.${segmentId}.artifacts must be a string list.`,
        ),
      )
    }
    if (artifacts.length === 0) {
      params.issues.push(
        issue(
          params.metadataPath,
          `lifecycle.segments.${segmentId} must name artifact or artifacts.`,
        ),
      )
    }
    for (const artifact of artifacts) {
      if (!safeAssignmentArtifact(artifact)) {
        params.issues.push(
          issue(
            params.metadataPath,
            `lifecycle.segments.${segmentId} artifact must stay inside the Assignment: ${artifact}.`,
          ),
        )
      } else if (
        new Set(["ready", "in_progress", "complete"]).has(state) &&
        !(await exists(path.join(params.assignmentRoot, artifact)))
      ) {
        params.issues.push(
          issue(
            params.metadataPath,
            `lifecycle.segments.${segmentId} references missing artifact ${artifact}.`,
          ),
        )
      }
    }
  }
  for (const segmentId of Object.keys(segments)) {
    if (!(LIFECYCLE_SEGMENTS as readonly string[]).includes(segmentId)) {
      params.issues.push(
        issue(
          params.metadataPath,
          `Unexpected lifecycle segment: ${segmentId}.`,
        ),
      )
    }
  }

  for (const [segmentId, blockedBy] of dependencies) {
    const state = states.get(segmentId)
    if (!state || !new Set(["ready", "in_progress", "complete"]).has(state)) {
      continue
    }
    for (const dependency of blockedBy) {
      if (!READY_STATES.has(states.get(dependency) ?? "")) {
        params.issues.push(
          issue(
            params.metadataPath,
            `${segmentId} cannot be ${state} until ${dependency} is complete or not_applicable.`,
          ),
        )
      }
    }
  }

  const visiting = new Set<string>()
  const visited = new Set<string>()
  function visit(segmentId: string): boolean {
    if (visiting.has(segmentId)) return true
    if (visited.has(segmentId)) return false
    visiting.add(segmentId)
    for (const dependency of dependencies.get(segmentId) ?? []) {
      if (visit(dependency)) return true
    }
    visiting.delete(segmentId)
    visited.add(segmentId)
    return false
  }
  for (const segmentId of LIFECYCLE_SEGMENTS) {
    if (visit(segmentId)) {
      params.issues.push(
        issue(params.metadataPath, "lifecycle dependencies must be acyclic."),
      )
      break
    }
  }

  const derived = params.metadata.derived_segments
  if (!isRecord(derived)) {
    params.issues.push(
      issue(params.metadataPath, "derived_segments must be a YAML object."),
    )
  } else {
    for (const [name, expected] of [
      ["design", ["architecture", "ux", "ui"]],
      ["plan", ["execplans"]],
    ] as const) {
      const definition = derived[name]
      if (
        !isRecord(definition) ||
        !exactArray(definition.derives_from, expected)
      ) {
        params.issues.push(
          issue(
            params.metadataPath,
            `derived_segments.${name}.derives_from must equal: ${expected.join(", ")}.`,
          ),
        )
      }
    }
    for (const name of Object.keys(derived)) {
      if (name !== "design" && name !== "plan") {
        params.issues.push(
          issue(params.metadataPath, `Unexpected derived segment: ${name}.`),
        )
      }
    }
  }

  if (params.status && new Set(["complete", "completed"]).has(params.status)) {
    for (const segmentId of CLOSEOUT_SEGMENTS) {
      if (!READY_STATES.has(states.get(segmentId) ?? "")) {
        params.issues.push(
          issue(
            params.metadataPath,
            `Completed Assignments require ${segmentId} to be complete or not_applicable.`,
          ),
        )
      }
    }
  }
}

export async function lintAssignment(params: {
  assignmentRoot: string
  repoRoot: string
}): Promise<LintIssue[]> {
  const issues: LintIssue[] = []
  const relativeRoot = path
    .relative(params.repoRoot, params.assignmentRoot)
    .split(path.sep)
    .join("/")
  const pathMatch = relativeRoot.match(ASSIGNMENT_PATH_PATTERN)
  if (!pathMatch) {
    issues.push(
      issue(
        relativeRoot,
        "Assignment path must match docs/assignments/(active|completed)/YYYY-MM-DD-assignment-slug.",
      ),
    )
  }

  const readmePath = path.join(params.assignmentRoot, "README.md")
  const metadataPath = path.join(params.assignmentRoot, "assignment.yaml")
  const relativeMetadataPath = `${relativeRoot}/assignment.yaml`

  if (!(await isRegularFile(readmePath))) {
    issues.push(issue(relativeRoot, "Missing regular README.md file."))
  } else {
    const parsed = parseMarkdownFrontmatter(await readFile(readmePath, "utf8"))
    for (const message of [
      ...parsed.issues,
      ...validateMarkdownDocument({
        body: parsed.body,
        metadata: parsed.metadata,
        requiredKeys: ["title", "summary", "status", "read_when"],
      }),
    ]) {
      issues.push(issue(`${relativeRoot}/README.md`, message))
    }
  }

  if (!(await isRegularFile(metadataPath))) {
    issues.push(issue(relativeRoot, "Missing regular assignment.yaml file."))
    return issues
  }

  const document = YAML.parseDocument(await readFile(metadataPath, "utf8"))
  for (const error of document.errors) {
    issues.push(issue(relativeMetadataPath, error.message))
  }
  const value = document.toJS() as unknown
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    issues.push(issue(relativeMetadataPath, "Metadata must be a YAML object."))
    return issues
  }
  const metadata = value as Record<string, unknown>

  for (const message of validateAllowedKeys(metadata, ALLOWED_METADATA_KEYS)) {
    issues.push(issue(relativeMetadataPath, message))
  }

  if (metadata.schema_version !== 1) {
    issues.push(issue(relativeMetadataPath, "schema_version must equal 1."))
  }
  const assignmentId = stringField(
    metadata,
    "assignment_id",
    issues,
    relativeMetadataPath,
  )
  const assignmentSlug = stringField(
    metadata,
    "assignment_slug",
    issues,
    relativeMetadataPath,
  )
  stringField(metadata, "title", issues, relativeMetadataPath)
  const status = stringField(metadata, "status", issues, relativeMetadataPath)
  const rootPath = stringField(
    metadata,
    "root_path",
    issues,
    relativeMetadataPath,
  )

  if (assignmentId && assignmentSlug && assignmentId !== assignmentSlug) {
    issues.push(
      issue(relativeMetadataPath, "assignment_id must match assignment_slug."),
    )
  }
  if (assignmentSlug && pathMatch?.[3] !== assignmentSlug) {
    issues.push(
      issue(
        relativeMetadataPath,
        "assignment_slug must match the Assignment folder slug.",
      ),
    )
  }
  if (rootPath && rootPath !== relativeRoot) {
    issues.push(
      issue(relativeMetadataPath, `root_path must equal ${relativeRoot}.`),
    )
  }
  if (status && !ALLOWED_STATUSES.has(status)) {
    issues.push(
      issue(
        relativeMetadataPath,
        `status must be one of: ${[...ALLOWED_STATUSES].join(", ")}.`,
      ),
    )
  }
  const assignmentLane = pathMatch?.[1]
  const completedStatuses = new Set(["complete", "completed", "archived"])
  if (assignmentLane === "active" && status && completedStatuses.has(status)) {
    issues.push(
      issue(
        relativeMetadataPath,
        "Assignments under assignments/active must not use a completed status.",
      ),
    )
  }
  if (
    assignmentLane === "completed" &&
    status &&
    !completedStatuses.has(status)
  ) {
    issues.push(
      issue(
        relativeMetadataPath,
        "Assignments under assignments/completed must use complete, completed, or archived status.",
      ),
    )
  }

  const mirror = metadata.local_mirror
  if (mirror === null || typeof mirror !== "object" || Array.isArray(mirror)) {
    issues.push(issue(relativeMetadataPath, "local_mirror must be an object."))
  } else {
    for (const key of Object.keys(mirror)) {
      if (key !== "driver" && key !== "metadata") {
        issues.push(
          issue(relativeMetadataPath, `Unexpected local_mirror key: ${key}.`),
        )
      }
    }
    for (const field of ["driver", "metadata"] as const) {
      const mirrorPath = (mirror as Record<string, unknown>)[field]
      if (typeof mirrorPath !== "string" || mirrorPath.trim() === "") {
        issues.push(
          issue(
            relativeMetadataPath,
            `local_mirror.${field} must be a non-empty string.`,
          ),
        )
      } else if (!safeAssignmentArtifact(mirrorPath)) {
        issues.push(
          issue(
            relativeMetadataPath,
            `local_mirror.${field} must stay inside the Assignment.`,
          ),
        )
      } else if (
        !(await isRegularFile(path.join(params.assignmentRoot, mirrorPath)))
      ) {
        issues.push(
          issue(
            relativeMetadataPath,
            `local_mirror.${field} does not exist inside the Assignment.`,
          ),
        )
      }
    }
  }

  for (const field of [
    "owner_role",
    "customer_job",
    "primary_surface",
  ] as const) {
    if (
      metadata[field] !== undefined &&
      (typeof metadata[field] !== "string" || metadata[field].trim() === "")
    ) {
      issues.push(
        issue(relativeMetadataPath, `${field} must be a non-empty string.`),
      )
    }
  }
  if (
    metadata.support_roles !== undefined &&
    stringArray(metadata.support_roles) === null
  ) {
    issues.push(
      issue(relativeMetadataPath, "support_roles must be a string list."),
    )
  }
  if (metadata.validation !== undefined) {
    if (!isRecord(metadata.validation)) {
      issues.push(
        issue(relativeMetadataPath, "validation must be a YAML object."),
      )
    } else {
      for (const message of validateAllowedKeys(
        metadata.validation,
        new Set(["current_commands"]),
      )) {
        issues.push(issue(relativeMetadataPath, `validation: ${message}`))
      }
      const commands = stringArray(metadata.validation.current_commands)
      if (!commands || commands.length === 0) {
        issues.push(
          issue(
            relativeMetadataPath,
            "validation.current_commands must be a non-empty string list.",
          ),
        )
      }
    }
  }
  if (metadata.extensions !== undefined && !isRecord(metadata.extensions)) {
    issues.push(
      issue(relativeMetadataPath, "extensions must be a YAML object."),
    )
  }

  await validateLifecycle({
    assignmentRoot: params.assignmentRoot,
    issues,
    metadata,
    metadataPath: relativeMetadataPath,
    status,
  })

  return issues
}
