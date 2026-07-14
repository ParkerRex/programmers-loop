---
title: "Extraction Boundary"
summary: "Final audit of what became portable, what was generalized, and what intentionally stayed application-specific."
status: active
read_when:
  - "Comparing Programmers Loop with the originating application repository."
  - "Deciding whether a new source feature belongs in the standalone runtime."
---

# Extraction Boundary

## Owns

- The final capability inventory for the standalone extraction.
- The rationale for generalized interfaces and intentional omissions.
- The rule that reusable planning mechanics remain independent of one product.

The extraction covered current planning tooling, historical Assignment,
Program, and ExecPlan artifacts, prompts, reusable skills, command surfaces,
doctors, standup behavior, Markdown tooling, tests, and proof machinery. It did
not copy application prose or internal product state.

The semantic-parity pass also restored the source implementation's strict
portable invariants: allowed metadata, lane and completion consistency,
immutable brief linkage, exact scope and runnable-command requirements,
execution-readiness gates, one-transition verification, full operating prompts,
same-session grilling, and outline distillation. Prompt validation now checks
stage-specific behavior rather than filenames alone.

### Ported as standalone contracts

- Assignment identity, lifecycle status, local mirror, and the generalized
  research → architecture → UX → UI → Program → ExecPlans → unlocks → proof →
  review → receipts stepper. `design` and `plan` remain derived views.
- Program research and normalization passes, converged packet, dependency
  graph, split recommendation, adversarial review, immutable versioned briefs,
  current pointer, slice ledger, and refresh cycle.
- ExecPlan frontmatter, self-contained sections, in/out scope, milestones,
  concrete steps, recovery, interfaces, test commands, and post-build record.
- Assignment-, Program-, and ExecPlan-specific lint plus repository-wide
  planning validation.

### Ported as executable runtime behavior

- Provider-neutral agent phases for ExecPlan writing, bounded grilling,
  execution, validation, repair, and the composed run loop.
- Bounded Codex-session transcript extraction and deterministic versioned
  workshop-handoff rendering as optional outline inputs.
- A Program one-transition loop and idempotent child-plan writer that resolves,
  hashes, snapshots, and stamps the exact current planning brief.
- Deterministic proof preview and execution with explicit consent, token-prefix
  allowlisting, direct process spawning, repository containment, timeouts,
  bounded output, stop-on-first-failure behavior, and versioned receipts.
- Durable ignored run records for agent phases, Program transitions, brief
  snapshots, and proof attempts.
- Read-only local and GitHub doctors, active-work standup, scaffolds, human and
  JSON CLI output, path containment, and stable exit-code semantics.

### Ported as teaching and agent assets

- The complete Program prompt progression: initialize, funnel, research,
  normalize, converge, order, split, review, publish, orchestrate, refresh,
  synthesize, sync, and completion review.
- The complete ExecPlan prompt progression: outline, write, grill, execute,
  validate, and full workflow.
- Portable skills for workshop qualification, Assignment planning, Program and
  ExecPlan operation, standup, doctors, documentation, and verification. The
  workshop includes canonical normalization and grill references.
- A first-class docs spine, link and anchor checks, Markdown frontmatter,
  artifact anatomy, configuration, security, reliability, development, and CLI
  references.

### Generalized instead of copied

- A source-specific Codex runner became `AgentAdapter`; model and profile remain
  configuration rather than doctrine.
- Provider-session JSONL extraction lives in an explicit Codex input adapter;
  repository notes and versioned workshop handoffs use provider-neutral input
  paths, so one event schema does not become the planning contract.
- A permissive shell proof runner became a smaller direct-spawn trust boundary.
  This intentionally rejects pipes, chaining, substitutions, redirections,
  environment prefixes, broad default commands, and paths outside the repo.
- Product-owner-specific lifecycle labels became `needs_owner`; application
  design gates became generic UX/UI artifacts and dependency rules.
- A mutable project-board standup operator became a read-only artifact standup
  plus optional read-only GitHub health.

### Application extensions that remain outside the portable core

- Product UI, databases, workflow services, cases, approvals, role projection,
  training records, provider credentials, and application domain schemas.
- Cloud deployment, production smoke, browser-route proof, release watchers,
  hosted status publication, and source-specific local release manifests.
- Project-board claiming, issue mutation, pull-request land trains, scheduled
  operators, and other external side effects.
- Application-only topology checks, framework migration guards, protocol
  parity checks, telemetry requirements, and source-corpus quality scores.
- Design-training bundles, rubric evaluators, browser evidence schemas, and
  product-specific UX gate names. The portable Assignment keeps the lifecycle
  and evidence hooks without pretending those systems are universal.

All reusable Assignment, Program, and ExecPlan mechanics are extracted. The
items above are application integrations and domain policy, not reduced
versions of the planning loop. A consumer can put deployment or product proof
commands in an ExecPlan, add an adapter, or build a board integration without
changing the planning contracts.

## Does Not Own

- A compatibility promise for private or application-specific source modules.
- A mandate to reproduce every source-repository check.
- The current implementation details of any originating product.

## Next

- [Architecture](ARCHITECTURE.md)
- [Planning model](PLANS.md)
- [Command-line interface](CLI.md)
- [Prompt index](prompts/README.md)
- [Skill index](skills/README.md)
