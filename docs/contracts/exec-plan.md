---
title: "ExecPlan Contract"
summary: "Contract for one bounded, self-contained execution slice."
status: active
read_when:
  - "Writing, grilling, executing, or validating an ExecPlan."
---

# ExecPlan Contract

An ExecPlan is a self-contained guide for one bounded implementation slice. A
capable agent should be able to execute it without relying on hidden chat
history.

## Frontmatter

Required keys are `title`, `status`, `created_at`, `completed_at`, `summary`,
`post_build_recap`, and `read_when`. Status is `active` or `complete`.

`tier` is optional and selects the contract tier: `full` or `lite`. An absent
`tier` means `full`, so every pre-tier plan keeps its exact requirements. The
tier is part of the plan contract version and of eval treatment identity: evals
stamp contract hashes, so changing tiers mid-study is configuration drift.

A Program-owned ExecPlan also includes both `program_id` and the exact
repository-relative `planning_brief` path. Neither may appear alone.
For an active plan the brief must exist and match the owning Program. A
completed plan preserves that historical path even if Program closeout later
moves the Program directory; completion never rewrites provenance.

## Required body

The H1 exactly matches `title` at every tier. A full-tier plan contains these
level-two sections:

- Purpose / Big Picture
- Progress
- Surprises & Discoveries
- Decision Log
- Outcomes & Retrospective
- Context and Orientation
- Plan of Work
- Milestones
- Concrete Steps
- Validation and Acceptance
- Idempotence and Recovery
- Artifacts and Notes
- Interfaces and Dependencies

A lite-tier plan (`tier: lite`) fits small bounded slices and requires exactly:

- Purpose / Big Picture
- Progress
- Context and Orientation
- Plan of Work
- Validation and Acceptance
- Outcomes & Retrospective

The other seven full-tier sections (Surprises & Discoveries, Decision Log,
Milestones, Concrete Steps, Idempotence and Recovery, Artifacts and Notes,
Interfaces and Dependencies) are optional at lite: permitted if present, never
required.

At every tier, `Context and Orientation` includes the exact ordered subsections
`### In Scope` and `### Out Of Scope`, both with concrete content. Every plan
includes the exact maintenance sentence:

> This ExecPlan must be maintained in accordance with
> `docs/contracts/exec-plan.md`.

`Validation and Acceptance` includes `### Test Commands` with runnable commands
in fenced code blocks at every tier; scope and proof are non-negotiable.
Command execution is a separate, explicit trust decision; valid Markdown does
not imply permission to execute it.

## Interface

Create a safe scaffold with `programmers-loop exec-plan create`; Program owners
stamp the exact current brief. The scaffolding API (`createExecPlanScaffold`)
accepts `tier: "lite"` to emit a lite skeleton; scaffold-marker and provenance
rules are identical at both tiers. A scaffold is structurally valid but carries
an explicit placeholder marker; it cannot enter grill, execution, or validation
until the writer replaces scaffold guidance with repository-specific content.
Validate structure with `programmers-loop exec-plan lint --path <plan.md>` and
execution readiness with `--ready`. Agent phases preview by default; add
`--execute` to write, grill, execute, validate, or run. Preview deterministic
commands with `exec-plan proof`; add `--execute` only after reviewing the
allowlist decisions. Use `exec-plan validate --execute --proof` for bounded
repair and deterministic acceptance.
