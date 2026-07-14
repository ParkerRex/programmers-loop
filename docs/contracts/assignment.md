---
title: "Assignment Contract"
summary: "Contract for the umbrella packet that owns Programs and ExecPlans."
status: active
read_when:
  - "Creating or validating an Assignment."
---

# Assignment Contract

An Assignment is the durable umbrella for one coherent body of work. It owns
shared evidence, zero or more Programs, and zero or more standalone ExecPlans.

## Storage

```text
docs/assignments/active/YYYY-MM-DD-assignment-slug/
docs/assignments/completed/YYYY-MM-DD-assignment-slug/
```

Every Assignment contains `README.md` and `assignment.yaml`. Broadly useful
evidence may live at the root as `research.md`, `architecture.md`, `ux.md`,
`ui.md`, `proof.md`, `review.md`, or `receipts.md`.

Programs live in `programs/active/` or `programs/completed/`. ExecPlans live in
`exec-plans/active/` or `exec-plans/completed/` at either the Assignment or
Program level.

## Metadata

`assignment.yaml` uses the existing readable packet shape:

```yaml
schema_version: 1
assignment_id: example
assignment_slug: example
title: Example
status: active
root_path: docs/assignments/active/YYYY-MM-DD-example
local_mirror:
  driver: README.md
  metadata: assignment.yaml
```

`assignment_id` and `assignment_slug` match the folder slug. `root_path` is
repository-relative and exact. Both local mirror files must exist inside the
Assignment.

Portable optional context includes non-empty `owner_role`, `customer_job`, and
`primary_surface` strings, a `support_roles` string list, and
`validation.current_commands`. Consumer-specific structured metadata belongs
under the explicit `extensions` object rather than as undocumented top-level
keys.

Only documented top-level, local-mirror, lifecycle, segment, and derived keys
are allowed. Active and completed directory lanes must agree with status.
Lifecycle dependencies cannot contain duplicates, self-dependencies, or cycles;
optional `complete_when` criteria are non-empty string lists.

Allowed statuses are `draft`, `active`, `ready`, `in_progress`, `blocked`,
`needs_owner`, `review`, `complete`, `completed`, and `archived`.

## Lifecycle stepper

`assignment.yaml` also contains a required lifecycle stepper. Its ordered
segments are `research`, `architecture`, `ux`, `ui`, `program`, `execplans`,
`unlocks`, `proof`, `review`, and `receipts`. Unlocks make external approvals,
credentials, migrations, or delivery prerequisites explicit and may be marked
not applicable with a reason. `design` is a derived view of architecture, UX,
and UI; `plan` is a derived view of ExecPlans.

Each segment has one state: `not_applicable`, `missing`, `ready`,
`in_progress`, `blocked`, `needs_owner`, or `complete`. It names one `artifact`
or an `artifacts` list inside the Assignment, a `blocked_by` list, and optional
`complete_when` criteria. `not_applicable` requires a concrete reason. Ready,
in-progress, and complete artifacts must exist.

```yaml
lifecycle:
  states:
    [
      not_applicable,
      missing,
      ready,
      in_progress,
      blocked,
      needs_owner,
      complete,
    ]
  order:
    [
      research,
      architecture,
      ux,
      ui,
      program,
      execplans,
      unlocks,
      proof,
      review,
      receipts,
    ]
  segments:
    research:
      state: complete
      artifact: research.md
      blocked_by: []
    ux:
      state: not_applicable
      artifact: ux.md
      blocked_by: [research, architecture]
      not_applicable_reason: This change has no human-facing interaction.
    execplans:
      state: in_progress
      artifact: exec-plans
      blocked_by: [research, architecture, ux, ui]
    unlocks:
      state: not_applicable
      artifact: unlocks.md
      blocked_by: []
      not_applicable_reason: This slice has no external delivery prerequisite.
derived_segments:
  design:
    derives_from: [architecture, ux, ui]
  plan:
    derives_from: [execplans]
```

A segment cannot become ready, in progress, or complete until every dependency
is complete or explicitly not applicable. Completed Assignments require
ExecPlans, unlocks, proof, review, and receipts to be complete or not
applicable. The stepper is general workflow memory; product-specific rubrics
and design tools belong in referenced artifacts, not this core schema.

## Interface

Preview or create a packet with `programmers-loop assignment create`. Validate
one packet with `programmers-loop assignment lint --path <assignment>` or the
entire tree with `programmers-loop planning lint`. The local doctor runs the
same planning validation, so lifecycle drift appears in both focused lint and
repository health.
