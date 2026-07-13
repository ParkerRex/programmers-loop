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
are resolved from the repository root and may not escape it.

```text
demo
assignment create | lint
program create | lint | advance | child-plan
exec-plan create | lint | write | grill | execute | proof | validate | run
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

Agent commands preview by default and require `--execute` before any
workspace-write run. `program advance` performs one Program transition.
`program child-plan` resolves the current brief once, snapshots it, creates the
child plan, invokes the writer, validates the result, and supports idempotent
`--run-id` retries.

`exec-plan proof` previews extracted commands by default. With `--execute`, it
uses the configured token prefixes, repository root, timeout, and output bound,
then writes a receipt. `exec-plan validate --execute --proof` explicitly grants
both agent repair and deterministic command execution. `exec-plan run` composes
grill, execution, validation, and optional proof, stopping at the first
incomplete phase.

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
