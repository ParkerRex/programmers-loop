---
title: "Configuration"
summary: "Repository configuration for planning paths, agent adapters, GitHub diagnosis, and deterministic proof."
status: active
read_when:
  - "Installing Programmers Loop in a repository or changing runtime safety limits."
---

# Configuration

## Owns

- The schema and meaning of `programmers-loop.config.yaml`.
- Adapter, timeout, output, proof-prefix, planning-root, and GitHub settings.
- The distinction between package-manager choice and runtime choice.

The repository root is the nearest ancestor containing
`programmers-loop.config.yaml`. Every CLI path is resolved against that root.

```yaml
schema_version: 1
planning_root: docs/assignments
agent:
  adapter: codex
  command: codex
  run_timeout_ms: 3600000
  max_output_bytes: 1048576
  model: null
  profile: null
github:
  repository: owner/repository
proof:
  command_timeout_ms: 1800000
  max_output_bytes: 65536
  allowed_command_prefixes:
    - bun run
    - bun test
    - node --test
    - node --import tsx --test
    - git diff
    - git status
```

`agent.adapter` selects a provider-neutral implementation; `codex` is the
first built-in adapter. `model` and `profile` are optional pass-through values,
so the runtime never hardcodes a frontier model. Agent runs are killed at the
configured timeout and event output is bounded before it is retained.

`proof.allowed_command_prefixes` contains space-tokenized prefixes, not shell
fragments or substring patterns. Prefer an executable plus a narrow subcommand.
For example, `git diff` is materially safer than `git`. Shell interpreters are
reported as doctor failures. Each approved command is spawned directly at the
repository root without a shell.

`github.repository` is optional. It enables read-only remote diagnosis for
`doctor --github` and `standup --github`; it does not authorize GitHub mutation.

## Does Not Own

- Provider credentials or user-level agent configuration.
- Operating-system sandboxing for proof commands.
- Artifact schemas or repository-specific acceptance commands.

## Next

- [Architecture](ARCHITECTURE.md)
- [Command-line interface](CLI.md)
- [Reliability and proof](RELIABILITY.md)
- [Security model](SECURITY.md)
