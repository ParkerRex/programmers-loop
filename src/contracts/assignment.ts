import { access, readFile } from "node:fs/promises"
import path from "node:path"

import YAML from "yaml"

import {
  parseMarkdownFrontmatter,
  validateMarkdownDocument,
} from "../markdown/frontmatter.js"
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
  "proof",
  "review",
  "receipts",
] as const

const CLOSEOUT_SEGMENTS = ["execplans", "proof", "review", "receipts"]
const READY_STATES = new Set(["complete", "not_applicable"])

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath)
    return true
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
      for (const dependency of blockedBy) {
        if (!(LIFECYCLE_SEGMENTS as readonly string[]).includes(dependency)) {
          params.issues.push(
            issue(
              params.metadataPath,
              `lifecycle.segments.${segmentId}.blocked_by names unknown segment ${dependency}.`,
            ),
          )
        }
      }
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

  if (!(await exists(readmePath))) {
    issues.push(issue(relativeRoot, "Missing required README.md."))
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

  if (!(await exists(metadataPath))) {
    issues.push(issue(relativeRoot, "Missing required assignment.yaml."))
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

  const mirror = metadata.local_mirror
  if (mirror === null || typeof mirror !== "object" || Array.isArray(mirror)) {
    issues.push(issue(relativeMetadataPath, "local_mirror must be an object."))
  } else {
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
        !(await exists(path.join(params.assignmentRoot, mirrorPath)))
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

  await validateLifecycle({
    assignmentRoot: params.assignmentRoot,
    issues,
    metadata,
    metadataPath: relativeMetadataPath,
    status,
  })

  return issues
}
