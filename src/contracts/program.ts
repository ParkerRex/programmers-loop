import { access, readdir, readFile } from "node:fs/promises"
import path from "node:path"

import {
  parseMarkdownFrontmatter,
  validateMarkdownDocument,
} from "../markdown/frontmatter.js"
import { issue, type LintIssue } from "./types.js"

const REQUIRED_KEYS = [
  "program_id",
  "title",
  "status",
  "created_at",
  "completed_at",
  "summary",
  "post_build_recap",
  "read_when",
] as const

const REQUIRED_SECTIONS = [
  "Purpose / Big Picture",
  "Program Inputs",
  "Current State",
  "Progress",
  "Decision Log",
  "Slice Ledger",
  "Next Slice",
  "Risks and Watchpoints",
  "Outcomes & Retrospective",
  "Validation and Acceptance",
  "Artifacts and Notes",
  "Interfaces and Dependencies",
] as const

const REQUIRED_PACKET_FILES = [
  "converged-decision-packet.md",
  "dependency-graph.md",
  "plan-split-recommendation.md",
  "cross-repo-review.md",
] as const

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath)
    return true
  } catch {
    return false
  }
}

export async function lintProgram(params: {
  programRoot: string
  repoRoot: string
}): Promise<LintIssue[]> {
  const issues: LintIssue[] = []
  const relativeRoot = path
    .relative(params.repoRoot, params.programRoot)
    .split(path.sep)
    .join("/")
  const programId = path.basename(params.programRoot)
  const readmePath = path.join(params.programRoot, "README.md")

  if (!(await exists(readmePath))) {
    issues.push(issue(relativeRoot, "Program root must include README.md."))
    return issues
  }

  const parsed = parseMarkdownFrontmatter(await readFile(readmePath, "utf8"))
  const messages = [
    ...parsed.issues,
    ...validateMarkdownDocument({
      body: parsed.body,
      metadata: parsed.metadata,
      requiredKeys: REQUIRED_KEYS,
      requiredSections: REQUIRED_SECTIONS,
    }),
  ]
  for (const message of messages) {
    issues.push(issue(`${relativeRoot}/README.md`, message))
  }
  if (parsed.metadata.program_id !== programId) {
    issues.push(
      issue(
        `${relativeRoot}/README.md`,
        "program_id must match the Program directory.",
      ),
    )
  }
  if (!new Set(["active", "complete"]).has(String(parsed.metadata.status))) {
    issues.push(
      issue(`${relativeRoot}/README.md`, "status must be active or complete."),
    )
  }

  const packetRoot = path.join(params.programRoot, "packet")
  if (!(await exists(packetRoot))) {
    issues.push(issue(relativeRoot, "Program root must include packet/."))
  } else {
    const packetFiles = (await readdir(packetRoot)).filter((name) =>
      name.endsWith(".md"),
    )
    for (const requiredFile of REQUIRED_PACKET_FILES) {
      if (!packetFiles.includes(requiredFile)) {
        issues.push(
          issue(`${relativeRoot}/packet`, `Missing required ${requiredFile}.`),
        )
      }
    }
    if (
      !packetFiles.some((name) => /^research-pass-[a-z0-9-]+\.md$/.test(name))
    ) {
      issues.push(
        issue(`${relativeRoot}/packet`, "Missing a research-pass-<slug>.md."),
      )
    }
    if (
      !packetFiles.some((name) => /^normalized-pass-[a-z0-9-]+\.md$/.test(name))
    ) {
      issues.push(
        issue(`${relativeRoot}/packet`, "Missing a normalized-pass-<slug>.md."),
      )
    }
  }

  const briefsRoot = path.join(params.programRoot, "briefs")
  const pointerPath = path.join(briefsRoot, "current.txt")
  let pointer: string | null = null
  if (!(await exists(pointerPath))) {
    issues.push(
      issue(relativeRoot, "Program root must include briefs/current.txt."),
    )
  } else {
    pointer = (await readFile(pointerPath, "utf8")).trim()
    if (!/^planning-brief-[1-9]\d*\.md$/.test(pointer)) {
      issues.push(
        issue(
          `${relativeRoot}/briefs/current.txt`,
          "Pointer must contain exactly one planning-brief-<N>.md filename.",
        ),
      )
    } else if (!(await exists(path.join(briefsRoot, pointer)))) {
      issues.push(
        issue(
          `${relativeRoot}/briefs/current.txt`,
          "Pointed brief does not exist.",
        ),
      )
    }
  }

  const briefFiles = (await exists(briefsRoot))
    ? (await readdir(briefsRoot))
        .filter((name) => /^planning-brief-[1-9]\d*\.md$/.test(name))
        .toSorted()
    : []
  if (briefFiles.length === 0) {
    issues.push(
      issue(relativeRoot, "Program must include a versioned planning brief."),
    )
  }
  const currentBriefs: string[] = []
  for (const briefFile of briefFiles) {
    const briefPath = path.join(briefsRoot, briefFile)
    const brief = parseMarkdownFrontmatter(await readFile(briefPath, "utf8"))
    for (const message of [
      ...brief.issues,
      ...validateMarkdownDocument({
        body: brief.body,
        metadata: brief.metadata,
        requiredKeys: [
          "title",
          "program_id",
          "brief_version",
          "status",
          "summary",
          "read_when",
        ],
      }),
    ]) {
      issues.push(issue(`${relativeRoot}/briefs/${briefFile}`, message))
    }
    if (brief.metadata.program_id !== programId) {
      issues.push(
        issue(
          `${relativeRoot}/briefs/${briefFile}`,
          "program_id must match the Program directory.",
        ),
      )
    }
    const expectedVersion = Number(briefFile.match(/(\d+)\.md$/)?.[1])
    if (brief.metadata.brief_version !== expectedVersion) {
      issues.push(
        issue(
          `${relativeRoot}/briefs/${briefFile}`,
          "brief_version must match the filename.",
        ),
      )
    }
    if (
      !new Set(["current", "superseded"]).has(String(brief.metadata.status))
    ) {
      issues.push(
        issue(
          `${relativeRoot}/briefs/${briefFile}`,
          "status must be current or superseded.",
        ),
      )
    }
    if (brief.metadata.status === "current") currentBriefs.push(briefFile)
  }
  if (currentBriefs.length !== 1) {
    issues.push(
      issue(
        relativeRoot,
        "Program must have exactly one current planning brief.",
      ),
    )
  } else if (pointer !== currentBriefs[0]) {
    issues.push(
      issue(
        `${relativeRoot}/briefs/current.txt`,
        "Pointer must name the brief whose frontmatter status is current.",
      ),
    )
  }

  return issues
}
