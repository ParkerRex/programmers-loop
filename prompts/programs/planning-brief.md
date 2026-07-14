# Publish a Program planning brief

Read `docs/contracts/program.md`, the complete reviewed packet, every normalized
pass needed to resolve details, and `briefs/current.txt`. Do not write an
ExecPlan or implement code.

For the first brief, write `briefs/planning-brief-1.md`. For a refresh, determine
N from the current pointer and write only `planning-brief-<N+1>.md`. Use required
frontmatter with the stable Program id, positive version, `status: current`, and
an execution-facing summary. Change the prior current brief only from `current`
to `superseded`; never rewrite its body or provenance.

The first planning brief body uses exactly:

- `# <brief title>`
- `## Goal`
- `## Converged Decisions`
- `## Open Questions`
- `## Final Plan Split`
- `## Final Dependency Order`
- `## First ExecPlan To Write`
- `## Why This First`

The First ExecPlan section must name an exact title, scope, boundaries,
interfaces, dependencies, acceptance commands, recovery expectations, and risks
to carry. It must be sufficient for the ExecPlan writer without chat history.

Write the complete new brief first. Then supersede the prior brief when needed
and update `briefs/current.txt` to contain exactly the new filename and one
newline. Never point at a partial brief or mutable alias. Run Program lint and
execution-readiness validation. Return old and new brief paths, pointer contents,
first child recommendation, and validation results.
