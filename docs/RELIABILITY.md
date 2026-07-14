---
title: "Reliability"
summary: "Deterministic proof, doctors, receipts, and honest completion rules."
status: active
read_when:
  - "Designing validation, recovery, receipts, or completion gates."
---

# Reliability

## Owns

- The local proof stack and doctor expectations.
- Honest reporting of warnings, failures, and unrun checks.
- Deterministic receipts and bounded recovery for runtime loops.

The current proof stack is `bun run check`. Documentation and planning lint are
separate named surfaces and are also part of the aggregate. Local doctor failure
blocks completion; an uncommitted worktree is a warning during development.
GitHub doctor is read-only and treats a deliberately missing remote as a warning.

Proof preview is read-only. Execution requires `--execute`; integrated
validation additionally requires `--proof`. Commands run sequentially and the
runtime stops on the first non-zero exit or timeout. Every attempted run writes
a receipt under `.runtime/proof/` containing the original command, tokenized
argv, decision, timing, exit status, bounded stdout and stderr, and truncation
flags.

Agent phases use configured timeouts and bounded retained output. Outline
distillation accepts bounded notes, session JSONL, or a validated handoff,
runs read-only, validates its exact Markdown structure, refuses overwrite, and
receipts the result. ExecPlan grill defaults to five rounds and
resumes the exact session id across automatic owner-reply rounds. Validation
defaults to three agent repair and proof
attempts, feeds the exact prior failure into the next repair, and never converts
an agent completion claim into proof. Program child-plan runs persist their
parameters, pinned brief path and SHA-256, brief snapshot, final ExecPlan
snapshot, milestone count, state, and child workflow receipt. Reusing a
completed run id is idempotent; mismatched reuse or a changed pinned brief is
rejected.

Program and ExecPlan structural lint are distinct from execution readiness.
Child planning requires an evidence-backed current brief and no scaffold
markers; an ExecPlan scaffold must be replaced before grill or execution. Program
advance hashes durable files before and after the agent, rejects deletion,
no-op success, multi-stage mutation, and historical brief rewrites, and records
the accepted transition plus changed paths in a versioned receipt.

Receipts are execution evidence, not the canonical plan. They are ignored so a
repository can choose which concise outcomes to promote into checked-in
Markdown without committing verbose model events or command output.

## Does Not Own

- Artifact content requirements.
- Which model or provider an adapter selects.
- Authorization for publishing, pushing, or external mutation.

## Next

- [Configuration](CONFIGURATION.md)
- [Development workflow](DEVELOPMENT.md)
- [Security model](SECURITY.md)
- [Assignment index](assignments/README.md)
