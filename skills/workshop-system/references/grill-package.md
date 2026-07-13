# Grill a systems package

Critique whether the normalized package is concrete enough for approval and a
later ExecPlan or Program. Do not add filler praise or smooth away uncertainty.

Return `verdict: awaiting_approval` when another operator can make the decision
without chat archaeology. Return `verdict: blocked` only when one high-impact
missing decision makes approval misleading; include the single question that
would unblock a fresh pass.

Check the real problem, boundaries, repository evidence, dependencies,
interfaces, failure modes, recovery, authority, validation commands, and choice
of Assignment, Program, or ExecPlan. Put required corrections and downstream
guidance into the handoff.
