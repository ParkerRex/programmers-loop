---
title: "Planning Model"
summary: "Hierarchy and lifecycle of Assignments, Programs, and ExecPlans."
status: active
read_when:
  - "Choosing the right durable planning artifact."
---

# Planning Model

## Owns

- The hierarchy between Assignment, Program, immutable planning brief, and
  ExecPlan.
- Selection guidance for single-slice and multi-slice work.

Use an Assignment for one coherent body of work. Add a Program when research,
convergence, dependency ordering, or multiple slices are needed. Use an
ExecPlan for one bounded execution slice. A Program child plan records the exact
immutable brief revision resolved at run start.

For concrete completed file trees and a decision guide covering trivial,
research-only, single-slice, and multi-slice work, read
[Artifact anatomy and selection](assignments/artifact-guide.md).

## Does Not Own

- Field-level artifact requirements.
- Runtime adapter behavior or command-execution authority.
- GitHub issue or pull-request lifecycle state.

## Next

- [Assignment packets](assignments/README.md)
- [Artifact anatomy and selection](assignments/artifact-guide.md)
- [Assignment contract](contracts/assignment.md)
- [Program contract](contracts/program.md)
- [ExecPlan contract](contracts/exec-plan.md)
