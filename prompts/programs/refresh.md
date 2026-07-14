# Refresh a Program

Use this only after one child ExecPlan is validated and durable docs are synced.
Read the current pointer and brief, Program README, reviewed packet, completed
child plan, proof receipt, and docs-sync result. Do not author the next child
ExecPlan or rewrite historical brief bodies.

Determine N from `briefs/current.txt`. Write
`briefs/planning-brief-<N+1>.md` with required frontmatter and exactly these body
sections:

- `# <refresh title>`
- `## What Changed`
- `## What Still Holds`
- `## Boundary Changes`
- `## Dependency Changes`
- `## Next Plan Recommendation`
- `## Risks To Carry Forward`

State observed facts from the completed slice, decisions that remain valid,
scope or ordering changes, the exact next title and boundary, acceptance proof,
and carried risks. If no required child remains, say so explicitly and route to
completion review.

Write the new brief completely, change only the previous brief's status from
current to superseded, and atomically update `briefs/current.txt`. Then update
Program Current State, Progress, Slice Ledger, Next Slice, Risks, Validation,
and Artifacts so they agree with the new brief. Do not relitigate still-valid
decisions or alter completed child provenance.

Run Program lint and confirm old brief, new brief, pointer, README, slice ledger,
and next-slice boundary agree. Return old and new brief paths, changed Program
sections, next recommendation, and validation results.
