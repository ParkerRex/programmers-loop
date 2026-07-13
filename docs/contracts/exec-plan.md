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

A Program-owned ExecPlan also includes both `program_id` and the exact
repository-relative `planning_brief` path. Neither may appear alone.

## Required body

The H1 exactly matches `title`. The body contains these level-two sections:

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

`Plan of Work` includes `### In Scope` and `### Out of Scope`.
`Validation and Acceptance` includes `### Test Commands` with runnable commands
in fenced code blocks. Command execution is a separate, explicit trust
decision; valid Markdown does not imply permission to execute it.

## Interface

Create a safe scaffold with `programmers-loop exec-plan create`; Program owners
stamp the exact current brief. Validate it with `programmers-loop exec-plan
lint --path <plan.md>`. Agent phases preview by default; add `--execute` to
write, grill, execute, validate, or run. Preview deterministic commands with
`exec-plan proof`; add `--execute` only after reviewing the allowlist decisions.
Use `exec-plan validate --execute --proof` for bounded repair and deterministic
acceptance.
