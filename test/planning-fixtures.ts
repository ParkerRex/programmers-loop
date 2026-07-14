import { readFile, readdir, writeFile } from "node:fs/promises"
import path from "node:path"

function packetSections(fileName: string): string[] {
  if (/^(?:research-pass-|track-[1-9]\d*-)/.test(fileName)) {
    return [
      "Question",
      "Sources Inspected",
      "Facts",
      "Inferences",
      "Conflicts And Uncertainty",
      "Implications",
      "Recommendation",
      "What Would Change The Recommendation",
    ]
  }
  if (/^(?:normalized-pass-|normalized-track-[1-9]\d*\.md$)/.test(fileName)) {
    return [
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
    ]
  }
  if (fileName === "converged-decision-packet.md") {
    return [
      "Goal And Observable Outcome",
      "Converged Decisions",
      "Evidence And Rationale",
      "Tensions Or Open Questions",
      "Constraints And Non-Goals",
      "Interfaces And State Ownership",
      "Failure And Recovery Expectations",
      "Proof Expectations",
      "Candidate Slices",
    ]
  }
  if (fileName === "dependency-graph.md") {
    return [
      "Nodes",
      "Dependency Order",
      "Critical Path",
      "Parallel Work",
      "Interface Boundaries",
      "Unsafe Orders To Avoid",
      "Verification Boundaries",
    ]
  }
  if (fileName === "plan-split-recommendation.md") {
    return [
      "Recommended Number Of Plans",
      "Slice Summaries",
      "Dependency Order",
      "First Plan To Write",
      "Boundaries Between Plans",
      "Deferred Or Optional Work",
      "Unsafe Consolidations",
    ]
  }
  return [
    "What Holds Up",
    "Missing Surfaces Or Owners",
    "Ordering Findings",
    "Scope Findings",
    "Migration And Recovery Findings",
    "Proof Findings",
    "Required Corrections",
    "Final Recommended First Plan",
  ]
}

export async function makeProgramReady(params: {
  programPath: string
  repoRoot: string
}): Promise<void> {
  const programRoot = path.join(params.repoRoot, params.programPath)
  const packetRoot = path.join(programRoot, "packet")
  for (const fileName of await readdir(packetRoot)) {
    if (!fileName.endsWith(".md")) continue
    const title = fileName
      .replace(/\.md$/, "")
      .split("-")
      .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
      .join(" ")
    await writeFile(
      path.join(packetRoot, fileName),
      `# ${title}\n\n${packetSections(fileName)
        .map(
          (heading) =>
            `## ${heading}\n\nEvidence, decisions, boundaries, and implications are recorded for this test Program.`,
        )
        .join("\n\n")}\n`,
    )
  }
  const readmePath = path.join(programRoot, "README.md")
  const readme = (await readFile(readmePath, "utf8"))
    .replace("<!-- programmers-loop:placeholder -->\n\n", "")
    .replace(
      "The initial packet is ready for research and convergence.",
      "Research has converged into an implementation-ready brief.",
    )
    .replace(
      "- [ ] Replace initial packet placeholders with evidence-backed findings.",
      "- [x] Replaced packet placeholders with evidence-backed findings.",
    )
    .replace(
      "- [ ] Converge the first implementation-ready planning brief.",
      "- [x] Converged the first implementation-ready planning brief.",
    )
    .replace(
      "No slices have been executed.",
      "No child slices have run; the first evidence-backed slice is ready.",
    )
    .replace(
      "Complete research and convergence before selecting an ExecPlan.",
      "Write and execute the first recommended ExecPlan.",
    )
    .replace(
      "Do not treat scaffold placeholders as researched conclusions.",
      "Preserve the evidence boundary while executing the first slice.",
    )
  await writeFile(readmePath, readme)
  const programId = path.basename(programRoot)
  await writeFile(
    path.join(programRoot, "briefs/planning-brief-1.md"),
    `---
title: Ready planning brief
program_id: ${programId}
brief_version: 1
status: current
summary: An evidence-backed first implementation slice.
read_when:
  - Writing the first child ExecPlan
---

# Ready planning brief

## Goal

Deliver one bounded, testable implementation slice.

## Converged Decisions

- Keep the implementation dependency-free and observable through tests.

## Open Questions

- None block the first slice.

## Final Plan Split

1. Implement the bounded behavior.

## Final Dependency Order

1. Implement and test the bounded behavior.

## First ExecPlan To Write

- Title: Implement the bounded behavior.
- Scope: One production seam and its focused tests.
- Boundaries: Do not absorb later cleanup or release work.

## Why This First

It proves the smallest useful behavior before broader changes.
`,
  )
}

export async function makeExecPlanReady(params: {
  planPath: string
  repoRoot: string
}): Promise<void> {
  const planPath = path.join(params.repoRoot, params.planPath)
  const source = (await readFile(planPath, "utf8"))
    .replace("<!-- programmers-loop:placeholder -->\n\n", "")
    .replace(
      "- [ ] Replace scaffold guidance with repository-specific steps.",
      "- [ ] Execute the repository-specific implementation steps.",
    )
    .replace(
      "- Define the bounded implementation work before execution.",
      "- Implement the bounded behavior described by this plan.",
    )
    .replace(
      "1. Replace scaffold text with a self-contained implementation plan.",
      "1. Implement the bounded repository change described above.",
    )
  await writeFile(planPath, source)
}
