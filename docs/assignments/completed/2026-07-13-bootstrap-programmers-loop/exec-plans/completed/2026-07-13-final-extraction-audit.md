---
title: "Complete the standalone extraction audit"
status: complete
created_at: 2026-07-13
completed_at: 2026-07-13
summary: "Compare Programmers Loop with its originating planning history and tooling, then port every public-safe capability needed for a thorough standalone repository."
post_build_recap: "Completed the source-to-standalone capability audit; added the Assignment lifecycle stepper, safe proof and agent runtime loops, Program transition and child-plan receipts, full prompt and workshop assets, configuration and extraction docs, hardened doctors, package contents, CLI commands, and 29 focused tests."
read_when:
  - "Auditing the completeness of the standalone planning runtime extraction."
---

# Complete the standalone extraction audit

## Purpose / Big Picture

Make Programmers Loop a genuinely standalone and thorough implementation of the
portable development lifecycle. A new user should receive the contracts,
runtime interfaces, prompts, skills, docs, doctors, examples, and verification
needed to use Assignments, Programs, and ExecPlans without access to the source
repository or its history.

## Progress

- [x] Start a dedicated final-extraction audit plan.
- [x] Inventory the current and historical source surfaces.
- [x] Compare every portable capability with the standalone repository.
- [x] Port and document justified gaps without source-project coupling.
- [x] Run full proof, audit public safety, and archive this plan.

## Surprises & Discoveries

The initial public extraction preserved the artifact contracts, scaffolds,
doctors, standup, prompts, and skills, but omitted two important portable
layers: the executable Program and ExecPlan loops, and the Assignment lifecycle
stepper used to expose research, architecture, UX, UI, proof, and review state.

The source proof runner delegated complete Markdown lines to a login shell. The
portable implementation needed a smaller trust boundary and an exact command
snapshot across agent repairs. Source session-transcript parsing was useful but
provider-specific; a durable outline file plus adapter extension point retains
the capability without making one event schema canonical.

A final Bun pack dry-run showed that a gitignored build directory needs an
explicit package `files` entry: the CLI entrypoint was present, but the exported
library graph was not. The manifest now ships compiled modules and types plus
the prompts, skills, templates, docs, assets, and configuration needed for a
standalone install.

## Decision Log

- 2026-07-13: Treat this as a capability audit rather than a file-copy exercise.
  Product-specific runtime, infrastructure, and private context stay out; every
  portable planning behavior must be represented by a contract, implementation,
  prompt, skill, example, test, or explicit non-goal.
- 2026-07-13: Keep the generic Assignment stepper and derived design/plan views,
  but leave product-specific training bundles, rubrics, browser evidence, and
  owner-specific gate names outside the core schema.
- 2026-07-13: Replace shell proof with tokenized direct spawning, explicit
  consent, repository containment, bounded output, timeouts, and atomic
  receipts. Any command edit after approval requires a new preview.
- 2026-07-13: Provide one-transition Program advancement and an idempotent child
  plan run that hashes and snapshots the exact current brief. External boards,
  releases, and deployment remain extensions.

## Outcomes & Retrospective

The standalone repository now represents every public-safe planning capability
found in the source audit. The executable surface includes the Assignment
stepper, Program transitions and brief-pinned child planning, ExecPlan
write/grill/execute/validate loops, deterministic proof, bounded repair,
doctors, standup, prompt and skill inventories, and a validated docs spine.

The reusable behavior became smaller and safer during extraction: agent
providers are adapters, no model is hardcoded, proof never invokes a shell,
commands cannot change after approval, and external GitHub behavior remains
read-only. `docs/EXTRACTION.md` records the ported, generalized, and intentionally
excluded capability classes so future work does not accidentally recreate
application coupling.

Validation passed with a frozen Bun install, the complete `bun run check`
aggregate, built-CLI smoke, package dry-run, and local plus GitHub doctors. The
doctor reported only the expected dirty-worktree warning during development. A
secondary Bun policy audit suggested Bun-runtime TypeScript settings; those
findings were explicitly rejected because this project uses Node as the
compatibility runtime and Bun only for package management and script launching.

## Context and Orientation

The source planning system was spread across repository tooling, Assignment
history, prompt documents, reusable skills, root commands, and historical
packets. Programmers Loop owns its implementation under `src/`, tests under
`test/`, public docs under `docs/`, prompt assets under `prompts/`, portable
skills under `skills/`, and artifact scaffolds under `templates/`.

### In Scope

- Assignment, Program, and ExecPlan contracts, validators, scaffolds, and
  lifecycle transitions.
- Program and ExecPlan prompt loops and reusable skills.
- Markdown metadata, documentation-spine, standup, doctor, proof, and CLI
  surfaces that are generally useful outside the originating application.
- Public-safe examples, architecture explanations, tests, and configuration
  required for independent use.
- Current source and relevant Git history when current files no longer preserve
  a teaching example or portable behavior.

### Out Of Scope

- Application-specific product vocabulary, UI, databases, cloud infrastructure,
  provider integrations, release watchers, or control-plane behavior.
- Hosted CI, package publication, or a tagged release.
- Copying source artifacts whose value is already represented by a smaller
  portable contract or example.

This ExecPlan must be maintained in accordance with `docs/contracts/exec-plan.md`.

## Plan of Work

Follow the milestones in order, keeping progress, decisions, discoveries, and proof current as the work proceeds.

## Milestones

1. A traceable inventory maps each source capability to ported, intentionally
   omitted, or source-specific.
2. Every justified portable gap has a working implementation or checked-in
   operating asset with tests and docs.
3. A clean clone can install with Bun, discover the workflow, create and lint
   every artifact, operate the prompt and skill loops, diagnose itself, and run
   the complete proof without the source repository.

## Concrete Steps

1. Enumerate source package files, root commands, planning docs, prompts, skills,
   and historical packet shapes.
2. Enumerate the standalone repository and compare command, contract, prompt,
   skill, template, doctor, proof, and documentation matrices.
3. Record the audit and implement all portable gaps in small testable changes.
4. Update public documentation, examples, and the extraction manifest.
5. Run focused tests during implementation, then `bun run check` and a clean
   install proof.

## Validation and Acceptance

The final repository must be public-safe and source-independent. All documented
commands and links must resolve, all bundled skills and prompts must validate,
artifact examples must pass their contracts, and the full Bun check must pass.
The audit must explicitly explain any source capability intentionally omitted.

### Test Commands

```bash
bun install --frozen-lockfile
bun run check
bun run doctor:github
```

## Idempotence and Recovery

Inventory and comparison commands are read-only. New runtime behavior must
preserve dry-run and overwrite protections. If a port proves source-specific,
document the omission and remove only the newly introduced standalone work;
never mutate the source repository.

## Artifacts and Notes

The audit report lives at `docs/EXTRACTION.md`. The proof and workflow security
regressions live in `test/proof.test.ts` and `test/workflows.test.ts`. Historical
source content was generalized rather than copied when names or details were
not essential to the portable contract.

## Interfaces and Dependencies

Use Bun for package plumbing and scripts, Node 24 or newer as the runtime, YAML
for structured configuration, Markdown for prose artifacts, and the existing
`AgentAdapter` boundary for provider-specific execution.
