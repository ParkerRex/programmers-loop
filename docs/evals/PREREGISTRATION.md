---
title: "LoopBench 0.1 Preregistration"
summary: "Stage 2a preregistration of the LoopBench 0.1 ROI-primary hypotheses, design, priors, outcomes, and analysis plan, pending calibration and freeze."
status: draft
read_when:
  - "Reviewing the frozen-before-results design for LoopBench 0.1."
  - "Auditing outcomes, analysis, or contamination controls for the 0.1 pilot."
---

# LoopBench 0.1 Preregistration

_Changelog: 2026-07-15 — restructured pre-freeze per founder directive (employ
published findings; ROI over mechanism isolation): the ROI pair becomes the
primary estimand, the same-model uplift test becomes the controlled secondary,
and a priors-and-predicted-shape section is added. 2026-07-15 (second
amendment) — treatment amended per decision 18 (tested context): skill
admission is evidence-gated by per-skill A/B on the private corpus, and the
skill-ablation include-filter joins the frozen configuration inputs.
Post-freeze, changes become append-only deviations._

This is stage 2a of the preregistration. It records the design intended for
LoopBench 0.1. Freezing is a separate, later step, gated on calibration:
strata assignments, the price table, and per-cell sample sizes are finalized
only after the calibration episodes run. Until then, every number below is a
declared plan, not a frozen commitment.

Design choices are ratified in the [decisions record](DECISIONS.md). Operational
definitions are owned by the [model overhang evaluation](../MODEL-OVERHANG-EVAL.md).

## Owns

- The primary and exploratory hypotheses for 0.1.
- The design, treatment, baseline, outcomes, and analysis plan to be frozen.
- The contamination, exclusion, and claim rules that govern the pilot.

## Does Not Own

- The rationale for each design choice, owned by the [decisions record](DECISIONS.md).
- The general theory of overhang and harness alpha, owned by the
  [model overhang evaluation](../MODEL-OVERHANG-EVAL.md).
- The eventual frozen values, which this document will pin only after
  calibration.

## Hypotheses

### Primary — ROI against the vendor baseline

The primary estimand is the ROI pair, read together and paired by task on the
scored headline suite: (a) verified-success rate and (b) repriced cost per
verified success (decision 12), for middle-tier plus Programmers Loop as
shipped versus the same model under the pinned vendor baseline. The
verified-success member carries the confirmatory test in the analysis plan; the
cost member is reported with intervals above the preregistered success floor.
Any joint decision rule is pinned at the freeze step.

### Controlled secondary — same-model uplift

The former primary, unchanged in design: on the movable headline strata,
middle-tier plus Programmers Loop achieves higher per-episode verified success
than the same middle-tier model run direct. A within-model, task-paired
contrast under the same preregistered paired test; it is the controlled reading
behind the ROI headline (decision 14).

### Exploratory secondaries

Reported descriptively, with no confirmatory test in 0.1:

- Tier substitution: middle-tier plus Loop versus frontier direct.
- Frontier expansion: frontier plus Loop versus frontier direct, via unscored
  exhibition runs only.
- Harness alpha: Loop versus the compute-matched control, now a diagnostic run
  when a headline result needs mechanism attribution (decision 14; 0.2 at the
  earliest).
- Reliability: variance, recovery, and false completion, including the
  interruption stratum.
- Routing economy: whether the smallest valid route matches the full stack on
  saturation tasks.

## Priors And Predicted Shape

Published findings inform the design (decision 16) and put the expected result
shape on record before any scored run:

- SkillsBench ([arXiv 2602.12670](https://arxiv.org/abs/2602.12670)): curated
  skills lift the overall aggregate by +16.6 pp across 18 model–harness
  configurations (Table 2) and the software-engineering domain specifically by
  +11.6 pp (Table 3); within the Skill-quantity ablation the two-to-three-skill
  bucket is optimal (+19.0 pp) while bundles of four or more fall to +10.1 pp
  (Table 8); self-generated skills land below the no-skills baseline on every
  tested configuration (−8.1 to −11.5 pp, Table 6).
- "Better Harnesses, Smaller Models"
  ([arXiv 2607.08938](https://arxiv.org/abs/2607.08938)): a strong negative
  correlation (Spearman ρ = −0.96) between task diversity and optimized-harness
  performance, and no successful harness adaptation that created sub-agents.

The on-record prediction: modest mean uplift on bounded tasks, with wins
concentrated in the ambiguous, long-horizon, and interruption-prone strata. The
pre-declared interpretation of that shape is the routing story — small routes
for small work, durable structure where durability pays — not a null result.

## Design

### Calibration

Run 12–15 candidate tasks direct, across 2 models (GPT-5.6 Terra and GPT-5.6
Sol) at 3 reps each: roughly 72–90 exploratory episodes. Calibration estimates
each task's per-model success probability and assigns it to a stratum.

### Suite freeze

Freeze a 10-task suite from the calibration results:

- 2 saturation tasks,
- 4 substitution tasks,
- 3 frontier-overhang tasks,
- 1 interruption-reliability task.

Strata are assigned by soft rules over estimated success probabilities, with an
explicit mechanical rule per stratum. For example, a task is **substitution**
when frontier-direct successes exceed middle-direct successes by at least 2
across the 3 calibration reps. Saturation and frontier-overhang use analogous
threshold rules on the estimated success counts. The mechanical rules are frozen
before the strata are read.

Corpus tool-call-sequence diversity — normalized Levenshtein distance over
per-episode tool-call sequences — is computed and reported as a suite
statistic, so the diversity-headwind prior can be read against this suite.

### Pilot

The 9 scored headline tasks (2 saturation, 4 substitution, 3 frontier-overhang)
run across 3 systems — middle-direct, middle-plus-Loop, and frontier-direct — at
4 reps each: 3 x 9 x 4 = 108 scored episodes. The 1 interruption task runs under
a separate reliability protocol. Frontier-plus-Loop exhibition runs are unscored.

The interruption task is excluded from the headline aggregate and scored under
reliability outcomes only.

## Treatment

Programmers Loop with fixed, preregistered routing. Route is assigned by a
mechanical rubric over observable task features, not by model discretion.
Candidate features:

- expected file count,
- dependency count,
- ambiguity markers, and
- slice count.

0.1 uses the skip route and the standalone-ExecPlan route only. The Program
route is out of scope for 0.1. The rubric mapping features to route is frozen
before the pilot.

The treatment is the product as shipped (decision 15): curated skill packs,
hooks, and tool policies are included, capped at no more than 3 short skills
per phase (decision 16), and versioned via prompt and skill hashes recorded per
episode.

Skill admission into that pack is evidence-gated (decision 18): no curated
skill enters or remains in the pack without a measured A/B on the private
corpus — same tasks, identical configuration except the skill under test — read
on the ROI pair (verified-success rate and repriced cost per verified success),
and a skill whose presence changes nothing measurable is removed. Ablation arms
select the effective skill set with the `skills.include` allowlist; the
include-filter joins the pack hash in the run's frozen configuration inputs, so
a filtered treatment is a distinct configuration by construction. After the
suite freeze, any pack or filter change is a recorded deviation.

Anthropic-model arms in any phase — smoke runs, adapter-parity checks, and
future robustness arms — are Sonnet-only under Decision 13 in the
[decisions record](DECISIONS.md).

## Baseline

A named, pinned agent: Codex CLI `exec`, a pinned version, default behavior,
with the same sandbox, tools, and budgets as the treatment. The baseline runs
under the identical no-human policy (see the symmetric owner-question policy in
the [decisions record](DECISIONS.md)).

## Compute-Matched Control

Defined now; demoted to a diagnostic (decision 14), run when a headline result
needs mechanism attribution — 0.2 at the earliest. Not part of the 0.1 scored
pilot.

- Primary form: budget-matched best-of-k independent attempts, with the model
  self-selecting its submission using visible tests only.
- Sensitivity form: single-session, budget-notified continuation.
- Oracle best-of-k is reported as an upper bound only, never as a headline
  number.

## Outcomes

### Primary — the ROI pair

- Verified-success rate, from per-episode binary verified success: hidden
  functional acceptance plus regression acceptance plus scope acceptance,
  graded outside the sandbox, deterministically, and double-run to confirm
  reproducibility.
- Repriced cost per verified success (decision 12), reported only above a
  preregistered success floor of at least 5 successes per cell.

### Secondary

- False-completion rate.
- Failure-category distribution over the 13-category taxonomy in the
  [model overhang evaluation](../MODEL-OVERHANG-EVAL.md).
- Cost per attempt.
- Wall time.
- pass^k reliability on repeated tasks.

### Economic outcomes and cost normalization

Economic outcomes are computed by repricing each episode's recorded token usage
at a pinned public API list-price table with a frozen as-of date, never from
billed cost. This holds regardless of whether an episode ran under subscription
auth or API-key auth (see Decision 12 in the [decisions record](DECISIONS.md)).
CLI-reported cost figures are recorded as advisory only. The price table and its
as-of date are frozen in this preregistration at the freeze step. Auth mode is
recorded per episode; subscription rate-limit windows are treated as a
scheduling constraint on wall-time planning, not as an input to any score.

## Analysis Plan

- Task-level paired mean differences as the estimand.
- Confirmatory test: an exact sign-flip permutation test, alpha = 0.05,
  two-sided — applied to the verified-success member of the primary ROI pair,
  treatment versus vendor baseline paired by task, and to the controlled
  secondary on the movable strata. The cost member of the pair is reported with
  hierarchical-bootstrap intervals above the success floor; any joint decision
  rule is pinned at freeze.
- Uncertainty: a hierarchical bootstrap resampling task then episode, 10,000
  resamples, for confidence intervals.
- Per-cell Wilson intervals.
- Clustering by task everywhere.
- A hierarchical logistic model as a sensitivity analysis only, not the headline.

The analysis code must run end to end against a synthetic fixture before the
suite is frozen, so the pipeline is fixed before any real result is seen.

## Stopping And Abort

- Fixed-N. No comparative mid-run readouts.
- If the infrastructure-failure rate exceeds 20%, the study halts.
- Infrastructure failures are excluded from scoring and reported separately.
- Experimental reruns are forbidden.

## Exclusion, Rerun, And Deviation Rules

- Infrastructure failures are excluded and reported with reasons; they are never
  silently scored as model failures.
- Experimental reruns of a scored episode are forbidden.
- Deviations from this preregistration are recorded append-only, each with a
  timestamp. The deviation log is published with the report.

## Contamination

- A per-model training-cutoff table is required before any time-isolated public
  source is admitted.
- Canary GUIDs are embedded in all new task fixtures.
- Runtime network access is default-deny.
- 100% of successful episodes are audited for gaming: upstream lookup, history
  mining, and test tampering. See
  [cursor.com/blog/reward-hacking-coding-benchmarks](https://cursor.com/blog/reward-hacking-coding-benchmarks).

## Claim Policy

No claim generalizes beyond the evaluated task distribution, model versions,
harness conditions, budgets, and verification standard. Negative and mixed
results are published under identical standards to positive results.

## Next

- [Thesis](THESIS.md)
- [Decisions](DECISIONS.md)
- [Model overhang evaluation](../MODEL-OVERHANG-EVAL.md)
- [Documentation index](../index.md)
