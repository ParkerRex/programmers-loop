---
name: run-program
description: "Advance a Programmers Loop Program from evidence through convergence, immutable planning briefs, ordered ExecPlan slices, refresh, and completion. Use for initiatives too ambiguous or large for one ExecPlan."
---

# Run Program

1. Read `docs/contracts/program.md`, validate the owning Assignment, and create
   the Program with `programmers-loop program create` when it does not exist.
2. Gather independent research passes with explicit evidence and uncertainty.
3. Normalize agreements, conflicts, dependencies, and open decisions.
4. Write the converged decision packet, dependency graph, split recommendation,
   and adversarial review.
5. Publish a new immutable `planning-brief-<N>.md`; update `current.txt` only
   after the brief is complete.
6. Use `programmers-loop program advance --path <program>` to preview one
   transition, then repeat with `--execute` only when that transition is right.
7. Preview `programmers-loop program child-plan --path <program> --slug <slug>
--title <title>`; add `--execute` to pin and snapshot `current.txt`, scaffold
   the child, invoke the writer, validate it, and record the run.
8. Run the child ExecPlan with `$run-exec-plan`.
9. Record the slice result, refresh current planning, then select the next slice
   or complete the Program. Run `programmers-loop program lint --path <program>`
   after every transition.

Never edit a planning brief after it has been used. Supersede it with a new
version.
