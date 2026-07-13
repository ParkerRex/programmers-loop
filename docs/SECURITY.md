---
title: "Security"
summary: "Trust boundaries for agents, Markdown commands, GitHub, paths, and public content."
status: active
read_when:
  - "Changing command execution, adapters, GitHub access, or publication."
---

# Security

## Owns

- The separation between valid planning documents and command authority.
- Least-privilege agent sandbox requirements.
- Repository containment, public-content hygiene, and read-only diagnosis.

Never treat a Markdown command block as execution consent. Agent runs use an
explicit sandbox and never use bypass flags. Commands must be previewed and
checked against configured token prefixes, working-directory containment, and
timeouts before execution. The proof runtime does not use a shell and rejects
operators, pipes, redirections, substitution, environment prefixes, unfinished
quotes, continuations, home paths, and repository escapes. Output is bounded,
and shell interpreters in proof prefixes fail the local doctor.

The allowlist is still authority, not a sandbox: an approved executable and
subcommand run with the user's operating-system permissions. Prefer narrow
two-token or longer prefixes, review the preview, and use an OS-level sandbox
when the command itself processes untrusted code. `git diff` is safer than
`git`; a bare runtime executable authorizes every one of its subcommands.

Doctors must not mutate local authentication or GitHub state. Program brief
snapshots and run receipts remain inside ignored `.runtime/`; user-supplied
paths are checked lexically and through real paths before reads or writes.

Keep public artifacts free of credentials, personal filesystem paths, private
repository identifiers, internal codenames, and source-repository history.

## Does Not Own

- User-level provider authentication.
- Organization security policy.
- Operating-system sandboxing for deterministic proof commands.

## Next

- [Reliability and proof](RELIABILITY.md)
- [Development workflow](DEVELOPMENT.md)
- [Configuration](CONFIGURATION.md)
- [Runtime configuration](../programmers-loop.config.yaml)
