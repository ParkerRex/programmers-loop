---
title: "LoopBench 0.1 Decisions"
summary: "ADR-style decision record fixing scope, model pair, budgets, and policy for the LoopBench 0.1 evaluation."
status: active
read_when:
  - "Reviewing what LoopBench 0.1 will and will not attempt to show."
  - "Amending or citing a ratified 0.1 design decision."
---

# LoopBench 0.1 Decisions

_Changelog: decisions 1–11 originate from the 2026-07-14 external design review
of LoopBench 0.1; decisions 12–13 were added the same day by founder directive.
On 2026-07-14 the founder delegated ratification of the proposed defaults ("Do
what you think is the right answer for decisions... I trust"); decisions 1–12
are ratified under that delegation, and decision 13 was ratified by the founder
directly._

## Owns

- The ratified design choices that scope LoopBench 0.1.
- The rationale attached to each choice, for later revision or challenge.
- The two cross-cutting policies (owner questions, interruption stratum) that
  govern how episodes are scored.

## Does Not Own

- The operational definitions of overhang and harness alpha, owned by the
  [model overhang evaluation](../MODEL-OVERHANG-EVAL.md).
- The frozen hypotheses, sample sizes, and analysis plan, owned by the
  [preregistration](PREREGISTRATION.md).
- Numeric price tables, resolved model versions, and image digests, which are
  recorded per run rather than fixed here.

## How To Read A Decision

Each decision states the choice, its status, and a short rationale. Every
decision is ratified: decision 13 by the founder directly, decisions 1–12 under
the founder's 2026-07-14 delegation. Ratified decisions are binding until the
founder amends them. The [preregistration](PREREGISTRATION.md) freezes the
affected parameters at the post-calibration freeze step.

## Decisions

### 1. Primary hypothesis

**Decision.** H1 — same-model uplift on the middle tier — is THE primary claim
of 0.1: middle-tier plus Programmers Loop achieves higher verified success than
the same middle-tier model run direct. Every other question (tier substitution,
frontier expansion, harness alpha, reliability, routing economy) is exploratory
or deferred.

**Status.** Ratified by founder delegation (2026-07-14).

**Rationale.** Statistical power. The original 8-task by 3-rep design had roughly
13% power to detect a +25-point effect. Concentrating 0.1 on one paired,
within-model contrast is the only claim the sample can credibly support.

### 2. Model pair

**Decision.** Same-family pair: GPT-5.6 Terra (middle tier) versus GPT-5.6 Sol
(frontier), both run through the native Codex CLI in the actual study. Running
both tiers on one native harness eliminates the adapter confound. Cross-provider
arms (Grok 4.5, DeepSeek V4, Claude) are deferred to 0.2 robustness arms.

**Status.** Ratified by founder delegation (2026-07-14).

**Rationale.** A same-family, same-CLI pair isolates the tier variable from
harness and provider differences. Note explicitly: a Claude CLI adapter is being
built now, for smoke runs and future arms, and the "middle" and "frontier" tier
labels remain hypotheses until direct calibration shows a task-level success gap
between them.

### 3. Effort pinning

**Decision.** Reasoning-effort level is part of model identity. Pin both models
at "high" for all of 0.1, and record the resolved model version plus effort
level on every episode.

**Status.** Ratified by founder delegation (2026-07-14).

**Rationale.** Effort silently changes elicited capability; an unpinned or
unrecorded effort makes two episodes incomparable even under an identical model
alias.

### 4. Frontier-plus-Loop arm

**Decision.** In 0.1 the frontier-plus-Loop arm produces unscored exhibition
runs only: 3–5 episodes with full transcripts published. It becomes a scored arm
in 0.2.

**Status.** Ratified by founder delegation (2026-07-14).

**Rationale.** Frontier expansion is not the 0.1 claim and the sample cannot
support it. Exhibition runs surface qualitative behavior and de-risk the 0.2
scored arm without implying a measured result.

### 5. Public and private boundary

**Decision.** Smoke tasks are public. Headline tasks are private and are never
committed to this repository. Transcripts of retired tasks are published.
Graders for retired tasks are published. Live hidden acceptance is never
published.

**Status.** Ratified by founder delegation (2026-07-14).

**Rationale.** Publishing retired tasks and their graders makes the method
auditable; keeping live headline tasks and their hidden acceptance private
protects the suite from contamination and gaming.

### 6. Grading personnel

**Decision.** Deterministic grading first; an LLM judge second with published
prompts; human adjudication by the founder. All reports declare the human
adjudication UNBLINDED as a stated limitation.

**Status.** Ratified by founder delegation (2026-07-14).

**Rationale.** Solo-operator reality: one person builds, runs, and adjudicates.
Naming the unblinding as a limitation is more honest than claiming a blinding
that does not exist. External reviewers are invited for 0.2.

### 7. Budget

**Decision.** Total 0.1 inference cap is $2,500. Per-episode caps: $20 for
middle-tier episodes, $40 for frontier episodes, a 2-hour wall-clock ceiling,
and hard per-phase caps. Economic outcomes are normalized under Decision 12.

**Status.** Ratified by founder delegation (2026-07-14).

**Rationale.** The cap must cover calibration plus a scored pilot plus
exhibition runs with margin. The planned episode counts:

| Phase                    | Formula                         | Episodes |
| ------------------------ | ------------------------------- | -------- |
| Calibration              | 12–15 tasks x 2 models x 3 reps | 72–90    |
| Pilot, scored headline   | 3 systems x 9 tasks x 4 reps    | 108      |
| Interruption reliability | 1 task x 6 reps x 2 systems     | 12       |
| Exhibition, unscored     | frontier-plus-Loop              | 3–5      |

Scored headline episodes total 108. Calibration adds 72–90 exploratory
episodes; interruption reliability adds 12; exhibition adds 3–5.

### 8. Naming

**Decision.** "LoopBench" remains the internal milestone codename only. The
public benchmark and report brand proposal is "Overhang" / "The Overhang
Report." The headline metric coinage is "harness alpha." A final public name
requires founder sign-off.

**Status.** Ratified by founder delegation (2026-07-14).

**Rationale.** Name collisions are documented: an npm package at
[npmjs.com/package/loopbench](https://www.npmjs.com/package/loopbench), an
existing paper at [arXiv 2512.13713](https://arxiv.org/abs/2512.13713), and an
unrelated FPGA project. Keeping "LoopBench" internal avoids the collisions while
"Overhang" carries the public brand.

### 9. Timing

**Decision.** Publish the preregistration and methodology before the product,
little-worker, launches. Evidence first.

**Status.** Ratified by founder delegation (2026-07-14).

**Rationale.** A preregistration published before results, and before the
product it might promote, is the credible sequencing. Launching the product
first would make any later evaluation read as marketing.

### 10. Contamination policy

**Decision.** Private-source tasks are preferred. Time-isolated public sources
are allowed only after a per-model training-cutoff table check. Canary GUIDs are
embedded in all new task fixtures. Runtime network access is default-deny.
Post-run similarity probes compare submissions against reference patches.

**Status.** Ratified by founder delegation (2026-07-14).

**Rationale.** Contamination is the central validity threat for a coding
benchmark. Each control targets a distinct leak path: memorized public tasks,
network lookup, and near-duplicate reference solutions.

### 11. Platform

**Decision.** Linux containers (Docker or OrbStack) are required for all scored
runs, from calibration onward. A macOS temp-directory sandbox is acceptable for
the unscored smoke study only. Record image digests per episode.

**Status.** Ratified by founder delegation (2026-07-14).

**Rationale.** Scored comparability requires an identical, reproducible
execution environment; recorded image digests make an episode's environment
auditable. The looser macOS sandbox is tolerable only where nothing is scored.

### 12. Auth modes and cost normalization

**Decision.** Episodes may run under either local subscription auth (a Claude
subscription for the `claude` CLI, a ChatGPT subscription for the `codex` CLI)
or API-key auth. Because subscription runs carry no billed marginal cost, all
scored ECONOMIC outcomes are computed by repricing recorded token usage at
pinned public API list prices — the price table and its as-of date are frozen in
the [preregistration](PREREGISTRATION.md) — and never from billed cost.
CLI-reported cost figures are recorded as advisory only. Auth mode is recorded
per episode in the run record. Subscription rate-limit windows are noted as a
concurrency and scheduling constraint that affects wall-time planning, not
scores.

**Status.** Ratified by founder delegation (2026-07-14).

**Rationale.** Mixing subscription and API-key runs would otherwise make cost
per verified success incomparable across episodes. Repricing every episode from
recorded tokens at one frozen price table yields a single, reproducible economic
metric independent of how a given run was authenticated.

### 13. Model-usage discipline

**Decision.** Model roles across the evaluation program are fixed:

- Claude Fable is never a benchmark subject model and never an evaluation or
  inner-episode agent. It is reserved for interactive orchestration only.
- All Anthropic-model benchmarking — inner episode agents, exhibition runs,
  adapter-parity checks — uses Sonnet only for now. Opus and Fable are excluded
  as subjects until the founder revisits this decision.
- Worker and engineering subagents building the evaluation infrastructure use
  Opus.
- Follow-up guard, recorded as a TODO for the Claude adapter (issue #20/#24
  territory): pin the CLI's internal small/fast utility model
  (`ANTHROPIC_SMALL_FAST_MODEL`) to the subject model so incidental internal
  calls cannot drift to other models.

**Status.** Ratified by founder (2026-07-14).

**Rationale.** Role separation keeps subject identity unambiguous: the model
that orchestrates the program interactively must never also appear inside the
episodes it helps run, and a single Anthropic subject keeps the matrix small
and stable until the founder revisits. The utility-model pin closes a drift
path where an episode attributed to one subject model would silently route
incidental internal calls to another.

## Symmetric Owner-Question Policy

Every condition — direct baseline, Programmers Loop, and every control —
receives the identical instruction: no human is available, decisions must be
made autonomously, and each decision must be recorded. Any episode that
terminates owner-blocked scores as a failure in all arms.

This keeps the treatment from receiving hidden human help that the baseline
cannot. An asymmetric owner-question policy would silently advantage whichever
arm is allowed to ask.

## Interruption Stratum

Interruption and resumption tasks are scored under reliability outcomes ONLY.
They are excluded from the H1 headline aggregate.

The direct baseline has no durable state by construction: an interrupted direct
episode cannot resume from checked-in artifacts because it produces none.
Pooling interruption tasks into the headline aggregate would bake a Programmers
Loop win into the primary claim rather than measure it. Reliability is where the
durable-state advantage belongs.

## Next

- [Preregistration](PREREGISTRATION.md)
- [Model overhang evaluation](../MODEL-OVERHANG-EVAL.md)
- [Documentation index](../index.md)
