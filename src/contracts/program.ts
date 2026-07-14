import { access, lstat, readdir, readFile } from "node:fs/promises"
import path from "node:path"

import {
  extractSection,
  parseMarkdownFrontmatter,
  validateMarkdownDocument,
} from "../markdown/frontmatter.js"
import {
  isIsoDate,
  isMeaningfulText,
  isNonEmptyString,
  KEBAB_CASE,
  validateAllowedKeys,
} from "./shared.js"
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
const ALLOWED_KEYS = new Set<string>(REQUIRED_KEYS)

const BRIEF_KEYS = [
  "title",
  "program_id",
  "brief_version",
  "status",
  "summary",
  "read_when",
] as const
const ALLOWED_BRIEF_KEYS = new Set<string>(BRIEF_KEYS)

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

const PROGRAM_PATH_PATTERN =
  /^docs\/assignments\/(active|completed)\/(?:\d{4}-\d{2}-\d{2}|YYYY-MM-DD)-[a-z0-9-]+\/programs\/(active|completed)\/([a-z0-9]+(?:-[a-z0-9]+)*)$/

export const PROGRAM_PLACEHOLDER_MARKER =
  "<!-- programmers-loop:placeholder -->"

const PLACEHOLDER_TEXT = [
  /pending evidence-backed convergence/i,
  /replace (?:this|initial|scaffold) .* with evidence/i,
  /do not execute .* placeholder/i,
  /initial brief scaffold/i,
]

const PACKET_READINESS_SECTIONS = {
  research: [
    "Question",
    "Sources Inspected",
    "Facts",
    "Inferences",
    "Conflicts And Uncertainty",
    "Implications",
    "Recommendation",
    "What Would Change The Recommendation",
  ],
  normalize: [
    "Vocabulary",
    "Facts",
    "Agreements",
    "Conflicts",
    "Dependencies",
    "Risks",
    "Unsupported Claims",
    "Missing Evidence",
    "Recommendation",
    "Source Mapping",
  ],
  converge: [
    "Goal And Observable Outcome",
    "Converged Decisions",
    "Evidence And Rationale",
    "Tensions Or Open Questions",
    "Constraints And Non-Goals",
    "Interfaces And State Ownership",
    "Failure And Recovery Expectations",
    "Proof Expectations",
    "Candidate Slices",
  ],
  dependency: [
    "Nodes",
    "Dependency Order",
    "Critical Path",
    "Parallel Work",
    "Interface Boundaries",
    "Unsafe Orders To Avoid",
    "Verification Boundaries",
  ],
  split: [
    "Recommended Number Of Plans",
    "Slice Summaries",
    "Dependency Order",
    "First Plan To Write",
    "Boundaries Between Plans",
    "Deferred Or Optional Work",
    "Unsafe Consolidations",
  ],
  review: [
    "What Holds Up",
    "Missing Surfaces Or Owners",
    "Ordering Findings",
    "Scope Findings",
    "Migration And Recovery Findings",
    "Proof Findings",
    "Required Corrections",
    "Final Recommended First Plan",
  ],
} as const

function requiredPacketSections(fileName: string): readonly string[] {
  if (
    fileName.startsWith("research-pass-") ||
    /^track-[1-9]\d*-/.test(fileName)
  ) {
    return PACKET_READINESS_SECTIONS.research
  }
  if (
    fileName.startsWith("normalized-pass-") ||
    /^normalized-track-[1-9]\d*\.md$/.test(fileName)
  ) {
    return PACKET_READINESS_SECTIONS.normalize
  }
  if (fileName === "converged-decision-packet.md") {
    return PACKET_READINESS_SECTIONS.converge
  }
  if (fileName === "dependency-graph.md") {
    return PACKET_READINESS_SECTIONS.dependency
  }
  if (fileName === "plan-split-recommendation.md") {
    return PACKET_READINESS_SECTIONS.split
  }
  if (fileName === "cross-repo-review.md") {
    return PACKET_READINESS_SECTIONS.review
  }
  return []
}

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

function relative(repoRoot: string, filePath: string): string {
  return path.relative(repoRoot, filePath).split(path.sep).join("/")
}

function containsPlaceholder(source: string): boolean {
  return (
    source.includes(PROGRAM_PLACEHOLDER_MARKER) ||
    PLACEHOLDER_TEXT.some((pattern) => pattern.test(source))
  )
}

async function pointerTarget(params: {
  briefsRoot: string
  issues: LintIssue[]
  relativeRoot: string
}): Promise<string | null> {
  const pointerPath = path.join(params.briefsRoot, "current.txt")
  if (!(await isRegularFile(pointerPath))) {
    params.issues.push(
      issue(
        params.relativeRoot,
        "Program root must include a regular briefs/current.txt file.",
      ),
    )
    return null
  }
  const lines = (await readFile(pointerPath, "utf8"))
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "")
  if (lines.length !== 1) {
    params.issues.push(
      issue(
        `${params.relativeRoot}/briefs/current.txt`,
        "Pointer must contain exactly one non-empty planning brief filename.",
      ),
    )
    return null
  }
  const target = lines[0] ?? ""
  if (!/^planning-brief-[1-9]\d*\.md$/.test(target)) {
    params.issues.push(
      issue(
        `${params.relativeRoot}/briefs/current.txt`,
        "Pointer must contain only planning-brief-<N>.md, not a path.",
      ),
    )
    return null
  }
  if (!(await exists(path.join(params.briefsRoot, target)))) {
    params.issues.push(
      issue(
        `${params.relativeRoot}/briefs/current.txt`,
        `Pointed brief does not exist: ${target}.`,
      ),
    )
  }
  return target
}

async function validateBriefs(params: {
  briefsRoot: string
  issues: LintIssue[]
  programId: string
  relativeRoot: string
}): Promise<void> {
  const pointer = await pointerTarget(params)
  const briefFiles = (await exists(params.briefsRoot))
    ? (await readdir(params.briefsRoot, { withFileTypes: true }))
        .filter(
          (entry) =>
            entry.isFile() && /^planning-brief-[1-9]\d*\.md$/.test(entry.name),
        )
        .map((entry) => entry.name)
        .toSorted()
    : []
  if (briefFiles.length === 0) {
    params.issues.push(
      issue(
        params.relativeRoot,
        "Program must include a versioned planning brief.",
      ),
    )
  }
  const currentBriefs: string[] = []
  for (const briefFile of briefFiles) {
    const brief = parseMarkdownFrontmatter(
      await readFile(path.join(params.briefsRoot, briefFile), "utf8"),
    )
    const briefPath = `${params.relativeRoot}/briefs/${briefFile}`
    for (const message of [
      ...brief.issues,
      ...validateMarkdownDocument({
        body: brief.body,
        metadata: brief.metadata,
        requiredKeys: BRIEF_KEYS,
      }),
      ...validateAllowedKeys(brief.metadata, ALLOWED_BRIEF_KEYS),
    ]) {
      params.issues.push(issue(briefPath, message))
    }
    if (!isNonEmptyString(brief.metadata.summary)) {
      params.issues.push(
        issue(briefPath, "summary must be a non-empty string."),
      )
    }
    if (brief.metadata.program_id !== params.programId) {
      params.issues.push(
        issue(briefPath, "program_id must match the owning Program directory."),
      )
    }
    const expectedVersion = Number(briefFile.match(/([1-9]\d*)\.md$/)?.[1])
    if (
      !Number.isInteger(brief.metadata.brief_version) ||
      Number(brief.metadata.brief_version) <= 0
    ) {
      params.issues.push(
        issue(briefPath, "brief_version must be a positive integer."),
      )
    } else if (brief.metadata.brief_version !== expectedVersion) {
      params.issues.push(
        issue(briefPath, "brief_version must match the filename."),
      )
    }
    if (
      brief.metadata.status !== "current" &&
      brief.metadata.status !== "superseded"
    ) {
      params.issues.push(
        issue(briefPath, "status must be current or superseded."),
      )
    }
    if (brief.metadata.status === "current") currentBriefs.push(briefFile)
  }
  if (currentBriefs.length !== 1) {
    params.issues.push(
      issue(
        params.relativeRoot,
        "Program must have exactly one current planning brief.",
      ),
    )
  } else if (pointer !== currentBriefs[0]) {
    params.issues.push(
      issue(
        `${params.relativeRoot}/briefs/current.txt`,
        "Pointer must name the brief whose frontmatter status is current.",
      ),
    )
  }
}

export async function lintProgram(params: {
  programRoot: string
  repoRoot: string
}): Promise<LintIssue[]> {
  const issues: LintIssue[] = []
  const relativeRoot = relative(params.repoRoot, params.programRoot)
  const pathMatch = relativeRoot.match(PROGRAM_PATH_PATTERN)
  const programId = path.basename(params.programRoot)
  if (!pathMatch) {
    issues.push(
      issue(
        relativeRoot,
        "Program path must match docs/assignments/(active|completed)/<dated-assignment>/programs/(active|completed)/<program-id>.",
      ),
    )
  }
  if (!KEBAB_CASE.test(programId)) {
    issues.push(issue(relativeRoot, "Program directory must be kebab-case."))
  }

  const readmePath = path.join(params.programRoot, "README.md")
  if (!(await isRegularFile(readmePath))) {
    issues.push(
      issue(
        relativeRoot,
        "Program root must include a regular README.md file.",
      ),
    )
    return issues
  }
  const parsed = parseMarkdownFrontmatter(await readFile(readmePath, "utf8"))
  const readmeRelative = `${relativeRoot}/README.md`
  for (const message of [
    ...parsed.issues,
    ...validateMarkdownDocument({
      body: parsed.body,
      metadata: parsed.metadata,
      requiredKeys: REQUIRED_KEYS,
      requiredSections: REQUIRED_SECTIONS,
    }),
    ...validateAllowedKeys(parsed.metadata, ALLOWED_KEYS),
  ]) {
    issues.push(issue(readmeRelative, message))
  }
  if (parsed.metadata.program_id !== programId) {
    issues.push(
      issue(readmeRelative, "program_id must match the Program directory."),
    )
  }
  if (!isNonEmptyString(parsed.metadata.summary)) {
    issues.push(issue(readmeRelative, "summary must be a non-empty string."))
  }
  if (!isIsoDate(parsed.metadata.created_at)) {
    issues.push(
      issue(readmeRelative, "created_at must be a real YYYY-MM-DD date."),
    )
  }
  if (
    parsed.metadata.completed_at !== null &&
    !isIsoDate(parsed.metadata.completed_at)
  ) {
    issues.push(
      issue(readmeRelative, "completed_at must be null or a real date."),
    )
  }
  if (
    parsed.metadata.post_build_recap !== null &&
    !isNonEmptyString(parsed.metadata.post_build_recap)
  ) {
    issues.push(
      issue(
        readmeRelative,
        "post_build_recap must be a non-empty string or null.",
      ),
    )
  }

  const status = parsed.metadata.status
  if (status !== "active" && status !== "complete") {
    issues.push(issue(readmeRelative, "status must be active or complete."))
  }
  const lane = pathMatch?.[2]
  if (lane === "active" && status !== "active") {
    issues.push(
      issue(
        readmeRelative,
        "Programs under programs/active must use status: active.",
      ),
    )
  }
  if (lane === "completed" && status !== "complete") {
    issues.push(
      issue(
        readmeRelative,
        "Programs under programs/completed must use status: complete.",
      ),
    )
  }
  if (status === "active") {
    if (parsed.metadata.completed_at !== null) {
      issues.push(
        issue(readmeRelative, "Active Programs require completed_at: null."),
      )
    }
    if (parsed.metadata.post_build_recap !== null) {
      issues.push(
        issue(
          readmeRelative,
          "Active Programs require post_build_recap: null.",
        ),
      )
    }
  }
  if (status === "complete") {
    if (!isIsoDate(parsed.metadata.completed_at)) {
      issues.push(
        issue(
          readmeRelative,
          "Completed Programs require a completed_at date.",
        ),
      )
    }
    if (!isNonEmptyString(parsed.metadata.post_build_recap)) {
      issues.push(
        issue(readmeRelative, "Completed Programs require a post_build_recap."),
      )
    }
    if (
      !isMeaningfulText(extractSection(parsed.body, "Outcomes & Retrospective"))
    ) {
      issues.push(
        issue(
          readmeRelative,
          "Completed Programs require a meaningful Outcomes & Retrospective section.",
        ),
      )
    }
    const nextSlice = extractSection(parsed.body, "Next Slice")
    if (!nextSlice?.startsWith("No required next slice remains")) {
      issues.push(
        issue(
          readmeRelative,
          'Completed Programs must start Next Slice with "No required next slice remains".',
        ),
      )
    }
    const activePlansRoot = path.join(
      params.programRoot,
      "exec-plans",
      "active",
    )
    const activePlans = (await exists(activePlansRoot))
      ? (await readdir(activePlansRoot)).filter((name) => name.endsWith(".md"))
      : []
    if (activePlans.length > 0) {
      issues.push(
        issue(
          readmeRelative,
          `Completed Programs cannot retain active child ExecPlans: ${activePlans.toSorted().join(", ")}.`,
        ),
      )
    }
  }

  const packetRoot = path.join(params.programRoot, "packet")
  if (!(await exists(packetRoot))) {
    issues.push(issue(relativeRoot, "Program root must include packet/."))
  } else {
    const packetFiles = (await readdir(packetRoot, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
      .map((entry) => entry.name)
    for (const requiredFile of REQUIRED_PACKET_FILES) {
      if (!packetFiles.includes(requiredFile)) {
        issues.push(
          issue(`${relativeRoot}/packet`, `Missing required ${requiredFile}.`),
        )
      }
    }
    if (
      !packetFiles.some(
        (name) =>
          /^research-pass-[a-z0-9-]+\.md$/.test(name) ||
          /^track-[1-9]\d*-[a-z0-9-]+\.md$/.test(name),
      )
    ) {
      issues.push(issue(`${relativeRoot}/packet`, "Missing a research pass."))
    }
    if (
      !packetFiles.some(
        (name) =>
          /^normalized-pass-[a-z0-9-]+\.md$/.test(name) ||
          /^normalized-track-[1-9]\d*\.md$/.test(name),
      )
    ) {
      issues.push(
        issue(`${relativeRoot}/packet`, "Missing a normalized research pass."),
      )
    }
  }

  await validateBriefs({
    briefsRoot: path.join(params.programRoot, "briefs"),
    issues,
    programId,
    relativeRoot,
  })
  return issues
}

export async function lintProgramReadiness(params: {
  programRoot: string
  repoRoot: string
}): Promise<LintIssue[]> {
  const issues = await lintProgram(params)
  if (issues.length > 0) return issues
  const relativeRoot = relative(params.repoRoot, params.programRoot)
  const readmeSource = await readFile(
    path.join(params.programRoot, "README.md"),
    "utf8",
  )
  if (containsPlaceholder(readmeSource)) {
    issues.push(
      issue(
        `${relativeRoot}/README.md`,
        "Program document still describes scaffold placeholder state.",
      ),
    )
  }
  const readme = parseMarkdownFrontmatter(readmeSource)
  for (const heading of [
    "Current State",
    "Progress",
    "Decision Log",
    "Slice Ledger",
    "Next Slice",
  ]) {
    if (!isMeaningfulText(extractSection(readme.body, heading))) {
      issues.push(
        issue(
          `${relativeRoot}/README.md`,
          `Execution-ready Program requires a meaningful ## ${heading} section.`,
        ),
      )
    }
  }
  const packetRoot = path.join(params.programRoot, "packet")
  const packetFiles = (await readdir(packetRoot, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => entry.name)
    .toSorted()
  for (const fileName of packetFiles) {
    const source = await readFile(path.join(packetRoot, fileName), "utf8")
    if (containsPlaceholder(source)) {
      issues.push(
        issue(
          `${relativeRoot}/packet/${fileName}`,
          "Program packet still contains scaffold placeholder evidence.",
        ),
      )
    }
    for (const heading of requiredPacketSections(fileName)) {
      if (!isMeaningfulText(extractSection(source, heading))) {
        issues.push(
          issue(
            `${relativeRoot}/packet/${fileName}`,
            `Execution-ready packet requires a meaningful ## ${heading} section.`,
          ),
        )
      }
    }
  }
  const pointer = (
    await readFile(path.join(params.programRoot, "briefs/current.txt"), "utf8")
  ).trim()
  const briefPath = path.join(params.programRoot, "briefs", pointer)
  const source = await readFile(briefPath, "utf8")
  const parsed = parseMarkdownFrontmatter(source)
  if (containsPlaceholder(source)) {
    issues.push(
      issue(
        `${relativeRoot}/briefs/${pointer}`,
        "Current planning brief still contains scaffold placeholders.",
      ),
    )
  }
  const initialBriefSections = [
    "Goal",
    "Converged Decisions",
    "Open Questions",
    "Final Plan Split",
    "Final Dependency Order",
    "First ExecPlan To Write",
    "Why This First",
  ]
  const refreshBriefSections = [
    "What Changed",
    "What Still Holds",
    "Boundary Changes",
    "Dependency Changes",
    "Next Plan Recommendation",
    "Risks To Carry Forward",
  ]
  const hasShape = (headings: readonly string[]) =>
    headings.every((heading) =>
      isMeaningfulText(extractSection(parsed.body, heading)),
    )
  if (!hasShape(initialBriefSections) && !hasShape(refreshBriefSections)) {
    issues.push(
      issue(
        `${relativeRoot}/briefs/${pointer}`,
        "Current planning brief must satisfy the complete initial-brief or refresh-brief section contract before execution.",
      ),
    )
  }
  return issues
}

export async function lintProgramTransitionReadiness(params: {
  changedPaths: string[]
  programRoot: string
  repoRoot: string
}): Promise<LintIssue[]> {
  const issues = await lintProgram(params)
  if (issues.length > 0) return issues
  if (
    params.changedPaths.some(
      (filePath) =>
        filePath === "briefs/current.txt" ||
        filePath.startsWith("briefs/planning-brief-"),
    )
  ) {
    return lintProgramReadiness(params)
  }
  const relativeRoot = relative(params.repoRoot, params.programRoot)
  if (params.changedPaths.includes("README.md")) {
    const source = await readFile(
      path.join(params.programRoot, "README.md"),
      "utf8",
    )
    if (containsPlaceholder(source)) {
      issues.push(
        issue(
          `${relativeRoot}/README.md`,
          "A Program document transition must replace scaffold placeholder state.",
        ),
      )
    }
    const readme = parseMarkdownFrontmatter(source)
    for (const heading of [
      "Current State",
      "Progress",
      "Decision Log",
      "Slice Ledger",
      "Next Slice",
    ]) {
      if (!isMeaningfulText(extractSection(readme.body, heading))) {
        issues.push(
          issue(
            `${relativeRoot}/README.md`,
            `Program document transition requires a meaningful ## ${heading} section.`,
          ),
        )
      }
    }
  }
  for (const filePath of params.changedPaths.filter((value) =>
    value.startsWith("packet/"),
  )) {
    const fileName = path.basename(filePath)
    const source = await readFile(
      path.join(params.programRoot, filePath),
      "utf8",
    )
    if (containsPlaceholder(source)) {
      issues.push(
        issue(
          `${relativeRoot}/${filePath}`,
          "A Program packet transition must replace scaffold placeholder evidence.",
        ),
      )
    }
    for (const heading of requiredPacketSections(fileName)) {
      if (!isMeaningfulText(extractSection(source, heading))) {
        issues.push(
          issue(
            `${relativeRoot}/${filePath}`,
            `Program transition requires a meaningful ## ${heading} section.`,
          ),
        )
      }
    }
  }
  return issues
}
