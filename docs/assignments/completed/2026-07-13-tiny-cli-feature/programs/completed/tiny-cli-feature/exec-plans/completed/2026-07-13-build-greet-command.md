---
title: "Build the tiny CLI greeting command"
status: complete
created_at: 2026-07-13
completed_at: 2026-07-13
summary: "Implement and test one dependency-free greeting command."
post_build_recap: "Implemented a pure command function, process entrypoint, and two passing tests."
read_when:
  - "Studying a completed child ExecPlan."
program_id: tiny-cli-feature
planning_brief: docs/assignments/completed/2026-07-13-tiny-cli-feature/programs/completed/tiny-cli-feature/briefs/planning-brief-1.md
---

# Build the tiny CLI greeting command

## Purpose / Big Picture

Provide the smallest real feature that demonstrates deterministic agent proof.

## Progress

- [x] Implement the command function and entrypoint.
- [x] Add and run both tests.

## Surprises & Discoveries

No subprocess harness was needed because the behavior is a pure function.

## Decision Log

Use stable usage output instead of an exception for incomplete input.

## Outcomes & Retrospective

The feature is complete and its two acceptance cases pass.

## Context and Orientation

All implementation files live in `examples/tiny-cli-feature/project/`.

## Plan of Work

### In Scope

One greeting command, one usage result, and Node tests.

### Out of Scope

Packaging, dependencies, styling, and additional commands.

## Milestones

1. Pure function returns both specified outputs.
2. Process entrypoint prints the result.
3. Tests pass.

## Concrete Steps

Create `cli.mjs`, export `runCli`, add the entrypoint guard, write two tests, and
run the example test command.

## Validation and Acceptance

Both named greeting and incomplete input behave exactly as specified.

### Test Commands

```bash
bun run test:examples
```

## Idempotence and Recovery

The implementation has no state or external effects beyond stdout.

## Artifacts and Notes

The completed code and tests remain checked in as a teaching fixture.

## Interfaces and Dependencies

`runCli(args: string[]): string`; Node built-ins only.
