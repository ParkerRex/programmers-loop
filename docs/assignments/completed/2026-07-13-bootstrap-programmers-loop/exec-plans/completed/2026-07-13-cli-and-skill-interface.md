---
title: "Add the CLI and skill interface"
status: complete
created_at: 2026-07-13
completed_at: 2026-07-13
summary: "Expose the portable lifecycle through deterministic CLI commands and concise reusable agent skills."
post_build_recap: "Added a noun-first CLI, safe artifact scaffolds, focused validators, standup and inventory commands, four portable skills, synchronized docs, and regression coverage."
read_when:
  - "Building or reviewing the public Programmers Loop interface."
---

# Add the CLI and skill interface

## Purpose / Big Picture

Make every durable Programmers Loop operation discoverable without requiring a
frontier model to reconstruct repository conventions. Humans and agents should
be able to scaffold and lint planning artifacts, inspect current work, find the
right prompt or skill, and diagnose the repository through one stable CLI.

## Progress

- [x] Inventory the existing commands, prompts, templates, and skills.
- [x] Define and implement the noun-first command tree.
- [x] Add safe artifact scaffolds and a read-only standup view.
- [x] Add the missing portable operating skills.
- [x] Enforce synchronization across command help, docs, prompts, and skills.
- [x] Run the full Bun proof and archive this plan.

## Surprises & Discoveries

The first foundation exposed only aggregate planning lint, docs lint, and
doctor commands. Templates for Program and ExecPlan were placeholders, so
artifact creation was not yet a usable interface. A Bun-policy audit correctly
flags `NodeNext` and `tsx` as non-Bun runtime choices; they are intentional
because Bun owns package plumbing while Node remains the public runtime.

## Decision Log

- Use noun-first commands: `assignment`, `program`, `exec-plan`, `docs`,
  `planning`, `skills`, and `prompts`.
- Keep `lint` as a compatibility alias for `planning lint`.
- Reserve exit code 2 for invalid CLI usage and exit code 1 for an operation or
  validation failure.
- Make scaffolding non-interactive, refuse overwrites, and support `--dry-run`.
- Keep agentic write, grill, execute, and validate behavior in skills and
  prompts until the safe executor implements those runtime guarantees.

## Outcomes & Retrospective

The repository now exposes safe creation and focused lint for every durable
artifact, canonical planning and docs lint, a read-only standup that composes
active state with doctor health, and skill and prompt inventories. Four new
skills cover system workshop, docs maintenance, standup, and verification. Help,
version, JSON output, exit codes, lifecycle boundaries, path containment,
overwrite refusal, and Program brief pinning have regression coverage.

## Context and Orientation

The CLI entrypoint is `src/cli.ts`. Artifact validators live in
`src/contracts/`, aggregate lint in `src/lint.ts`, doctors in `src/doctor/`,
prompt assets in `prompts/`, skill assets in `skills/`, and public routes under
`docs/`.

### In Scope

- Help, version, JSON output, stable exit codes, and invalid-usage handling.
- Artifact create and focused lint commands.
- Read-only standup, skill inventory, and prompt inventory commands.
- Skills for system workshop, docs maintenance, standup, and verification.
- CLI reference documentation and synchronization tests.

### Out Of Scope

- Automatic agent execution, proof-command execution, or repair loops.
- GitHub mutation, hosted automation, telemetry, shell completion, or release.
- Replacing the AgentAdapter or Program state-machine slices.

This ExecPlan must be maintained in accordance with `docs/contracts/exec-plan.md`.

## Plan of Work

Follow the milestones in order, keeping progress, decisions, discoveries, and proof current as the work proceeds.

## Milestones

1. Help exposes every supported command and recovery path.
2. Generated Assignment, Program, and ExecPlan artifacts pass focused lint.
3. Standup and inventory commands are read-only and machine-readable.
4. Every checked-in skill and prompt is routed and validated.

## Concrete Steps

1. Add shared CLI parsing, help, output, path-safety, and exit-code utilities.
2. Add generators for valid Assignment, Program, and ExecPlan scaffolds.
3. Add focused lint, standup, and inventory modules.
4. Initialize and write the four new skills with interface metadata.
5. Add the command reference and update all documentation routes.
6. Add unit and command-level contract tests.
7. Run formatting, lint, types, tests, examples, build, docs, planning, and
   doctor checks.

## Validation and Acceptance

The repository check must pass. Tests must demonstrate help/version behavior,
exit-code separation, dry-run and overwrite safety, valid generated artifacts,
read-only standup output, and complete skill/prompt inventories.

### Test Commands

```bash
bun run test
bun run docs:lint
bun run planning:lint
bun run check
```

## Idempotence and Recovery

Lint, standup, inventory, help, version, and doctor commands are read-only.
Scaffold commands preflight every path, use exclusive writes, refuse existing
targets, and provide `--dry-run` for preview. A partial scaffold can be removed
and safely recreated before work begins.

## Artifacts and Notes

Treat help text and JSON fields as public contracts. Keep human output concise
and send diagnostics to stderr.

## Interfaces and Dependencies

Use Node 24 built-ins for argument parsing, filesystem operations, and tests;
use YAML for metadata serialization and Bun for package management and script
launching. Do not add another runtime dependency.
