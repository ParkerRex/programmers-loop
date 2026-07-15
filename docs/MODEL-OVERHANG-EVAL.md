---
title: "Model Overhang Evaluation"
summary: "Specification for measuring tier substitution, frontier expansion, and harness alpha produced by Programmers Loop."
status: draft
read_when:
  - "Designing or reviewing Programmers Loop evaluations."
  - "Comparing model tiers, harness conditions, capability, cost, or reliability."
---

# Model Overhang Evaluation Specification

## Status

This is a starting specification for discussion. It defines the research
question and validity requirements, not an implementation plan or a claim that
Programmers Loop has already produced the described results.

The initial working example uses Grok 4.5 as the middle-tier model and GPT 5.6
SOL as the frontier model. Those names are illustrative tier labels rather than
permanent dependencies. The evaluated model ids and versions must be selected
and frozen for each study.

## Owns

- The operational definition of model overhang and harness alpha.
- The minimum experiment needed to compare model-plus-harness systems.
- Task-suite, control, scoring, cost, repetition, and reporting requirements.
- The distinction between tier substitution and frontier expansion.
- The evidence required before publishing performance claims.

## Does Not Own

- The implementation of an evaluation runner, task store, or reporting UI.
- A permanent model leaderboard.
- Model training, fine-tuning, or provider selection.
- Programmers Loop runtime contracts or proof-command authorization.
- Numeric success thresholds, budgets, or sample sizes before calibration.

## Core Claim

The useful unit of comparison is not a model in isolation. It is a
model-plus-harness system.

Default coding-agent harnesses may leave a meaningful amount of a model's
software-engineering capability unexpressed. Programmers Loop attempts to
realize that capability by allocating test-time compute through durable
context, explicit decomposition, critique, bounded execution, recovery, and
deterministic proof.

For one declared task distribution, the target findings are:

```text
Score(middle-tier model + Programmers Loop)
≈ Score(frontier model + default harness)

Score(frontier model + Programmers Loop)
> Score(frontier model + default harness)
```

The first result is **tier substitution**. The second is **frontier
expansion**. A study may find either, both, or neither.

Claims must remain scoped to the evaluated task distribution. The acceptable
form is “middle-tier plus Programmers Loop matched frontier-direct performance
on this class of work,” not “the middle-tier model became the frontier model.”

## Problem Statement

Operators do not yet have controlled evidence showing:

- how much capability Programmers Loop elicits from lower-cost models;
- whether the uplift exceeds the benefit of simply spending more inference;
- which task shapes receive the uplift;
- whether strong models also gain additional headroom;
- whether any capability gain survives total-cost comparison; and
- whether the system improves reliability, recovery, or variance even when
  average success changes little.

Without a controlled counterfactual, successful dogfooding cannot distinguish
model capability from harness capability.

## Research Questions

The headline evaluation answers these questions in order:

1. Does Programmers Loop improve independently verified task success for the
   same model?
2. Does it outperform an unstructured agent given comparable inference compute?
3. Can a middle-tier model plus Programmers Loop match or exceed a frontier
   model using a default harness?
4. Can a frontier model plus Programmers Loop exceed both its default and
   compute-matched baselines?
5. What is the total cost per verified success for each system?
6. Does the effect persist across task categories, model families, and repeated
   runs?
7. Where does the loop create overhead without benefit?

## Terminology

### Model

One immutable provider model id and version for the study window. A provider
alias that can silently change is insufficient unless the resolved version is
recorded for every run.

### Harness

The prompts, tools, control flow, durable artifacts, retry policy, context
policy, proof boundary, and budgets surrounding the model.

### System Configuration

One model crossed with one harness condition. Scores belong to system
configurations, not to model names alone.

### Default Direct Harness

The ordinary coding-agent path used as the raw elicited-capability baseline. It
receives the task, repository, permitted tools, and budget without Programmers
Loop artifacts or orchestration.

### Compute-Matched Unstructured Harness

A control that may use approximately the same total inference allowance as the
Programmers Loop condition but spends it through conventional continuation,
retry, or critique rather than durable Assignment, Program, and ExecPlan
mechanics.

This control separates structured allocation of test-time compute from the
benefit of additional tokens or calls alone.

### Programmers Loop Harness

The smallest workflow stack selected by the declared routing policy:

- trivial work may skip durable planning;
- one understood slice uses an Assignment with a direct ExecPlan; and
- ambiguous or multi-slice work uses an Assignment, Program, immutable briefs,
  and child ExecPlans.

Unless a later study explicitly evaluates a hybrid, the same evaluated model
must perform every agent-driven phase.

### Model Overhang

Capability available from a model but not expressed by the default harness on
the declared task distribution.

### Harness Alpha

Performance attributable to structured harnessing beyond the compute-matched
unstructured control.

### Verified Success

Completion that passes task-owned hidden acceptance, regression, and scope
checks. Agent self-report, plan completion, and visible tests alone do not count
as verified success.

## Hypotheses

### H1: Same-Model Uplift

For at least the bounded and ambiguous task strata, a model using Programmers
Loop achieves higher verified success than the same model using the default
direct harness.

### H2: Structured Compute Advantage

Programmers Loop outperforms a compute-matched unstructured harness. This is the
primary evidence for harness alpha rather than generic test-time-compute uplift.

### H3: Tier Substitution

A middle-tier model using Programmers Loop matches or exceeds frontier-direct
performance at lower total cost per verified success.

### H4: Frontier Expansion

A frontier model using Programmers Loop solves a measurable portion of tasks
that both its default and compute-matched unstructured conditions fail.

### H5: Reliability Lift

Programmers Loop reduces run-to-run variance, unrecoverable interruption,
silent scope drift, or false completion even when average task success is
similar.

### H6: Routing Matters

For trivial work, the smallest valid route—often no durable planning—performs
at least as well economically as forcing the complete planning stack.

## Evaluation Matrix

The minimum headline matrix crosses two model tiers with three harness
conditions:

| System                                     | Purpose                        |
| ------------------------------------------ | ------------------------------ |
| Middle-tier + default direct               | Raw middle-tier baseline       |
| Middle-tier + compute-matched unstructured | Extra-compute control          |
| Middle-tier + Programmers Loop             | Tier-substitution candidate    |
| Frontier + default direct                  | Frontier reference             |
| Frontier + compute-matched unstructured    | Frontier extra-compute control |
| Frontier + Programmers Loop                | Frontier-expansion candidate   |

Every system receives the same task contract and repository snapshot. Every
cell is repeated enough to measure stochastic variance rather than one lucky or
unlucky sample.

Additional middle-tier models and model families improve external validity but
do not replace the complete minimum matrix.

## Evaluation Unit

One evaluation episode consists of:

- one immutable repository snapshot;
- one versioned task contract;
- one system configuration;
- one declared inference and wall-time budget;
- zero human interventions unless the task explicitly tests owner interaction;
- all produced planning artifacts, traces, receipts, and repository changes;
- one terminal outcome: verified success, verified failure, timeout, budget
  exhaustion, blocked owner question, harness failure, or infrastructure
  failure.

Infrastructure failures must be reported separately and must not be silently
scored as model failures or discarded.

## Task Suite

The task suite needs two independent dimensions: difficulty and workflow shape.

### Difficulty Strata

#### Saturation

Both model tiers ordinarily succeed. These tasks measure routing quality,
unnecessary overhead, regression risk, and whether the loop knows when not to
expand.

#### Substitution

The frontier-direct system succeeds materially more often than the
middle-tier-direct system. These tasks measure whether a cheaper harnessed
system closes the observed tier gap.

#### Frontier Overhang

The frontier-direct system regularly fails. These tasks create headroom for
measuring frontier expansion.

A suite containing only saturation tasks cannot measure model overhang. A suite
containing only frontier-overhang tasks cannot reliably measure tier
substitution.

### Workflow Shapes

The suite should include:

- trivial, low-risk edits that should skip durable planning;
- clear bounded features suited to a direct ExecPlan;
- ambiguous, dependency-heavy, or multi-slice initiatives suited to a Program;
- interrupted tasks that must resume without hidden chat history;
- conflicting or incomplete requirements that require explicit decisions;
- proof traps where visible validation can pass while hidden acceptance fails;
- long-context tasks that expose instruction loss and rediscovery; and
- tasks where out-of-scope changes are tempting but incorrect.

### Task Construction

Prefer private, newly derived, or time-isolated repository tasks over famous
public benchmark items. Each task must have:

- a fixed starting commit or archive;
- a concise user-visible request;
- declared tool and network policy;
- hidden functional and regression acceptance;
- scope boundaries;
- a maximum budget and timeout;
- deterministic reset behavior; and
- a rubric that does not reward documentation volume as a substitute for a
  working result.

The evaluated model must not generate its own hidden acceptance criteria.

## Experimental Controls

The following must remain constant across compared systems unless the changing
variable is the subject of the study:

- repository snapshot and task text;
- environment, dependencies, and hardware class;
- available tools and network access;
- filesystem and command permissions;
- hidden tests and scoring rubric;
- maximum wall time;
- model temperature and other sampling controls where supported;
- treatment of owner questions;
- failure, retry, and timeout accounting;
- provider response caching policy; and
- evaluation window, to limit silent model-version drift.

The run record must capture every deviation.

Human reviewers must be blind to model and harness condition when applying
subjective rubrics. Hidden tests must remain hidden from planning and execution
prompts.

## Budget Policy

Capability and economics are related but distinct results.

### Capability View

Run each condition with the budget required by its declared operating policy,
subject to a hard ceiling. This measures the best result produced by the system
as intended.

### Compute-Matched View

Give the unstructured control a comparable inference allowance. This tests
whether structure allocates test-time compute more effectively than retries or
additional direct reasoning.

### Economic View

Record actual provider cost, input and output tokens, cached tokens, model
calls, tool calls, and wall time. Compare total cost per verified success, not
price per token or cost per attempt.

If exact provider cost is unavailable, preserve the usage record needed to
reprice every run later.

## Scoring

### Primary Outcome

Binary independently verified task success.

### Quality Outcomes

- hidden functional acceptance;
- regression safety;
- scope adherence;
- severity of remaining review findings;
- false-completion rate;
- correctness of explicit decisions when requirements conflict; and
- validity of the final repository state.

### Reliability Outcomes

- variance across repeated runs;
- timeout and budget-exhaustion rate;
- recovery after forced interruption;
- number of unrecoverable context failures;
- number and quality of owner questions;
- repair attempts;
- harness and infrastructure failure rates; and
- worst-case or lower-tail performance.

### Economic Outcomes

- total cost per attempt;
- total cost per verified success;
- wall time per verified success;
- model and tool calls per verified success; and
- cost-performance frontier across system configurations.

### Diagnostic Outcomes

Planning-contract validity, Program transition quality, ExecPlan readiness, and
receipt completeness help explain failures. They must not replace functional
success in the primary score.

## Formal Measures

Let:

- (D_m) be the middle-tier default-direct score;
- (C_m) be the middle-tier compute-matched score;
- (L_m) be the middle-tier Programmers Loop score;
- (D_f) be the frontier default-direct score;
- (C_f) be the frontier compute-matched score; and
- (L_f) be the frontier Programmers Loop score.

### Same-Model Loop Uplift

```text
Loop uplift(model) = Loop score(model) − Default-direct score(model)
```

### Harness Alpha

```text
Harness alpha(model) = Loop score(model) − Compute-matched score(model)
```

### Observed Tier-Gap Closure

```text
Tier-gap closure = (L_m − D_m) / (D_f − D_m)
```

This measure is meaningful only when the declared task distribution exhibits a
positive direct tier gap. Report the component scores with the ratio.

### Tier Substitution

```text
L_m ≥ D_f
```

Economic tier substitution additionally requires a lower total cost per
verified success.

### Frontier Expansion

```text
L_f > D_f
```

The stronger claim also requires:

```text
L_f > C_f
```

This separates structured frontier expansion from additional inference alone.

## Programmers Loop Treatment

The treatment must be versioned as precisely as the model:

- repository commit;
- configuration;
- routing policy;
- prompt hashes;
- skill hashes;
- Assignment, Program, and ExecPlan contract versions;
- proof allowlist and timeout policy;
- agent adapter and invocation parameters; and
- any manual decisions made before the run.

The first headline study should use one model for all agent-driven phases.
Hybrid role allocation, such as a frontier model writing briefs for a
middle-tier executor, is a separate system configuration and should be studied
later.

## Mechanism Evaluations

The headline study evaluates the complete routing policy. Follow-up ablations
can explain where the gain comes from:

- direct execution versus ExecPlan;
- one oversized ExecPlan versus Program plus child ExecPlans;
- writer without grill versus writer plus grill;
- in-memory continuation versus durable interruption and resumption;
- agent validation versus deterministic proof;
- default retry versus bounded repair with retained failure evidence;
- self-authored planning versus a fixed pre-authored plan; and
- single-model operation versus explicit hybrid model roles.

Ablations must not replace the full-system comparison.

## Failure Taxonomy

Every unsuccessful episode should receive one primary failure category:

- task-understanding failure;
- research or convergence failure;
- decomposition or ordering failure;
- plan-readiness failure;
- implementation failure;
- regression or scope failure;
- validation or proof failure;
- false completion;
- owner-blocked;
- context-recovery failure;
- budget or timeout exhaustion;
- harness failure; or
- infrastructure failure.

Secondary tags may record contributing factors. The taxonomy should make it
possible to see whether Programmers Loop changes the kind of failure even when
the aggregate score is unchanged.

## Reporting

Every report must include:

- exact model and harness configurations;
- task-suite version and stratum composition;
- budgets and actual usage;
- attempts and verified successes per cell;
- uncertainty or run-to-run variance;
- capability results by task stratum and workflow shape;
- cost per verified success;
- failure taxonomy;
- excluded infrastructure failures with reasons;
- all preregistered deviations; and
- links or identifiers for reproducible run artifacts.

The preferred headline views are:

1. a system capability ladder;
2. middle-tier tier-gap closure;
3. frontier expansion;
4. success versus total spend;
5. reliability and lower-tail outcomes; and
6. failure-type changes.

Aggregate results must not conceal a task category where forced orchestration
causes a material regression.

## Interpretation Guide

- Higher success at lower cost supports economic tier substitution.
- Higher success at higher cost supports capability lift but not substitution.
- Similar mean success with lower variance supports a reliability claim.
- Better interruption recovery supports a durable-state claim.
- Gains over default but not compute-matched control indicate generic
  test-time-compute uplift rather than demonstrated harness alpha.
- Gains only with pre-authored plans support a structured-handoff claim rather
  than autonomous orchestration.
- Gains isolated to one provider family require a model-specific explanation.
- Regressions on trivial work make routing and skip behavior part of the core
  product requirement.

## Claim Policy

Before execution, the study must preregister:

- primary hypotheses;
- task-suite inclusion rules;
- model and harness versions;
- run budgets;
- repetition and stopping rules;
- scoring and exclusion rules;
- statistical method; and
- thresholds for material capability and economic differences.

Thresholds must not be selected after reading the result. Negative and mixed
results belong in the report.

No public claim should imply general model equivalence. Every claim must name
the task distribution, harness conditions, budgets, and verification standard.

## Open Decisions

- Which model ids represent middle and frontier tiers?
- How many model families are required for the first credible claim?
- Which repositories and task sources form the initial suite?
- What task counts and repetitions provide adequate power?
- How is inference made approximately compute-matched across providers?
- Is a dollar budget, token budget, wall-time budget, or a combination primary?
- Which outcomes can be fully deterministic and which require blind review?
- How are owner questions handled without introducing unequal human help?
- What model-version drift policy applies during a long study?
- Which traces and artifacts can be published without leaking private tasks?
- What result would justify investing in mechanism ablations?

## Readiness To Plan

This specification is ready to become an implementation plan when:

- the primary claim is chosen;
- the minimum model matrix is selected;
- the first task-suite source and strata are agreed;
- the budget and repetition policy are fixed;
- the scoring owner and hidden-acceptance strategy are known; and
- the required public versus private evidence boundary is decided.

## Next

- [Architecture](ARCHITECTURE.md)
- [Planning model](PLANS.md)
- [Reliability and proof](RELIABILITY.md)
- [Security model](SECURITY.md)
- [Development workflow](DEVELOPMENT.md)
