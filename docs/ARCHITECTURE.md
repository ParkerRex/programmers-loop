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
footer, preserves the exact provider session across automatic replies, and
bounds those replies. The outline input layer normalizes repository notes, exact
Codex session JSONL, or a versioned workshop handoff. The outline phase runs
read-only and persists only validated Markdown. Structural validity and
execution readiness keep an untouched plan scaffold out of later phases.
Validation can run the proof boundary after each repair pass. Program workflows
perform one durable packet
transition at a time or create one idempotent child plan from a hashed snapshot
of the exact current brief.

Structural Program validity and execution readiness are separate contracts.
This permits one-transition research over explicit scaffold markers without
letting those markers authorize a child plan. Program advance snapshots file
content before and after the agent run, rejects no-op or multi-stage success,
protects historical brief bodies, and records the accepted transition plus
changed paths.

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
