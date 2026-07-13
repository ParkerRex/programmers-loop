---
name: programmers-loop
description: "Operate durable Assignment, Program, and ExecPlan loops in repositories using Programmers Loop. Use for ambiguous multi-slice work that needs checked-in decisions, bounded execution, critique, recovery, and deterministic acceptance."
---

# Programmers Loop

1. Run `programmers-loop standup --github` and repair failing prerequisites.
2. Read `docs/contracts/assignment.md`, `program.md`, and `exec-plan.md`.
3. Locate or create the owning Assignment.
4. Use a Program when research, convergence, or multiple ordered slices are
   required. Otherwise create a standalone ExecPlan.
5. Resolve immutable Program briefs once per child plan with `program
child-plan`; keep its snapshot and receipt.
6. Preview proof commands, then write, lint, grill, execute, and validate each
   ExecPlan through the explicit-consent CLI phases.
7. Record decisions and discoveries in the durable document as they happen.
8. Refresh the Program after every completed slice; choose the next slice or
   complete it explicitly.
9. Run `programmers-loop planning lint` and `$verify-programmers-loop` before
   handoff.

Never treat chat history as the sole source of planning truth. Never execute
commands from a plan without explicit authority and the configured safety
boundary.
