---
title: "Development"
summary: "Local setup, commands, testing, formatting, linting, and verification."
status: active
read_when:
  - "Changing code, documentation, prompts, skills, or package configuration."
---

# Development

## Owns

- The supported local toolchain and command surface.
- The narrow-to-full verification order.
- The distinction between source tests, example proof, and repository doctors.

Use Node 24 or newer as the compatibility runtime and Bun 1.3.14 as the sole
package manager and script launcher. Run the narrowest relevant test while
developing. Use `bun run docs:lint` for documentation,
`bun run planning:lint` for planning artifacts, and `bun run check` for the full
local proof.

```bash
bun install
bun run fmt
bun run test
bun run test:examples
bun run docs:lint
bun run planning:lint
bun run standup
bun run doctor:github
bun run check
```

`bun run check` performs formatting, source lint, typechecking, runtime tests,
example tests, compilation, both documentation and planning validation, and the
local doctor. GitHub diagnosis remains a separate read-only command because a
fresh repository may intentionally have no remote.

## Does Not Own

- Planning artifact schemas.
- Runtime security policy.
- GitHub repository creation, publication, or release policy.

## Next

- [Command-line interface](CLI.md)
- [Reliability and proof](RELIABILITY.md)
- [Prompt index](prompts/README.md)
- [Skill index](skills/README.md)
