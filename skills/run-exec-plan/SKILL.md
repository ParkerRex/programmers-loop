---
name: run-exec-plan
description: "Write, lint, grill, execute, repair, and validate one Programmers Loop ExecPlan. Use when a bounded implementation slice needs self-contained context and deterministic acceptance commands."
---

# Run ExecPlan

1. Read `docs/contracts/exec-plan.md` and the owning Assignment or Program.
2. Scaffold the plan with `programmers-loop exec-plan create --owner <path>`;
   Program ownership resolves and records the current brief once.
3. Write from a durable outline with `programmers-loop exec-plan write --path
<plan.md> --outline <notes.md> --execute`.
4. Run `programmers-loop exec-plan lint --path <plan.md>`.
5. Grill it with `programmers-loop exec-plan grill --path <plan.md> --execute`;
   stop on a real owner question.
6. Preview every acceptance command with `programmers-loop exec-plan proof
--path <plan.md>` and resolve rejected commands before granting consent.
7. Run the complete bounded loop with `programmers-loop exec-plan run --path
<plan.md> --execute --proof`, or call execute and validate separately when a
   human checkpoint belongs between them.
8. Inspect the workflow and proof receipts under `.runtime/`; record durable
   discoveries, decisions, outcomes, and the post-build recap in the plan.
9. Mark the plan complete and move it to the matching `completed/` lane only
   after deterministic proof passes.

Do not authorize Markdown command execution implicitly. Show the commands and
apply the repository's configured token-prefix allowlist, containment, timeout,
bounded-output, and receipt boundary.
