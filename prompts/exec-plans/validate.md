# Validate an ExecPlan

Read `AGENTS.md`, `docs/contracts/exec-plan.md`, the target ExecPlan, its
immutable Program brief when present, the implementation diff, and all existing
proof receipts. Validation is an adversarial comparison between promised and
observed behavior, not a summary of the implementing agent's claims.

First validate the document contract and scope. Then inspect every touched
surface, acceptance criterion, migration, recovery path, and interface named by
the plan. Identify missing implementation, accidental scope, stale docs,
weakened tests, unhandled failure states, and provenance drift.

When proof execution was explicitly approved, run only the exact command set
captured by the approved preview. Use the configured token-prefix allowlist,
repository-contained working directory, direct process boundary, timeout, and
bounded output. If any repair changes the command set, block and require a new
preview rather than silently authorizing it.

For each bounded repair attempt:

1. Record the concrete failing observation.
2. Repair only an in-scope implementation or documentation defect.
3. Run the narrowest failing check.
4. Re-run the complete approved acceptance set.
5. Persist the attempt and result.

Do not repair by deleting assertions, broadening scope, suppressing errors,
changing the planning brief, or weakening acceptance. Stop when the repair
budget is exhausted, the failure is external, a new owner decision is needed,
or safe recovery is unavailable.

Mark validation complete only when the plan contract passes, all required work
is present, the exact approved commands pass, manual observations are recorded,
and remaining risks are honestly documented. Otherwise leave the plan active
and report the failed criterion, evidence, attempted repairs, and required next
action.
