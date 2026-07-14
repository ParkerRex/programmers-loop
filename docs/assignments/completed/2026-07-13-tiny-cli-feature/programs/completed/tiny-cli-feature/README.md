---
program_id: tiny-cli-feature
title: "Design and build the tiny CLI greeting command"
status: complete
created_at: 2026-07-13
completed_at: 2026-07-13
summary: "Converge the command contract, implement it, and prove both success and usage behavior."
post_build_recap: "The immutable brief produced one child plan and two passing acceptance tests."
read_when:
  - "Studying a completed Program packet."
---

# Design and build the tiny CLI greeting command

## Purpose / Big Picture

Show the planning loop using a feature small enough to understand at a glance.

## Program Inputs

The CLI needs a named greeting, no dependencies, and deterministic tests.

## Current State

Complete. `tiny greet Ada` prints `Hello, Ada!`.

## Progress

- [x] Research and normalize the command contract.
- [x] Publish planning brief 1.
- [x] Execute and validate the child plan.

## Decision Log

- Use a pure `runCli(args)` function and a thin process entrypoint.
- Return usage text for incomplete input rather than throwing.

## Slice Ledger

- `build-greet-command`: complete; two tests pass.

## Next Slice

No required next slice remains inside this Program.

## Risks and Watchpoints

This example intentionally omits argument parsing libraries and packaging.

## Outcomes & Retrospective

The tiny scope makes the relationship between evidence, brief, plan, code, and
proof visible without unrelated infrastructure.

## Validation and Acceptance

`bun run test:examples` passes from the repository root.

## Artifacts and Notes

The implementation is under `examples/tiny-cli-feature/project/`.

## Interfaces and Dependencies

The example uses only Node's process, URL, assertion, and test APIs.
