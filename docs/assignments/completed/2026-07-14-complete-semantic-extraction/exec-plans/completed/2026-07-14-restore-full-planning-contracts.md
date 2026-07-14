---
title: "Restore full portable planning contracts"
status: complete
created_at: 2026-07-14
completed_at: 2026-07-14
summary: "Bring the standalone validators, workflow gates, prompts, templates, and tests to semantic parity with the reusable source behavior."
post_build_recap: "Restored the complete reusable planning semantics, hardened execution boundaries, added session and handoff input, and passed the full package check."
read_when:
  - "Implementing or reviewing the full semantic-parity extraction."
---

# Restore full portable planning contracts

## Purpose / Big Picture

Programmers Loop currently contains the names and broad shapes of the source
planning system, but several contracts and prompts are reduced enough to permit
unsafe or semantically incomplete states. Restore the complete reusable
behavior so the standalone repository can become the source of truth.

## Progress

- [x] Audit the source and extracted capability surfaces.
- [x] Strengthen Assignment, Program, and ExecPlan validation.
- [x] Restore detailed runtime prompt contracts.
- [x] Enforce placeholder and Program transition safety.
- [x] Add regression coverage and run full proof.

## Surprises & Discoveries

The extracted Program scaffold explicitly says its placeholders do not
authorize execution, while the current linter and child-plan workflow accept
those placeholders. Prompt inventory validation also proves only that filenames
and headings exist, not that the operating contracts survived extraction.

The final source sweep found two more reusable seams that the first extraction
had collapsed: exact session/workshop handoff input and the Assignment unlock
gate. It also exposed that structurally valid ExecPlan scaffolds could enter
grill, proof, and execution without a separate readiness check.

## Decision Log

- 2026-07-14: Treat semantic parity as the goal. Generalize only paths,
  provider integration, and application-only policy; retain the complete
  reusable invariants and operating detail.
- 2026-07-14: Keep Codex JSONL parsing behind an explicit outline-input adapter
  while preserving notes and versioned workshop handoffs as neutral inputs.
- 2026-07-14: Require semantic postconditions for each Program transition and
  execution readiness for both Program and ExecPlan scaffolds.

## Outcomes & Retrospective

The standalone package now carries the reusable behavior instead of a reduced
shape: strict Assignment, Program, brief, and ExecPlan contracts; semantic
readiness gates; stage-complete prompts and packet validation; bounded outline
input; exact-session grilling; immutable child-plan provenance and snapshots;
one-transition filesystem verification; and stale-proof rejection. The full
package check, examples, docs, planning lint, doctor, build, and package smoke
all pass. Application services and product policy remain extensions rather than
hidden dependencies.

## Context and Orientation

The reusable source validators live under the originating repository's
repo-tooling package. Standalone contracts live under `src/contracts/`, runtime
loops under `src/workflows/`, operating prompts under `prompts/`, and public
contract documentation under `docs/contracts/`.

### In Scope

- Strict Assignment, Program, planning-brief, and ExecPlan validation.
- Scaffold parity with the validators.
- Full Program and ExecPlan operating prompts and semantic prompt checks.
- Placeholder rejection and verifiable one-transition Program advancement.
- Bounded session/handoff outline input and exact-session grill continuation.
- Focused tests, documentation, and full local proof.

### Out Of Scope

- Product UI, databases, deployment, hosted status, private infrastructure, or
  application-specific quality rubrics.
- Making one provider transcript format canonical or allowing unsafe shell
  execution.
- Publishing, committing, pushing, or releasing the package.

This ExecPlan must be maintained in accordance with `docs/contracts/exec-plan.md`.

## Plan of Work

Strengthen the durable contracts first, then align scaffolds and prompts with
them. Put readiness checks at execution boundaries, verify Program mutations
from filesystem snapshots, restore the complete outline and workflow inputs,
and finish by running focused plus aggregate proof.

## Milestones

1. Portable artifact validators reject every semantically invalid state the
   source implementation rejects for reusable reasons.
2. Runtime-loaded prompts carry the complete operating and completion contract,
   and inventory validation detects semantic regression.
3. Program workflows cannot execute placeholder evidence or report a one-step
   transition without verifying its bounded mutation.
4. Templates, docs, examples, and tests agree, and the complete check passes.

## Concrete Steps

1. Port reusable validator helpers and invariants without source-specific paths.
2. Update scaffolds and published templates to satisfy the strengthened schemas.
3. Expand every Program and ExecPlan prompt from its source contract, replacing
   only private or application-specific vocabulary.
4. Snapshot Program state around advancement and enforce one legal transition.
5. Add regression fixtures for placeholders, paths, completion, prompts, and
   transitions; update docs and run the aggregate verification stack.

## Validation and Acceptance

The standalone repo must reject placeholder execution, invalid lifecycle lanes,
mutable or mismatched brief references, incomplete completion metadata, empty
test commands, and semantically truncated prompts. Existing proof safety and
provider-neutral behavior must remain intact.

### Test Commands

```bash
bun run test
bun run typecheck
bun run docs:lint
bun run planning:lint
bun run check
```

## Idempotence and Recovery

Validator and prompt changes are deterministic. Keep edits scoped and retain
the existing direct-spawn proof boundary. If a source rule depends on product
state, document it as an extension rather than importing that dependency.

## Artifacts and Notes

Final parity evidence is recorded in the owning Assignment's `proof.md`,
`review.md`, and `receipts.md`. Runtime receipts remain ignored under
`.runtime/`.

## Interfaces and Dependencies

Use Node built-ins, the existing YAML parser, Markdown helpers, `AgentAdapter`,
and the repository's current CLI. Do not add runtime dependencies.
