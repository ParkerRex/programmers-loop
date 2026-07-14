# Build a Program dependency graph

Read the converged decision packet and normalized evidence. Turn approved
capabilities into a safe implementation order. Do not split by team, file type,
or horizontal layer when that would prevent an independently useful result.

Write `packet/dependency-graph.md` with:

- `# Dependency Graph`
- `## Nodes`
- `## Dependency Order`
- `## Critical Path`
- `## Parallel Work`
- `## Interface Boundaries`
- `## Unsafe Orders To Avoid`
- `## Verification Boundaries`

For every node, name its purpose, prerequisites, outputs, state owner, affected
interfaces, failure boundary, and observable proof. Distinguish a hard
prerequisite from a convenient sequence. Identify cycles explicitly and resolve
them through a seam, spike, or smaller capability rather than hiding them.

Replace only the dependency-graph scaffold. Return the ordered nodes, critical
path, safe parallelism, unresolved cycles, and validation result.
