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

  return issues
}
