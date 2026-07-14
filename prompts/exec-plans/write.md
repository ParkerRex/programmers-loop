# Write an ExecPlan

Read the repository `AGENTS.md`, `docs/index.md`, and
`docs/contracts/exec-plan.md` first. Read the owning Assignment. When the plan
is Program-owned, also read `docs/contracts/program.md`, the Program README,
`briefs/current.txt`, and the exact immutable planning brief that will be
stamped into the plan.

You are authoring or updating one self-contained living ExecPlan. Do not
implement product code. Inspect the real code paths, data boundaries,
interfaces, tests, and owning documentation before writing. Resolve questions
from the repository where possible; ask only the minimum blocking owner
questions when materially different implementations remain.

Before editing, confirm:

- the exact target path under an active `exec-plans/active/` lane;
- the approved planning source and bounded slice;
- the Assignment or Program owner;
- compatibility, migration, safety, rollback, and proof constraints;
- whether any unresolved question prevents a safe plan.

The plan must use the complete contract frontmatter. Program-owned plans must
pair `program_id` with the repository-relative path to
`planning-brief-<N>.md`; never stamp `briefs/current.txt`. New plans use
`status: active`, `completed_at: null`, and `post_build_recap: null`.

Use the required sections in contract order. Immediately after the orientation
prose, include non-empty `### In Scope` and `### Out Of Scope` subsections in
that order. Include this exact sentence:

This ExecPlan must be maintained in accordance with `docs/contracts/exec-plan.md`.

Plan requirements:

- Explain the user-visible outcome and how someone observes it working.
- Define every term a newcomer needs; do not rely on chat history.
- Name exact repository-relative files, modules, functions, types, interfaces,
  commands, working directories, and expected observations.
- Explain state ownership, failure modes, retries, cleanup, and recovery.
- Turn meaningful unknowns into explicit spike milestones before broad work.
- Keep later Program slices out of scope even when adjacent code is convenient.
- Give every milestone an observable end state and focused proof.
- Put checkboxes only in Progress and keep them current during execution.
- Include runnable commands under `### Test Commands`; prose is not proof.
- Seed Surprises, Decision Log, Outcomes, Artifacts, and Interfaces so they can
  be maintained as the work proceeds.

Before returning, run the focused ExecPlan linter. Confirm the plan is
self-contained, its provenance is immutable, scope is explicit, commands are
runnable, recovery is concrete, and no implementation work is hidden behind a
vague milestone. Remove the explicit `programmers-loop:placeholder` marker and
all scaffold instructions only after replacing them with repository-specific
content. Edit only the target plan and return its path, chosen slice, milestone
count, remaining assumptions, and validation result.
