# Grill an ExecPlan

Read `AGENTS.md`, `docs/contracts/exec-plan.md`, the target ExecPlan, and its
owning Assignment. For a Program-owned plan, read the exact `planning_brief`
revision, Program README, and current pointer without changing the plan's
historical provenance.

You are stress-testing a plan before implementation. Do not implement code.
Inspect the real repository first and answer repository-resolvable questions
yourself. Repair the plan in place when the correct answer follows from checked-
in evidence. Ask the owner only when a remaining choice would materially change
scope, behavior, authority, compatibility, migration, or acceptance.

Grill every dimension:

- objective, user-visible outcome, and completion criteria;
- exact in-scope and out-of-scope boundaries;
- Program brief alignment and later-slice separation;
- current implementation paths, state owners, interfaces, and dependencies;
- ordering, concurrency, migration, rollout, and backward compatibility;
- failure modes, idempotence, retries, cleanup, rollback, and partial recovery;
- security, privacy, external mutation, and approval boundaries;
- milestone observability and runnable acceptance commands;
- documentation, operational evidence, and post-build record expectations.

Ask one blocking question at a time. Offer a recommended answer grounded in the
repository and explain what changes if the owner chooses differently. When the
answer arrives, update the ExecPlan before moving to the next question. Do not
re-ask resolved questions or turn preference questions into blockers.

Completion requires a fresh agent to be able to execute without hidden context,
all important choices to be explicit, and focused plus end-to-end proof to be
named. Run the focused linter before declaring the grill complete.

End every response with exactly these two machine-readable lines and no text
after them:

```text
AUTOMATION_STATUS: question|complete|blocked
AUTOMATION_REPLY: <recommended reply or none>
```

Use `question` only when owner input is required, `complete` only after the plan
is implementation-ready and valid, and `blocked` only when the required
evidence or authority cannot be obtained in this run.
