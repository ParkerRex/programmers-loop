# Recommend Program ExecPlan slices

Read the converged packet and dependency graph. Produce the smallest sequence of
end-to-end ExecPlans that can each create and prove a useful behavior. Do not
write any child ExecPlan yet.

Write `packet/plan-split-recommendation.md` with:

- `# Plan Split Recommendation`
- `## Recommended Number Of Plans`
- `## Slice Summaries`
- `## Dependency Order`
- `## First Plan To Write`
- `## Boundaries Between Plans`
- `## Deferred Or Optional Work`
- `## Unsafe Consolidations`

For each slice state the exact purpose, user-visible or operational outcome,
in-scope and out-of-scope work, prerequisites, interfaces, migration or recovery
needs, focused acceptance commands, and what the slice unlocks. Keep later
slices out of the first merely because adjacent files are touched.

Prefer vertical capabilities over database-only, API-only, or UI-only layers
that cannot be independently demonstrated. Replace only the split scaffold and
return the first recommended plan, total slice count, boundary risks, and
validation result.
