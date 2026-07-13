---
title: "Add safe deterministic proof execution"
status: complete
created_at: 2026-07-13
completed_at: 2026-07-13
summary: "Extract approved test commands from ExecPlans and run them inside an explicit repository safety boundary."
post_build_recap: "Added explicit-consent proof preview and direct execution, bounded process output and timeouts, stable command snapshots across repair attempts, atomic JSON receipts, CLI and configuration surfaces, doctor checks, tests, and security documentation."
read_when:
  - "Implementing the next Programmers Loop runtime slice."
---

# Add safe deterministic proof execution

## Purpose / Big Picture

Close the loop between a well-formed ExecPlan and observable acceptance without
letting Markdown silently become unrestricted shell authority.

## Progress

- [x] Specify command extraction and consent contracts.
- [x] Implement preview and allowlist validation.
- [x] Implement bounded execution and versioned receipts.
- [x] Add repair-attempt integration to `AgentAdapter`.
- [x] Test rejection, timeout, failure, success, and recovery paths.

## Surprises & Discoveries

The source implementation passes complete Markdown commands to `$SHELL -lc`.
The public runtime needs a smaller and more visible trust boundary.

Direct process spawning also makes the permitted command grammar teachable:
quotes and arguments are retained, while shell chaining, substitution,
redirection, environment prefixes, and continuations have no implicit path to
execution. Integrated repair must retain the exact initially approved command
set; if an agent edits it, the runtime blocks for a new preview and consent.

## Decision Log

- Require an explicit execution flag after showing the extracted commands.
- Match commands against tokenized configured prefixes, not string substrings.
- Require the working directory and receipt path to stay inside the repository.
- Avoid a shell where direct process execution can represent the command.
- Bound both agent and proof output before it reaches durable runtime records.
- Treat a changed command set as new authority, even when the replacement also
  matches the allowlist.

## Outcomes & Retrospective

Implemented the complete deterministic proof boundary and exercised it through
the public CLI. The real plan preview allowed all three acceptance commands;
the executed run passed and wrote
`.runtime/proof/proof-2026-07-13T19-09-47.575Z-7cfc3b47.json`.

The final design is intentionally smaller than a shell parser. Users who need
pipelines or setup scripts should expose a reviewed package script and approve
that narrow prefix instead of embedding shell authority in Markdown.

## Context and Orientation

ExecPlan validation is in `src/contracts/exec-plan.ts`. Process execution is in
`src/process.ts`. Proof settings are versioned in
`programmers-loop.config.yaml`. Agent repair uses `src/agents/`.

## Plan of Work

### In Scope

- Extract test commands from the required Markdown subsection.
- Preview, consent, prefix allowlist, repository containment, and timeout.
- Sequential execution with bounded stdout and stderr.
- Versioned JSON receipt for every attempted proof run.
- Bounded agent repair attempts that retain the same approved command set.

### Out of Scope

- General-purpose shell scripts or arbitrary pipelines.
- GitHub status publication.
- Program orchestration and Assignment generators.
- Remote, container, or hosted execution.

## Milestones

1. Unsafe or malformed commands are rejected before spawning a process.
2. Approved commands run sequentially and stop on the first failure.
3. Every attempt writes a redacted, versioned receipt.
4. A configured bounded repair loop can rerun the same proof set.

## Concrete Steps

1. Define proof command, policy, result, and receipt types.
2. Parse shell fences without evaluating substitutions or redirects.
3. Validate prefixes, working directory, timeout, and explicit consent.
4. Extend the CLI with `exec-plan proof --path <path> --execute`.
5. Persist atomic receipts under `.runtime/proof/`.
6. Add focused tests and document the security model.

## Validation and Acceptance

The executor must reject unapproved prefixes, chaining, substitution,
redirection, and paths that escape the repository. Passing commands must retain
their exit codes and bounded output in a receipt.

### Test Commands

```bash
bun run test
bun run planning:lint
bun run check
```

## Idempotence and Recovery

Each run uses a unique receipt id. Failed commands do not mutate policy or the
approved command set. Re-running requires a new explicit execution invocation.

## Artifacts and Notes

Threat cases are covered in `test/proof.test.ts` and
`test/workflows.test.ts`. Runtime and configuration behavior is documented in
`docs/RELIABILITY.md`, `docs/SECURITY.md`, and `docs/CONFIGURATION.md`.

## Interfaces and Dependencies

Use Node process primitives and existing YAML configuration. Do not add a shell
parser dependency until concrete syntax requirements exceed the safe minimal
grammar.
