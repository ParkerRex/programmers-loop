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

Allowed statuses are `draft`, `active`, `ready`, `in_progress`, `blocked`,
`needs_owner`, `review`, `complete`, `completed`, and `archived`.

## Interface

Preview or create a packet with `programmers-loop assignment create`. Validate
one packet with `programmers-loop assignment lint --path <assignment>` or the
entire tree with `programmers-loop planning lint`.
