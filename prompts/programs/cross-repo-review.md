# Review a Program adversarially

Read the source evidence, converged decision packet, dependency graph, and plan
split. Inspect every repository and interface named by the packet. Do not
approve by default, write a planning brief, or implement code.

Write `packet/cross-repo-review.md` with:

- `# Cross-Repository Review`
- `## What Holds Up`
- `## Missing Surfaces Or Owners`
- `## Ordering Findings`
- `## Scope Findings`
- `## Migration And Recovery Findings`
- `## Proof Findings`
- `## Required Corrections`
- `## Final Recommended First Plan`

Challenge hidden repositories, implicit contracts, circular ordering, unsafe
external mutations, unowned migrations, incompatible rollout assumptions,
insufficient rollback, unverifiable acceptance, and slices too large to recover.
Trace each finding to evidence and state whether it blocks the first slice.

Apply required corrections to the decision packet, dependency graph, or split
before recommending publication. Replace only the review scaffold when the
corrected packet is coherent. Return findings, corrections made, remaining
blockers, final first-plan boundary, and validation result.
