---
title: "The LoopBench Thesis"
summary: "Plain-language statement of what the evaluation claims, the one experiment that decides it, and the standing defenses that keep the number honest."
status: active
read_when:
  - "Understanding what LoopBench 0.1 claims and how the claim is decided."
  - "Explaining the evaluation program to someone outside this repository."
---

# The LoopBench Thesis

## Owns

- The plain-language framing of the thesis and the experiment that tests it.
- The threat table: how the headline number could lie, and each standing
  defense.
- The tools-versus-treatment rule for task workspaces.

## Does Not Own

- The binding design choices, owned by the [decisions record](DECISIONS.md).
- The frozen hypotheses, sample sizes, and analysis plan, owned by the
  [preregistration](PREREGISTRATION.md).
- The operational definitions of overhang and harness alpha, owned by the
  [model overhang evaluation](../MODEL-OVERHANG-EVAL.md).

## The Thesis In One Sentence

The same model finishes more real work inside Programmers Loop than it does
bare — and not just because it burned more tokens.

## The One Experiment That Decides It

One model, GPT-5.6 Terra, works the same nine private tasks two ways: bare,
through a pinned Codex CLI with default behavior, and inside Programmers Loop.
Four repetitions per task per arm. Hidden graders — never the agent — count
verified successes: functional, regression, and scope acceptance, checked
outside the sandbox. If the Loop arm clears the bare arm by a statistically
real margin under the preregistered paired test, the thesis stands. If not, it
does not.

Everything else the program measures — tier substitution, frontier expansion,
harness alpha against a compute-matched control — is garnish layered on this
one number, and 0.1 reports it as exploratory only.

## Five Ways The Number Can Lie

| The lie                                      | The standing defense                                                                                                                                          |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The agent claims success it did not earn     | Hidden acceptance, graded outside the sandbox and double-run. This defense has already fired: in smoke-001 it caught our own harness under-reporting results. |
| The model has seen the answer before         | Private tasks from after the training cutoff, no network at runtime, stripped git history, canary GUIDs in every fixture.                                     |
| The Loop won by spending more, not structure | Identical per-episode wall-clock and turn budgets in both arms.                                                                                               |
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
verified-completed X% of work bare and Y% inside Programmers Loop.
```

And the honest null: if the arms tie on bounded tasks while the Loop wins on
long or ambiguous work, that is the routing story — small routes for small
work, durable structure where durability pays — not a failure of the thesis.

## Next

- [Decisions](DECISIONS.md)
- [Preregistration](PREREGISTRATION.md)
- [Model overhang evaluation](../MODEL-OVERHANG-EVAL.md)
- [Documentation index](../index.md)
