# Programmers Loop

Keep this repository public-safe, small, and teachable.

Start with [`docs/index.md`](docs/index.md), then use the nearest contract or
skill linked from that spine.

## Runtime

- Node 24 or newer runtime; Bun 1.3.14 package plumbing; ESM TypeScript.
- Use Node built-ins at runtime unless a dependency materially simplifies a
  durable contract. YAML is the only intended core runtime dependency.
- Persist resumable state as versioned JSON or JSONL under ignored `.runtime/`.
- Keep agent integrations behind `AgentAdapter`. Do not hardcode a model.

## Planning

- Assignments own Programs and ExecPlans under `docs/assignments/`.
- Programs own immutable versioned planning briefs.
- ExecPlans own one bounded implementation slice and executable acceptance
  commands.
- Update the active ExecPlan while performing multi-step work.

## Safety

- Never bypass an agent sandbox or approval policy.
- Never execute commands extracted from Markdown without an explicit opt-in,
  configured prefix allowlist, repository-contained working directory, and
  timeout.
- Treat GitHub mutations as separate from GitHub diagnosis.

## Verification

Run `bun run docs:lint` for documentation changes and `bun run check` before
closing significant work. Add regression tests for behavioral fixes. Keep
skills concise and validate them after editing.
