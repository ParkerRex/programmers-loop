# Normalize a systems request

Qualify a rough coding-system or automation request for durable review. Do not
invent a live system or begin implementation.

Return `classification: blocked` plus one specific blocking question when the
request is too vague to approve safely. Otherwise return `classification:
draft_ready` and preserve:

- the concrete problem and desired user-visible outcome;
- current sources of truth and affected interfaces;
- explicit in-scope and out-of-scope boundaries;
- constraints, assumptions, dependencies, failure modes, and risks;
- evidence separated from inference;
- runnable test commands when a proof path is already known; and
- the next operational action.

Choose an ExecPlan only when one bounded implementation path is settled. Choose
a Program when research, convergence, ordering, or multiple slices remain.
