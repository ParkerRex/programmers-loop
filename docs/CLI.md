---
title: "Command-Line Interface"
summary: "Stable commands, output modes, safety behavior, and exit codes."
status: active
read_when:
  - "Using, scripting, or changing the Programmers Loop CLI."
---

# Command-Line Interface

## Owns

- The public noun-first command tree and option grammar.
- Human and JSON output, stdout and stderr behavior, and exit codes.
- Scaffold preview, overwrite refusal, and repository-contained paths.

Use `programmers-loop --help` for terminal documentation and
`programmers-loop help <noun> <verb>` for a command. Paths supplied to commands
are resolved from the repository root and may not escape it. The explicit
`--session-jsonl` and `--handoff` outline inputs are read-only exceptions so a
user can select an exact local handoff source; output still stays in the repo.

```text
demo
assignment create | lint
program create | lint [--ready] | advance | child-plan
exec-plan create | lint | outline | write | grill | execute | proof | validate | run
planning lint
docs lint
standup
doctor
skills list
prompts list
```

`demo` is a read-only 60-second tour. It runs local diagnosis, validates the
bundled completed example, previews its allowlisted proof command, and suggests
the next command to try. It supports `--json` and never invokes an agent,
executes proof, or writes repository state.

`programmers-loop lint` is a compatibility alias for `planning lint`.
Scaffold commands are non-interactive, support `--dry-run` and `--json`, and
refuse to overwrite existing targets. Program scaffolds are structurally valid
but contain explicit evidence placeholders; they do not authorize execution.
Use `program lint --ready` to check the stronger execution-readiness contract.
Program-owned ExecPlan creation and `program child-plan` enforce that contract
automatically. ExecPlan scaffolds are also structurally valid placeholders;
`exec-plan lint --ready` and every post-write agent phase reject untouched
scaffold guidance.

Agent commands preview by default and require `--execute` before any mutation.
`exec-plan outline` accepts repository notes, exact Codex session JSONL, or a
versioned workshop handoff. It normalizes and bounds the selected source, runs
an agent read-only, and writes only its validated output artifact after consent.
`program advance` snapshots durable Program state and
accepts one artifact-class transition, recording changed paths in its receipt.
`program child-plan` resolves the current brief once, snapshots it, creates the
child plan, invokes the writer, validates the result, and supports idempotent
`--run-id` retries. Scaffold placeholders, stale Program summaries, ambiguous
current pointers, and briefs without the complete convergence and exact next-
plan sections are rejected before invocation.

`exec-plan proof` previews extracted commands by default. With `--execute`, it
uses the configured token prefixes, repository root, timeout, and output bound,
then writes a receipt. `exec-plan validate --execute --proof` explicitly grants
both agent repair and deterministic command execution. `exec-plan run` composes
optional outline-driven writing, grill, execution, validation, and optional
proof, stopping at the first incomplete phase. Without `--outline` or
`--handoff`, the plan must already pass readiness validation. `exec-plan write`
and `exec-plan run` accept a versioned `--handoff` directly as writer input.

`standup` is read-only. It reports the current Assignment lifecycle segment and
blockers, each active Program's current brief and Next Slice, each active
ExecPlan's first unchecked Progress item, and doctor health.

Read-only commands send primary results to stdout. Diagnostics go to stderr.
Exit code `0` means success, `1` means a runtime or validation failure, and `2`
means invalid CLI usage. Human output may evolve; scripts should use `--json`.

Runtime receipts are stable JSON under ignored `.runtime/`; checked-in plans
remain the durable source of planning truth. Use `--json` for automation and
inspect `status`, `message`, and `receiptPath` before advancing.

## Does Not Own

- Artifact field and section requirements.
- Agent-provider invocation or command-execution authority.
- Shell completion, publishing, or GitHub mutation.

## Next

- [Configuration](CONFIGURATION.md)
- [Development workflow](DEVELOPMENT.md)
- [Planning model](PLANS.md)
- [Security model](SECURITY.md)
- [Skill index](skills/README.md)
