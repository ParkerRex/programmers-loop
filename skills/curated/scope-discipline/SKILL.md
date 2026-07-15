---
name: scope-discipline
applies_to:
  phases: [write, grill, execute, validate]
  shapes: [exec-plan]
priority: 100
lintable: "ExecPlan readiness lint requires a non-empty ### Out Of Scope subsection (src/contracts/exec-plan.ts validateScope); an edit to any path the plan lists Out Of Scope is a graded scope failure."
---

# Scope discipline

Read the declared scope before you edit anything. The plan states `### In Scope`
and `### Out Of Scope`, and the execute phase restates them to you at execution
time. Treat that boundary as binding, not advisory.

Do this:

- Implement only what `### In Scope` covers. Touch no path listed Out Of Scope.
- When an adjacent edit feels helpful but sits outside scope — updating
  `README.md`, a changelog, or nearby docs to match your change — do NOT make
  it. Record the suggestion in the Decision Log or Surprises & Discoveries and
  move on.
- If scope genuinely must widen, stop and raise it as an owner question. Do not
  silently expand In Scope.

Why this is here: in live smoke episodes an agent shipped a fully working
`--retry` flag (functional and regression checks both passed), then also
documented the flag in `README.md` — a forbidden path — and the episode graded
`verified_failure` on scope. The working feature earned no credit because one
well-intentioned out-of-scope edit sank it. A helpful-feeling doc edit is the
exact trap; the plan's Decision Log is where that impulse belongs.
