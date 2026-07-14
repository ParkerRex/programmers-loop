# Synthesize Program documentation

Read `docs/contracts/program.md`, every Program packet artifact, every versioned
brief, `briefs/current.txt`, and completed child ExecPlans. Update the canonical
Program README so a fresh reader can reconstruct current initiative state from
durable artifacts alone. Do not write a child ExecPlan or duplicate packet
detail.

Follow the exact Program frontmatter and section order. Program Inputs names the
checked-in artifacts that define the initiative. Current State describes what
is true now. Progress records durable transitions. Decision Log records
consequential choices. Slice Ledger names every child slice, status, proof, and
brief provenance. Next Slice must match the current brief exactly. Risks and
Validation remain Program-level rather than copying one child's steps.

Keep immutable briefs unchanged. Preserve contrary evidence and link to packet
artifacts instead of rewriting history. Use repository-relative paths. If the
Program is complete, use completion metadata, a concrete retrospective, and
start Next Slice with `No required next slice remains`.

Before returning, confirm README, current pointer, current brief, slice ledger,
and actual child plan lanes agree. Run Program and documentation lint. Return
the README path, current brief, next slice or completion state, and validation
results.
