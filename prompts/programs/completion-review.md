# Review Program completion

Read `docs/contracts/program.md`, the Program README, every versioned brief,
current pointer, reviewed packet, all child ExecPlans, proof receipts, docs-sync
results, and explicit deferrals. Do not implement code or mark completion from
an agent claim.

Completion criteria:

- the initiative-level observable outcome has landed;
- no required child ExecPlan remains;
- every child is complete or intentionally abandoned with rationale;
- no active child plan remains in `exec-plans/active/`;
- the latest brief and README agree that no required next slice remains;
- validation receipts support every completion claim;
- durable docs and packet artifacts reflect final behavior;
- remaining work is explicitly outside this Program.

If evidence is insufficient, keep the Program active and update Next Slice or
the blocker honestly. Do not move the folder.

If completion is supported, set README status to complete, use a real
`completed_at`, write a concrete `post_build_recap`, fill Outcomes &
Retrospective with what changed and what was learned, and start Next Slice with
`No required next slice remains`. Move the entire Program directory from its
`programs/active/` lane to the sibling `programs/completed/` lane. Preserve all
briefs, packet evidence, child plans, and receipts; do not delete history.

Run Program lint before and after the move plus documentation validation. Return
the completion verdict `complete` or `not complete`, old and new Program paths,
evidence, retrospective changes, remaining work, and validation results.
