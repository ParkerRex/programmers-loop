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
planning state with the same doctor report exposed directly by the CLI.

ExecPlan workflows load checked-in prompts and call `AgentAdapter` for write,
grill, execute, and validation phases. The grill loop recognizes a deterministic
footer and bounds automatic recommended replies. Validation can run the proof
boundary after each repair pass. Program workflows perform one durable packet
transition at a time or create one idempotent child plan from a hashed snapshot
of the exact current brief.

Proof is deliberately separate from agent judgment. It extracts only fenced
commands under `Validation and Acceptance` → `Test Commands`, tokenizes them,
rejects shell syntax and escaping paths, compares exact token prefixes, and
spawns the executable directly at the repository root. Agent event output and
proof output are bounded. All attempted agent phases, Program transitions,
brief snapshots, and proof runs write ignored versioned records under
`.runtime/`.

```text
scaffolds -> contracts -> planning validators -> CLI
                \                    /              \
                 -> prompt inventory -> agent loops -> AgentAdapter
                                  \----> proof ------> direct process
contracts + doctors -------------> standup
agent loops + proof -------------> .runtime receipts
```

## Does Not Own

- The required contents of an Assignment, Program, or ExecPlan.
- Development commands and landing proof.
- Provider authentication or user-level model configuration.

## Next

- [Documentation index](index.md)
- [Configuration](CONFIGURATION.md)
- [Development workflow](DEVELOPMENT.md)
- [Extraction boundary](EXTRACTION.md)
- [Planning model](PLANS.md)
