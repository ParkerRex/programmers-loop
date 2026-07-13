---
name: workshop-system
description: "Shape an ambiguous coding-system request before creating Programmers Loop artifacts. Use when scope, source of truth, dependencies, failure modes, proof, or the choice between a Program and one ExecPlan is still unclear."
---

# Workshop System

Use [Normalize Request](references/normalize-request.md) to qualify raw input
and [Grill Package](references/grill-package.md) before approving a handoff.

1. Read `docs/index.md`, the normalization reference, and the repository
   surfaces named by the user.
2. State the desired outcome, current source of truth, affected interfaces,
   dependencies, non-goals, failure modes, and observable proof.
3. Separate known evidence from assumptions and decisions still requiring an
   owner.
4. Choose one bounded ExecPlan when the implementation path is settled. Choose
   a Program when research, convergence, cross-surface ordering, or multiple
   slices remain.
5. Produce a reviewable package with explicit scope, non-goals, assumptions,
   risks, proof, and one blocking question when approval would otherwise be
   misleading.
6. Grill the package using the canonical reference. Preview the proposed
   container with `programmers-loop assignment create --dry-run`; add a Program
   or ExecPlan only after the boundary is credible.
7. Stop at a decision-ready brief when the user requested research only.

Do not manufacture certainty from chat history. Record material decisions in
the durable Assignment, Program packet, or ExecPlan that owns them.
