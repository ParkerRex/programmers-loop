# Synchronize docs after a Program slice

Read `docs/index.md`, the Program README, current brief, completed or validated
child ExecPlan, implementation diff, validation receipt, and the durable docs
that own changed behavior. Do not start the next ExecPlan or publish the next
planning brief.

For every behavior changed by the child, identify the single owning durable
surface. Update precise README, contract, architecture, operations, or package
documentation only when it became stale. Do not create duplicate truth, copy
the child plan into docs, or document behavior that deterministic proof did not
establish. When no doc change is appropriate, record the reason.

Update the completed child ExecPlan with docs synced, intentionally unchanged
surfaces, and remaining debt. Update the Program Slice Ledger only when the
validated child result and receipt are available. Preserve historical brief
content and `planning_brief` provenance.

Run focused Markdown lint, repository docs validation when routing or generated
indexes may be affected, and Program lint when the README changed. Return docs
updated, owning rationale, validation results, and unresolved documentation
debt.
