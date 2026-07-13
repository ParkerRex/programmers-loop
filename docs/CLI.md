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
assignment create | lint
program create    | lint
exec-plan create  | lint
planning lint
docs lint
standup
doctor
skills list
prompts list
```

`programmers-loop lint` is a compatibility alias for `planning lint`.
Scaffold commands are non-interactive, support `--dry-run` and `--json`, and
refuse to overwrite existing targets. Program scaffolds are structurally valid
but contain explicit evidence placeholders; they do not authorize execution.

Read-only commands send primary results to stdout. Diagnostics go to stderr.
Exit code `0` means success, `1` means a runtime or validation failure, and `2`
means invalid CLI usage. Human output may evolve; scripts should use `--json`.

The CLI does not yet expose agentic write, grill, execute, validate, or repair
commands. Those workflows remain in skills and prompts until safe proof
execution provides explicit consent, allowlists, containment, timeouts, and
receipts.

## Does Not Own

- Artifact field and section requirements.
- Agent-provider invocation or command-execution authority.
- Shell completion, publishing, or GitHub mutation.

## Next

- [Development workflow](DEVELOPMENT.md)
- [Planning model](PLANS.md)
- [Security model](SECURITY.md)
- [Skill index](skills/README.md)
