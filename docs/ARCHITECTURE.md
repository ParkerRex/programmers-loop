---
title: "Architecture"
summary: "Runtime modules, durable artifacts, adapters, and state boundaries."
status: active
read_when:
  - "Changing module ownership or persistent runtime behavior."
---

# Architecture

## Owns

- The boundary between checked-in planning truth and ignored runtime state.
- The dependency direction between contracts, loops, adapters, doctors, and the
  CLI.
- The rule that provider behavior stays behind `AgentAdapter`.

The runtime is a single Node package. Markdown and YAML contracts are parsed by
pure validators. Runtime loops depend on the provider-neutral adapter interface.
Codex is the first adapter, not a planning-contract dependency. Doctors inspect
local and GitHub readiness without mutation. Versioned run records belong under
ignored `.runtime/`.

Scaffold functions create repository-contained Assignment, Program, and
ExecPlan packets and validate lifecycle ownership before writing. Inventories
make every checked-in prompt and skill discoverable. Standup composes active
planning state with the same doctor report exposed directly by the CLI. The CLI
keeps agentic execution out of its command tree until a runtime loop can uphold
the documented safety contract.

```text
scaffolds -> contracts -> planning validators -> runtime loops -> AgentAdapter
                \------------> inventories -----> doctors -----> CLI
                                      \----------> standup ------/
```

## Does Not Own

- The required contents of an Assignment, Program, or ExecPlan.
- Development commands and landing proof.
- Provider authentication or user-level model configuration.

## Next

- [Documentation index](index.md)
- [Development workflow](DEVELOPMENT.md)
- [Planning model](PLANS.md)
