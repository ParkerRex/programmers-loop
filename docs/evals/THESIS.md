---
title: "The LoopBench Thesis"
summary: "Plain-language statement of what the evaluation claims — verified work per dollar against the vendor harness — the controlled reading behind it, and the standing defenses that keep the number honest."
status: active
read_when:
  - "Understanding what LoopBench 0.1 claims and how the claim is decided."
  - "Explaining the evaluation program to someone outside this repository."
---

# The LoopBench Thesis

_Changelog: 2026-07-15 — primary thesis pivoted to ROI against the vendor
baseline by founder directive (employ published findings; ROI over mechanism
isolation); the one-experiment comparison remains as the controlled reading._

## Owns

- The plain-language framing of the thesis and the readings that test it.
- The threat table: how the headline number could lie, and each standing
  defense.
- The tools-versus-treatment rule for task workspaces.

## Does Not Own

- The binding design choices, owned by the [decisions record](DECISIONS.md).
- The frozen hypotheses, sample sizes, and analysis plan, owned by the
  [preregistration](PREREGISTRATION.md).
- The operational definitions of overhang and harness alpha, owned by the
  [model overhang evaluation](../MODEL-OVERHANG-EVAL.md).

## The Thesis

Programmers Loop turns a coding model into a compounding system: curated
skills, enforced structure, and failure-driven adaptation convert capability
into verified finished work at falling cost per success.

The benchmark measures verified work per dollar against the vendor's own
harness, graded by a judge the agent cannot fool.

## The Controlled Reading

Behind the ROI headline sits one controlled comparison, still run exactly as
designed and now reported as the secondary reading. One model, GPT-5.6 Terra,
works the same nine private tasks two ways: bare, through a pinned Codex CLI
with default behavior, and inside Programmers Loop. Four repetitions per task
per arm. Hidden graders — never the agent — count verified successes:
functional, regression, and scope acceptance, checked outside the sandbox. The
preregistered paired test says whether structure moved verified success at
all, with the model and budgets pinned.

Everything else the program measures — tier substitution, frontier expansion —
stays exploratory, and mechanism attribution against a compute-matched control
is now a diagnostic, run when a headline result needs explaining.

## Five Ways The Number Can Lie

| The lie                                      | The standing defense                                                                                                                                          |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The agent claims success it did not earn     | Hidden acceptance, graded outside the sandbox and double-run. This defense has already fired: in smoke-001 it caught our own harness under-reporting results. |
| The model has seen the answer before         | Private tasks from after the training cutoff, no network at runtime, stripped git history, canary GUIDs in every fixture.                                     |
| The Loop won by spending more, not structure | Identical per-episode wall-clock and turn budgets in both arms — and under the ROI headline, spend itself is priced into the metric.                          |
| A lucky run decided it                       | Four repetitions per task per arm, and paired task-level statistics.                                                                                          |
| The goalposts moved after the results        | The preregistration is published before any scored run; deviations are append-only.                                                                           |

## Tools Versus Treatment

A task workspace ships exactly the toolchain the real repository had — its
tests, its linters, its vendored dependencies — because running the project's
own checks is part of the job. Both arms see the identical workspace.

The `programmers-loop` CLI is not a development tool. It is the treatment. It
enters only the Loop arm, through the recorded shim, and nothing else is ever
added to either arm's workspace.

## What Proven Looks Like

One preregistered sentence with error bars:

```text
On N real engineering tasks it had never seen, GPT-5.6 Terra
verified-completed X% of work at $A per verified success under the
vendor CLI, and Y% at $B per verified success inside Programmers Loop.
```

And the pre-declared shape: if the arms tie on bounded tasks while the Loop
wins on long or ambiguous work, that is the routing story — small routes for
small work, durable structure where durability pays — predicted on record in
the [preregistration](PREREGISTRATION.md), not a failure of the thesis.

## Next

- [Decisions](DECISIONS.md)
- [Preregistration](PREREGISTRATION.md)
- [Model overhang evaluation](../MODEL-OVERHANG-EVAL.md)
- [Documentation index](../index.md)
