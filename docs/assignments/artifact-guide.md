---
title: "Artifact Anatomy and Selection Guide"
summary: "Concrete file trees for completed Assignments, Programs, and ExecPlans, plus guidance for choosing the smallest useful planning stack."
status: active
read_when:
  - "Choosing between an Assignment, Program, and ExecPlan."
  - "Learning what a completed planning packet looks like on disk."
---

# Artifact Anatomy and Selection Guide

## Owns

- The physical file anatomy of completed Assignments, Programs, and ExecPlans.
- Plain-language roles for the files inside each artifact.
- Guidance for choosing the smallest useful planning stack.

## Does Not Own

- Required fields and headings; the [contracts](../contracts/assignment.md) own
  those details.
- Agent execution, command authority, or runtime state.
- A requirement that every project produce every optional file shown here.

## The three physical file types

The lifecycle uses only a few durable formats:

- YAML carries machine-readable Assignment identity, status, and paths.
- Markdown carries human-readable intent, research, decisions, plans, progress,
  outcomes, and proof.
- Plain text carries a tiny pointer to the exact immutable planning brief that
  is current.

Directories communicate ownership and lifecycle. Moving an artifact from an
`active/` directory to the matching `completed/` directory is part of closeout;
its own metadata must also report a completed state.

## A real completed lifecycle, generalized

The following shape is generalized from a completed Assignment recovered from
a real source repository's Git history. That Assignment contained 24 planning
files: two Assignment-root files, one Program driver, six research and decision
packet documents, one current-brief pointer, seven immutable planning briefs,
and seven completed ExecPlans.

The counts are not requirements. They show how the system grows when a Program
learns between slices and issues a fresh brief for the next ExecPlan.

```text
docs/assignments/completed/YYYY-MM-DD-example/
├── README.md
├── assignment.yaml
└── programs/completed/example/
    ├── README.md
    ├── packet/
    │   ├── research-pass-topic.md
    │   ├── normalized-pass-topic.md
    │   ├── converged-decision-packet.md
    │   ├── dependency-graph.md
    │   ├── plan-split-recommendation.md
    │   └── cross-repo-review.md
    ├── briefs/
    │   ├── current.txt
    │   ├── planning-brief-1.md
    │   ├── planning-brief-2.md
    │   ├── ...
    │   └── planning-brief-7.md
    └── exec-plans/completed/
        ├── YYYY-MM-DD-slice-1.md
        ├── YYYY-MM-DD-slice-2.md
        ├── ...
        └── YYYY-MM-DD-slice-7.md
```

## Completed Assignment anatomy

An [Assignment](../contracts/assignment.md) is the outside envelope. It answers
“what coherent body of work are we responsible for?” and keeps every related
artifact discoverable in one place.

```text
docs/assignments/completed/YYYY-MM-DD-assignment-slug/
├── README.md
├── assignment.yaml
├── research.md             # optional shared evidence
├── architecture.md         # optional cross-slice decisions
├── ux.md                    # optional user-experience work
├── ui.md                    # optional interface work
├── proof.md                 # optional acceptance evidence
├── review.md                # optional review findings
├── receipts.md              # optional external or run receipts
├── programs/completed/      # zero or more Programs
└── exec-plans/completed/    # zero or more standalone ExecPlans
```

The files have distinct jobs:

- `README.md` is the human landing page and rollup. It explains the outcome and
  points to the important evidence, Programs, and standalone ExecPlans.
- `assignment.yaml` is the stable machine-readable identity and lifecycle
  record. Its stepper tracks research, architecture, UX, UI, Programs,
  ExecPlans, proof, review, and receipts; design and plan are derived views.
  Tools should read it instead of scraping prose.
- Root evidence documents hold facts or decisions shared by several children.
  Create only the ones the work actually needs.
- `programs/` holds initiative-level convergence when the Assignment cannot be
  executed as one already-understood slice.
- Assignment-level `exec-plans/` holds bounded plans that do not need a Program
  to order or refresh them.

A completed Assignment has no active child that is required for its promised
outcome. Its README explains what shipped, what was deliberately left out, and
where the proof lives. Completion does not mean deleting the packet; the packet
is the durable record a future maintainer can inspect.

## Completed Program anatomy

A [Program](../contracts/program.md) is the reasoning and orchestration layer
inside an Assignment. It answers “what have we learned, what is settled, and
which bounded slice should execute next?”

```text
programs/completed/program-id/
├── README.md
├── packet/
│   ├── research-pass-*.md
│   ├── normalized-pass-*.md
│   ├── converged-decision-packet.md
│   ├── dependency-graph.md
│   ├── plan-split-recommendation.md
│   └── cross-repo-review.md
├── briefs/
│   ├── current.txt
│   ├── planning-brief-1.md
│   └── planning-brief-N.md
└── exec-plans/completed/
    ├── YYYY-MM-DD-first-slice.md
    └── YYYY-MM-DD-final-slice.md
```

Each group has a different lifetime:

- The Program `README.md` is the living control surface. It maintains progress,
  decisions, risks, the slice ledger, the next slice, and the retrospective.
- Research passes preserve source observations before the Program decides what
  they mean.
- Normalized passes reconcile vocabulary, duplicates, conflicts, and gaps.
- The converged decision packet records the current evidence-backed position.
- The dependency graph makes ordering constraints explicit.
- The split recommendation turns the whole initiative into bounded slices.
- Cross-repository review records effects beyond the immediate working tree.
- Each `planning-brief-N.md` is an immutable handoff from Program judgment to
  one execution slice. Once used, it is never rewritten.
- `current.txt` contains exactly the filename of the brief currently selected.
- Child ExecPlans record how each selected brief became working, validated
  behavior.

At completion, the slice ledger is closed, no next slice is required for the
Program's stated outcome, and the retrospective reconciles the result with the
original purpose. Old briefs remain because their sequence explains why later
plans differ from earlier ones.

## Completed ExecPlan anatomy

An [ExecPlan](../contracts/exec-plan.md) is normally one Markdown file, not a
miniature document tree. It answers “how can a stateless agent deliver and prove
this one bounded slice?”

```text
exec-plans/completed/YYYY-MM-DD-actionable-slice.md
```

Its content has four jobs:

- Frontmatter supplies lifecycle state, dates, summary, and a concise
  post-build recap. A Program child also pins `program_id` and the exact
  immutable planning brief it executed.
- Purpose, context, scope, milestones, steps, interfaces, and dependencies make
  the plan self-contained before execution begins.
- Progress, discoveries, and the decision log keep the plan true while work is
  underway.
- Validation commands, artifacts, outcomes, and the retrospective show that the
  result works and explain any remaining gap.

A completed ExecPlan has every required outcome either checked off or explicitly
accounted for, records the commands and observations used as proof, and carries
a post-build recap. The implementation diff may contain TypeScript, tests,
configuration, migrations, images, or other product files; the ExecPlan itself
remains the Markdown narrative that connects those changes to purpose and
evidence.

## When to use what

Use the smallest layer that preserves enough context to recover, review, and
prove the work:

- Use no durable planning artifact for a trivial, low-risk edit that fits in one
  session and would not benefit from handoff or recovery state.
- Use an Assignment alone for a coherent research, review, or decision packet
  when implementation has not started and no multi-slice convergence loop is
  needed.
- Use an Assignment with a standalone ExecPlan when the desired outcome is
  already understood and can be delivered as one bounded implementation slice.
- Add a Program when the work is ambiguous, crosses domains or repositories,
  has meaningful dependencies, needs research convergence, or will require
  several ordered ExecPlans.
- Use Program-owned ExecPlans for the implementation slices. After each one,
  refresh the Program from evidence, issue a new immutable brief if needed, and
  select the next slice.

Do not make one giant ExecPlan imitate a Program. If the plan contains several
independently valuable outcomes, unresolved architecture decisions, or slices
that should learn from earlier proof, promote the work to a Program. Conversely,
do not create a Program merely because an ExecPlan is detailed; detail and
multi-slice orchestration are different concerns.

## Selection shorthand

```text
trivial edit
  -> no durable artifact

coherent discovery or review
  -> Assignment

clear, bounded implementation
  -> Assignment -> ExecPlan

ambiguous or multi-slice initiative
  -> Assignment -> Program -> ExecPlan 1
                            -> refresh Program
                            -> ExecPlan 2 ... N
```

## Next

- [Planning model](../PLANS.md)
- [Assignment contract](../contracts/assignment.md)
- [Program contract](../contracts/program.md)
- [ExecPlan contract](../contracts/exec-plan.md)
- [Command-line interface](../CLI.md)
