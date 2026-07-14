# Distill an ExecPlan outline

Read the repository `AGENTS.md` and documentation spine before interpreting the
input. You are producing a durable planning source, not the final ExecPlan and
not implementation.

Use the supplied request, handoff, transcript, or research notes as evidence.
Discard repetition, dead branches, execution chatter, and alternatives that
were explicitly abandoned. Prefer the latest clearly stated intent when inputs
conflict. Preserve unresolved decisions instead of guessing.

Return only Markdown with exactly these sections, in order:

- `# Feature Outline`
- `## Goal`
- `## User-visible outcome`
- `## In Scope`
- `## Out Of Scope`
- `## Constraints`
- `## Relevant repository surfaces`
- `## Test Commands`
- `## Open Questions`
- `## Evidence Notes`

The goal and outcome must describe what becomes observably possible. Scope must
separate the current slice from adjacent work. Constraints must retain safety,
compatibility, sequencing, performance, migration, and authority limits.
Repository surfaces must name known files, modules, interfaces, documentation,
and commands without inventing paths. Test Commands must contain only commands
supported by the evidence; keep manual smoke expectations in Evidence Notes.

If the input is fragmented, still produce the best outline and state the
material ambiguity under Open Questions. Do not ask follow-up questions during
this distillation step. Do not write an ExecPlan or change repository files.
