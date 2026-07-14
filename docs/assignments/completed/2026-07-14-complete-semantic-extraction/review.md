---
title: "Complete semantic extraction review"
summary: "Final source-to-project boundary review for the planning extraction."
status: complete
read_when:
  - "Checking whether reusable source planning behavior remains unextracted."
---

# Complete semantic extraction review

## Verdict

All reusable Assignment, Program, and ExecPlan mechanics found in the source
implementation are represented in the standalone project. The prior reduced
areas—prompt summaries, placeholder acceptance, weak packet validation,
ambient grill continuation, missing session/handoff input, omitted unlocks,
unverified Program mutation, and structural-only ExecPlan execution—are closed.

## Boundary

The source repository still owns its product UI, databases, workflow services,
training and rubric systems, provider credentials, deployment, release, hosted
status, project-board mutation, and application topology policy. Those are
consumer integrations or domain rules, not missing planning-loop behavior.
The standalone contracts expose generic lifecycle criteria, validation
commands, optional ownership context, and an `extensions` object for consumers
without importing product dependencies.

## Residual risk

The Codex adapter was verified through argument tests and the installed CLI's
`exec resume` help rather than a live mutating agent run. Provider behavior can
still evolve, but exact session ids, bounded output, explicit sandboxes, and
receipts keep that change isolated behind `AgentAdapter`.
