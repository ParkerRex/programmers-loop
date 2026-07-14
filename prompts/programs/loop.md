# Run the complete Program loop

Operate one Program entirely through checked-in artifacts. Validate before and
after every transition. Persist one transition and return; repeated invocations
advance the loop. Never use chat history as the canonical state.

Planning sequence:

1. Initialize the Program and source inventory.
2. Funnel inputs into independent research questions.
3. Run each research pass without cross-track convergence.
4. Normalize vocabulary, facts, conflicts, and source mappings.
5. Write the converged decision packet.
6. Build the dependency graph.
7. Recommend bounded vertical ExecPlan slices.
8. Perform adversarial cross-repository review and corrections.
9. Publish the immutable current planning brief.
10. Create, grill, execute, prove, and validate exactly one child ExecPlan.
11. Sync owning durable docs after observed behavior changes.
12. Publish a new planning refresh and update the Program README.
13. Select the next child slice or perform completion review.

The child ExecPlan must preserve the exact brief revision from which it was
written. Validation must precede docs sync; docs sync must precede planning
refresh. Never rewrite a completed child's provenance when the current pointer
advances. Never author the next child plan during refresh.

Pause on invalid durable state, unresolved owner decisions, missing authority,
failed proof, unsafe recovery, inconsistent pointer state, or a transition that
would cross multiple artifact classes. Completion requires no active child
plans, no required next slice, current docs and packet truth, concrete proof,
completion metadata, retrospective, and a move to the completed Program lane.
