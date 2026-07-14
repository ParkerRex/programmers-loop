---
title: "Document artifact anatomy and selection"
status: complete
created_at: 2026-07-13
completed_at: 2026-07-13
summary: "Show the file anatomy of completed Assignments, Programs, and ExecPlans and explain when to use each layer."
post_build_recap: "Added a history-grounded artifact anatomy guide, routed it through the docs spine, and added a compact artifact chooser to the public README."
read_when:
  - "Documenting or reviewing how the planning artifacts fit together."
---

# Document artifact anatomy and selection

## Purpose / Big Picture

Give new users a concrete picture of what each planning artifact becomes on
disk. The guide should bridge the gap between abstract contracts and a real
completed lifecycle, then help readers choose the smallest useful artifact set.

## Progress

- [x] Inspect a representative completed Assignment, Program, and ExecPlan in
      the source repository's Git history.
- [x] Add the generalized artifact anatomy guide and route it from the docs
      spine.
- [x] Add a compact selection guide to the public README.
- [x] Run the full Bun check and archive this plan.

## Surprises & Discoveries

A representative completed historical Assignment contained 24 planning files:
two Assignment-root files, one Program driver, six packet documents, one brief
pointer, seven immutable brief revisions, and seven completed ExecPlans. That
is a useful teaching example because it demonstrates evolution without making
the specific product content part of this public repository.

## Decision Log

- 2026-07-13: Generalize the historical file tree and counts rather than copy
  source-project content or names.
- 2026-07-13: Put detailed anatomy under `docs/assignments/` and keep only the
  fast selection rule in the README and planning overview.

## Outcomes & Retrospective

The public guide now explains the three physical file formats, the nested tree
of a completed 24-file historical packet, the responsibilities and completion
signals of each artifact, and promotion rules between layers. The README
provides the fast choice, while the planning and Assignment indexes route to the
detailed guide. The full Bun check passes with 17 tests, 54 validated Markdown
files, and 10 valid planning artifacts.

## Context and Orientation

The public entrypoint is `README.md`. `docs/PLANS.md` owns artifact selection,
`docs/assignments/README.md` owns the packet index, and `docs/contracts/` owns
field-level requirements. The new guide belongs beside the Assignment index
because it explains the complete nested shape without changing any contract.

### In Scope

- Generalized file trees for a completed Assignment, Program, and ExecPlan.
- Plain-language explanations of every file category.
- Selection guidance for trivial, single-slice, research-heavy, and multi-slice
  work.
- Documentation-spine and README links.

### Out Of Scope

- Copying historical product content into this repository.
- Changing artifact schemas, validators, scaffolds, or runtime behavior.
- Adding a bundled example with seven executable implementation slices.

This ExecPlan must be maintained in accordance with `docs/contracts/exec-plan.md`.

## Plan of Work

Follow the milestones in order, keeping progress, decisions, discoveries, and proof current as the work proceeds.

## Milestones

1. The detailed guide explains the historical 24-file anatomy and the role of
   every layer.
2. A reader can choose among no durable artifact, Assignment only, Assignment
   plus ExecPlan, or Assignment plus Program and child ExecPlans.
3. The new document is reachable and passes the complete documentation proof.

## Concrete Steps

1. Add `docs/assignments/artifact-guide.md` with generalized file trees and
   completion signals.
2. Link it from `docs/assignments/README.md`, `docs/PLANS.md`, and `docs/index.md`.
3. Add the compact chooser and detailed-guide link to `README.md`.
4. Run `bun run check`, complete this plan, and rerun focused documentation and
   planning validation.

## Validation and Acceptance

The guide must be reachable from the canonical docs spine, contain no private
source-project details, and distinguish artifact purpose from file format. The
README chooser must agree with the contracts. All repository checks must pass.

### Test Commands

```bash
bun run docs:lint
bun run planning:lint
bun run check
```

## Idempotence and Recovery

The work is documentation-only and safe to rerun. If routing validation fails,
repair the nearest broken link or frontmatter rather than weakening the spine.

## Artifacts and Notes

Historical evidence was inspected read-only from Git. Only generalized counts,
roles, and lifecycle structure enter the public guide.

## Interfaces and Dependencies

Use the existing Markdown spine, contracts, Oxfmt, documentation validator, and
planning validator. No new runtime dependency or interface is required.
