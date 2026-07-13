---
title: "Add safe deterministic proof execution"
status: active
created_at: 2026-07-13
completed_at: null
summary: "Extract approved test commands from ExecPlans and run them inside an explicit repository safety boundary."
post_build_recap: null
read_when:
  - "Implementing the next Programmers Loop runtime slice."
---

# Add safe deterministic proof execution

## Purpose / Big Picture

Close the loop between a well-formed ExecPlan and observable acceptance without
letting Markdown silently become unrestricted shell authority.

## Progress

- [ ] Specify command extraction and consent contracts.
- [ ] Implement preview and allowlist validation.
- [ ] Implement bounded execution and versioned receipts.
- [ ] Add repair-attempt integration to `AgentAdapter`.
- [ ] Test rejection, timeout, failure, success, and recovery paths.

## Surprises & Discoveries

The source implementation passes complete Markdown commands to `$SHELL -lc`.
The public runtime needs a smaller and more visible trust boundary.

## Decision Log

- Require an explicit execution flag after showing the extracted commands.
- Match commands against tokenized configured prefixes, not string substrings.
- Require the working directory and receipt path to stay inside the repository.
- Avoid a shell where direct process execution can represent the command.

## Outcomes & Retrospective

Pending implementation and proof.

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
4. Extend the CLI with `exec-plan proof --plan <path> --execute`.
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

Document threat cases alongside tests so cheaper models receive deterministic
guardrails rather than relying on prompt compliance.

## Interfaces and Dependencies

Use Node process primitives and existing YAML configuration. Do not add a shell
parser dependency until concrete syntax requirements exceed the safe minimal
grammar.
