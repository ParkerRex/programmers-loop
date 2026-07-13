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
timeouts before execution. Doctors must not mutate local authentication or
GitHub state.

Keep public artifacts free of credentials, personal filesystem paths, private
repository identifiers, internal codenames, and source-repository history.

## Does Not Own

- User-level provider authentication.
- Organization security policy.
- A future sandbox implementation beyond its required contract.

## Next

- [Reliability and proof](RELIABILITY.md)
- [Development workflow](DEVELOPMENT.md)
- [Runtime configuration](../programmers-loop.config.yaml)
