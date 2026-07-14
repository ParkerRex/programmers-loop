---
title: "Build the portable Programmers Loop foundation"
status: complete
created_at: 2026-07-13
completed_at: 2026-07-13
summary: "Create a public-safe Node foundation with planning contracts, validators, an agent interface, doctors, and skills."
post_build_recap: "Created a Node-only repository with checked-in contracts, portable validators, an agent interface and Codex adapter, local and GitHub doctors, five validated skills, prompt seeds, and a fully checked neutral example."
read_when:
  - "Implementing or reviewing the initial Programmers Loop extraction."
---

# Build the portable Programmers Loop foundation

## Purpose / Big Picture

Create a small, teachable runtime that helps coding agents maintain reliable
long-running work through checked-in Assignments, Programs, ExecPlans, critique,
and deterministic proof.

## Progress

- [x] Choose the corrected project name and a fresh repository.
- [x] Define the compatibility boundary and Node toolchain.
- [x] Add the canonical planning contracts and bootstrap Assignment.
- [x] Finish portable validators and their tests.
- [x] Finish the agent interface and Codex adapter.
- [x] Finish local and GitHub doctor lanes.
- [x] Add concise skills, prompts, templates, and a neutral Program example.

## Surprises & Discoveries

- The source Program pipeline is primarily a prompt-described state machine;
  only immutable child-plan generation is implemented as runtime behavior.
- The source Assignment validator mostly enforces legacy, product-specific
  lifecycle bundles. The readable schema is a much smaller stable contract.

## Decision Log

- Use Node 24+, ESM TypeScript, Bun package management, Oxlint, Oxfmt, and
  Node's test runner.
- Preserve the readable Assignment schema while replacing person-specific
  statuses with `needs_owner`.
- Keep providers behind `AgentAdapter`; ship a Codex CLI adapter first.
- Implement both local and GitHub diagnosis, but keep all doctor behavior
  read-only.
- Start with fresh Git history and no license until the owner chooses one.

## Outcomes & Retrospective

The repository now dogfoods all three planning layers and passes formatting,
lint, typechecking, eight runtime tests, two example acceptance tests, build,
planning lint, and local diagnosis. GitHub diagnosis correctly reports a
missing remote as a warning. Safe proof execution and the resumable Program
state machine remain the next bounded implementation slices.

## Context and Orientation

Contracts live in `docs/contracts/`. Runtime code lives in `src/`. Checked-in
skills live in `skills/`. Resumable technical state belongs in ignored
`.runtime/` and uses versioned JSON or JSONL.

### In Scope

- Project scaffold and public documentation.
- Assignment, Program, and ExecPlan validators.
- Provider-neutral agent interface and Codex CLI adapter.
- Read-only local and GitHub doctors.
- Skills, prompt seeds, templates, and tests.

### Out Of Scope

- Publishing to GitHub or npm.
- Removing the source repository implementation.
- GitHub mutations or Project field automation.
- Executing proof commands from Markdown in this first slice.
- A web interface or hosted service.

This ExecPlan must be maintained in accordance with `docs/contracts/exec-plan.md`.

## Plan of Work

Follow the milestones in order, keeping progress, decisions, discoveries, and proof current as the work proceeds.

## Milestones

1. Contracts and metadata parsing pass focused tests.
2. Planning lint discovers and validates checked-in packets.
3. The Codex adapter builds safe non-interactive arguments behind the common
   interface.
4. Local and GitHub doctor output is deterministic and machine-readable.
5. Skills validate and the repository passes its full local check.

## Concrete Steps

1. Implement frontmatter and YAML parsing with explicit errors.
2. Implement path-scoped validators and discovery.
3. Implement process execution without shell interpolation.
4. Implement `AgentAdapter` and Codex argument construction.
5. Implement local and GitHub doctor checks.
6. Add CLI routing, tests, prompts, templates, and skills.
7. Run formatting, lint, typecheck, tests, build, planning lint, and doctors.

## Validation and Acceptance

The repository is acceptable when the full check passes, the CLI validates its
own bootstrap Assignment and ExecPlan, local doctor passes, and GitHub doctor
reports the absence of a remote as a warning rather than mutating anything.

### Test Commands

```bash
bun run planning:lint
bun run doctor
bun run doctor:github
bun run check
```

## Idempotence and Recovery

All checks are read-only. Re-running installation or validation is safe. Agent
output and future run records must use unique paths under `.runtime/`. If a
partial scaffold fails, retain valid files and rerun the narrowest failed step.

## Artifacts and Notes

- Canonical contracts: `docs/contracts/`
- Runtime configuration: `programmers-loop.config.yaml`
- Bootstrap packet: this Assignment

## Interfaces and Dependencies

Node and Git are required. GitHub diagnosis additionally needs `gh`. The Codex
adapter needs `codex` only when selected. YAML is the sole runtime package
dependency. Agent adapters return normalized results and never expose provider
process details to planning contracts.
