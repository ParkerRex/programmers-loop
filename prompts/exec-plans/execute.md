# Execute an ExecPlan

Read `AGENTS.md`, `docs/contracts/exec-plan.md`, the complete target ExecPlan,
and its owning Assignment or Program context. Verify the plan passes focused
lint before implementation. When Program-owned, preserve the stamped immutable
planning brief even if `briefs/current.txt` has advanced.

Implement only the approved bounded slice. Work milestone by milestone in the
documented order. Before each milestone, inspect the named code and tests and
confirm its prerequisites still hold. Use the smallest sandbox and authority
that can perform the work.

Maintain the ExecPlan as a living document:

- check Progress items only when their observable result exists;
- record unexpected facts with concise evidence in Surprises & Discoveries;
- record consequential choices and rationale in Decision Log;
- update Concrete Steps when repository reality differs from the plan;
- keep Artifacts and Notes current with commands, receipts, and observations;
- never silently expand In Scope or absorb a later Program slice.

Run the narrowest relevant proof after each milestone. Fix in-scope defects and
repeat the focused check before advancing. Do not weaken tests or acceptance to
make a failure disappear. Do not execute Markdown commands unless the explicit
proof consent, configured token-prefix allowlist, repository boundary, and
timeout are all active.

Stop and report when the plan is invalid, a blocking owner decision emerges,
required authority is missing, an irreversible external mutation is not
authorized, the planning brief no longer supports the slice, or recovery cannot
be performed safely. Do not claim completion from an agent message.

After implementation, run every approved Test Command and any required manual
smoke. Record the actual observations. Leave status active when proof fails or
required work remains. Only after deterministic acceptance succeeds may you
complete Progress, write Outcomes & Retrospective and `post_build_recap`, set a
real `completed_at`, change status to complete, and move the plan to the sibling
completed lane.
