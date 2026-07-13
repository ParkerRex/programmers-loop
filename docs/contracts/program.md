---
title: "Program Contract"
summary: "Contract for research, convergence, immutable briefs, and slices."
status: active
read_when:
  - "Creating or advancing a Program."
---

# Program Contract

A Program turns a large, ambiguous initiative into ordered, implementation-
ready slices. It belongs to one Assignment.

## Storage

```text
programs/active/<program-id>/
programs/completed/<program-id>/
```

The Program root contains:

```text
README.md
packet/research-pass-*.md
packet/normalized-pass-*.md
packet/converged-decision-packet.md
packet/dependency-graph.md
packet/plan-split-recommendation.md
packet/cross-repo-review.md
briefs/planning-brief-<N>.md
briefs/current.txt
exec-plans/active/
exec-plans/completed/
```

`briefs/current.txt` contains exactly one versioned brief filename. Resolve it
once when starting a slice and persist that exact revision in the child
ExecPlan and run record.

## Program document

The `README.md` frontmatter requires `program_id`, `title`, `status`,
`created_at`, `completed_at`, `summary`, `post_build_recap`, and `read_when`.
Status is `active` or `complete`.

The body requires these level-two sections:

- Purpose / Big Picture
- Program Inputs
- Current State
- Progress
- Decision Log
- Slice Ledger
- Next Slice
- Risks and Watchpoints
- Outcomes & Retrospective
- Validation and Acceptance
- Artifacts and Notes
- Interfaces and Dependencies

## Planning briefs

A planning brief is immutable after use. Its frontmatter requires `title`,
`program_id`, positive `brief_version`, `status`, `summary`, and `read_when`.
Status is `current` or `superseded`.

## Interface

Create a structural packet with `programmers-loop program create`; its explicit
placeholders must be replaced by evidence-backed convergence before execution.
Validate each transition with `programmers-loop program lint --path <program>`.
Agent judgment remains in the Program prompts and `$run-program` skill.
