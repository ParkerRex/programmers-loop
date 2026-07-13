---
name: run-exec-plan
description: "Write, lint, grill, execute, repair, and validate one Programmers Loop ExecPlan. Use when a bounded implementation slice needs self-contained context and deterministic acceptance commands."
---

# Run ExecPlan

1. Read `docs/contracts/exec-plan.md` and the owning Assignment or Program.
2. Scaffold the plan with `programmers-loop exec-plan create --owner <path>`;
   Program ownership resolves and records the current brief once.
3. Replace every scaffold placeholder with required sections, explicit scope,
   milestones, recovery guidance,
   interfaces, and runnable test commands.
4. Run `programmers-loop exec-plan lint --path <plan.md>`.
5. Grill the plan for hidden decisions, missing context, unsafe assumptions,
   ambiguous commands, and unverifiable acceptance.
6. Execute from a fresh agent run with the smallest suitable sandbox.
7. Run approved test commands deterministically. Feed failures back into a
   bounded repair attempt.
8. Record discoveries, decisions, outcomes, and the post-build recap.
9. Mark the plan complete and move it to the matching `completed/` lane.

Do not authorize Markdown command execution implicitly. Show the commands and
apply the repository's configured allowlist and timeout.
