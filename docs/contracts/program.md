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

Only the required frontmatter keys are allowed. Active Programs live under
`programs/active/` with null completion fields. Complete Programs live under
`programs/completed/`, include a real completion date and concrete recap, have
no active child ExecPlans, contain a meaningful retrospective, and start Next
Slice with `No required next slice remains`.

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

Brief frontmatter permits no extra keys. The version is a positive integer that
matches the filename, `program_id` matches the owning directory, exactly one
brief is current, and `briefs/current.txt` contains exactly that filename. After
a brief authorizes a child plan, its body is immutable; refresh may change only
the old brief's status from current to superseded.

## Execution readiness

Structural validity does not turn scaffold prose into evidence. Program
scaffolds mark the Program document, packet artifacts, and initial brief
explicitly. `program lint --ready` rejects remaining markers and placeholder
language and requires every packet artifact to satisfy the stage-specific
section shape defined by its checked-in prompt. The current brief must satisfy
the complete initial-brief shape ending in `First ExecPlan To Write` and `Why
This First`, or the complete refresh shape ending in `Next Plan Recommendation`
and `Risks To Carry Forward`. Program-owned ExecPlan creation and child-plan
generation enforce readiness before invoking an agent.

`program advance` may operate on a structurally valid placeholder packet. It
snapshots durable files and verifies that success changed exactly one legal
artifact class whose stage-specific semantic postcondition passes. Brief
publication may update briefs and the pointer; planning refresh may also update
the Program README. Deletion, no-op success, historical-brief rewrites, child-
plan mutation, and multi-stage changes fail the receipt.

## Interface

Create a structural packet with `programmers-loop program create`; its explicit
placeholders must be replaced by evidence-backed convergence before execution.
Validate each transition with `programmers-loop program lint --path <program>`.
Add `--ready` before authoring a child ExecPlan.
Preview one agent transition with `program advance`, or preview a brief-pinned
child with `program child-plan`; add `--execute` only after reviewing the target.
Child-plan runs hash and snapshot the exact current brief and reject mismatched
run-id reuse.
