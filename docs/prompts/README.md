---
title: "Prompt Index"
summary: "Canonical routes to executable Program and ExecPlan prompt assets."
status: active
read_when:
  - "Changing an agent loop or its prompt contract."
---

# Prompt Index

## Owns

- The inventory and ownership route for checked-in runtime prompt assets.
- The rule that prompt copies must not become parallel sources of truth.

ExecPlan prompts cover [write](../../prompts/exec-plans/write.md),
[grill](../../prompts/exec-plans/grill.md),
[execute](../../prompts/exec-plans/execute.md), and
[validate](../../prompts/exec-plans/validate.md). Program prompts cover
[orchestration](../../prompts/programs/orchestrate.md),
[research](../../prompts/programs/research.md),
[convergence](../../prompts/programs/converge.md), and
[refresh](../../prompts/programs/refresh.md).

## Does Not Own

- Artifact schemas, which remain canonical in the contracts.
- Provider invocation or model selection.
- User-specific prompt customization.

## Next

- [ExecPlan contract](../contracts/exec-plan.md)
- [Program contract](../contracts/program.md)
- [Run ExecPlan skill](../../skills/run-exec-plan/SKILL.md)
- [Run Program skill](../../skills/run-program/SKILL.md)
