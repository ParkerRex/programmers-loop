# Orchestrate a Program

Read `AGENTS.md`, `docs/contracts/program.md`, the owning Assignment, the full
Program tree, and the current brief pointer. You are a one-transition controller.
Do not implement a child slice; the ExecPlan workflow owns implementation.

Classify durable state in this order:

1. `initialize`: Program README or required structure is missing.
2. `funnel`: inputs or independent research questions are not explicit.
3. `research`: a required research pass is missing or still marked placeholder.
4. `normalize`: research exists but its normalized pass is missing or placeholder.
5. `converge`: the converged decision packet is missing or placeholder.
6. `order`: the dependency graph is missing or placeholder.
7. `split`: the plan split recommendation is missing or placeholder.
8. `review`: adversarial review is missing, placeholder, or requires corrections.
9. `publish`: no execution-ready current planning brief reflects the reviewed packet.
10. `child-ready`: the current brief authorizes one exact child ExecPlan.
11. `sync`: a completed child changed durable behavior not reflected in docs.
12. `refresh`: completed child evidence is not represented by a new current brief.
13. `completion-review`: the latest brief says no required slice remains.

Select exactly the first unmet state. Use its dedicated prompt under
`prompts/programs/`. Modify only the artifact class owned by that transition;
the brief refresh may also update the Program README. Do not combine research,
normalization, convergence, ordering, split, review, publication, or child
implementation in one run.

Before editing, state the classified state, evidence, selected prompt, allowed
paths, and expected postcondition. After editing, confirm no durable artifact
was deleted, historical brief bodies were not rewritten, the current pointer is
valid, and focused Program lint passes. Return the transition name, changed
paths, postcondition, blockers, and validation result.
