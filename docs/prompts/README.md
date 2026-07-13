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

ExecPlan prompts cover
[outline](../../prompts/exec-plans/outline.md),
[write](../../prompts/exec-plans/write.md),
[grill](../../prompts/exec-plans/grill.md),
[execute](../../prompts/exec-plans/execute.md),
[validate](../../prompts/exec-plans/validate.md), and the complete
[workflow](../../prompts/exec-plans/workflow.md).

Program prompts cover
[initialization](../../prompts/programs/initialize.md),
[input funneling](../../prompts/programs/funnel.md),
[research](../../prompts/programs/research.md),
[normalization](../../prompts/programs/normalize.md),
[convergence](../../prompts/programs/converge.md),
[dependency ordering](../../prompts/programs/dependency-graph.md),
[slice splitting](../../prompts/programs/split.md),
[adversarial review](../../prompts/programs/cross-repo-review.md),
[brief publishing](../../prompts/programs/planning-brief.md),
[orchestration](../../prompts/programs/orchestrate.md),
[refresh](../../prompts/programs/refresh.md),
[documentation synthesis](../../prompts/programs/synthesize.md),
[documentation synchronization](../../prompts/programs/docs-sync.md),
[completion review](../../prompts/programs/completion-review.md), and the
complete [loop](../../prompts/programs/loop.md).

## Does Not Own

- Artifact schemas, which remain canonical in the contracts.
- Provider invocation or model selection.
- User-specific prompt customization.

## Next

- [ExecPlan contract](../contracts/exec-plan.md)
- [Program contract](../contracts/program.md)
- [Run ExecPlan skill](../../skills/run-exec-plan/SKILL.md)
- [Run Program skill](../../skills/run-program/SKILL.md)
