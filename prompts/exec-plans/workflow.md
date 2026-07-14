# Run the complete ExecPlan workflow

Operate one bounded slice through durable outline, plan writing, contract lint,
grill, execution, deterministic proof, validation, documentation sync, and
closeout. Each phase consumes the checked-in artifact from the previous phase
and writes a durable receipt; chat history is never the source of truth.

Required sequence:

1. Distill evidence with `prompts/exec-plans/outline.md` when the source is noisy.
2. Write one self-contained plan with `prompts/exec-plans/write.md`.
3. Run focused planning lint and repair contract failures.
4. Grill with `prompts/exec-plans/grill.md` until complete or owner-blocked.
5. Execute milestone by milestone with `prompts/exec-plans/execute.md`.
6. Preview proof commands and obtain explicit execution consent.
7. Execute the exact approved direct-spawn command set.
8. Validate and perform only bounded in-scope repairs with
   `prompts/exec-plans/validate.md`.
9. Sync durable owning docs and complete the living plan only after proof passes.

Stop immediately on an invalid artifact, unresolved owner decision, missing
authority, denied consent, rejected command, changed approved command set,
unsafe recovery, exhausted grill or repair budget, or failed acceptance proof.
An agent's success statement never substitutes for a deterministic receipt.

For Program-owned work, preserve the exact `planning_brief` revision throughout
the slice and return control to the Program refresh loop after validation. Do
not write the next child plan during this workflow.
