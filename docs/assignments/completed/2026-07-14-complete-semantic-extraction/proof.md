---
title: "Complete semantic extraction proof"
summary: "Verification evidence for the full reusable planning extraction."
status: complete
read_when:
  - "Reviewing the completed semantic-parity extraction."
---

# Complete semantic extraction proof

## Aggregate proof

`bun run check` passed on 2026-07-14. It included formatting, lint, TypeScript
typechecking, 55 source tests, 2 example tests, package build, documentation
lint, planning lint, and local doctor. Doctor reported only the expected dirty-
worktree development warning.

## Package proof

`bun pm pack --dry-run --ignore-scripts` reported 163 packaged files and a
2.25 MB unpacked package. The built CLI rendered the complete outline, run, and
readiness-lint help contracts, including session JSONL, workshop handoff,
outline-driven writing, and ExecPlan readiness.

## Behavioral proof

Regression coverage proves strict lifecycle metadata and unlocks, Program and
ExecPlan readiness, exact packet and brief shapes, immutable brief ownership,
one-pass Program transitions, no-op and partial-mutation receipts, non-file
mutation rejection, exact-session grill continuation, blocked-question
visibility, stale proof-preview rejection, bounded transcript and handoff
input, final child-plan snapshots, and semantic prompt regression detection.

No agent, proof command, publish, Git, or external mutation was invoked outside
the repository's local verification commands.
