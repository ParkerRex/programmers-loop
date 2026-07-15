---
name: verify-before-claim
applies_to:
  phases: [execute, validate]
  shapes: [exec-plan]
priority: 90
lintable: "The validate phase runs the plan's approved ### Test Commands as deterministic proof and only completes when they pass; status must stay active until proof passes (src/workflows/exec-plan.ts validateExecPlan)."
---

# Verify before you claim

Run the checks the change actually affects before declaring completion, and
state exactly what you ran and what you observed. A green visible test suite is
necessary but never sufficient.

Do this:

- Before marking Progress complete, run every `### Test Command` and any manual
  smoke the plan names. Paste the real command and its observed result into
  Artifacts & Notes — not a paraphrase, not "tests pass".
- Ask what the change could break that the visible suite does not cover:
  malformed input, empty input, error paths, boundaries. Exercise those.
- Never weaken, delete, or skip an assertion to turn a failure green. Leave the
  plan `active` while any required check fails.

Why this is here: in a live smoke episode a naive `try/catch` that swallowed a
parse error passed the visible suite 3/3 and looked done — but hidden acceptance
fed it a malformed line, expected a thrown `SyntaxError`, and the episode graded
`verified_failure`. The visible green was real and still meant nothing. Only the
behavior you actually exercised counts as verified.
