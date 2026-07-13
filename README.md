# Programmers Loop

![An abstract blue loop connecting a work packet, convergence, and verified proof.](assets/programmers-loop-hero.png)

Programmers Loop is a small, agent-neutral Node runtime for turning coding-agent
work into durable plans, bounded implementation, and deterministic proof.

## Why this exists

The most capable frontier models can often hold an entire implementation in
context and improvise a good development process as they go. With those models,
an explicit orchestration layer can feel unnecessary.

That changes quickly with cheaper models, long-running work, handoffs, failures,
and context loss. The model may still be capable of writing the code, but it
benefits enormously when the repository provides the memory and discipline:

- what problem is being solved;
- which decisions are settled;
- what belongs in the current slice;
- how to recover when execution stops; and
- what observable evidence counts as done.

Programmers Loop externalizes those habits into versioned artifacts, concise
skills, checked-in prompts, validators, and doctors. The goal is not to make a
smaller model magically smarter. It is to give that model a better workbench—and
to make the development loop inspectable, teachable, and portable between
agents.

## The loop

```text
Assignment
  -> Program research and convergence
  -> immutable planning brief
  -> ExecPlan write, grill, execute, validate
  -> Program refresh
  -> next slice or completion
```

- **Assignment** is the umbrella packet for one coherent body of work.
- **Program** turns ambiguous, multi-slice work into evidence-backed decisions
  and immutable planning briefs.
- **ExecPlan** owns one bounded implementation slice and its acceptance
  commands.

Everything important is checked into Git. Chat history and model memory are
helpful, but neither is the source of truth.

## What is included

- Assignment, Program, and ExecPlan contracts and scaffolds.
- Focused and repository-wide planning validators.
- A provider-neutral `AgentAdapter`, with a Codex CLI adapter first.
- Read-only local and GitHub doctors plus an active-work standup.
- Reusable skills for workshop, planning, execution, docs, diagnosis, and proof.
- Checked-in Program and ExecPlan prompt loops.
- An enforced Markdown documentation spine.
- Human-readable output, stable JSON, dry runs, path containment, and explicit
  CLI exit codes.

The runtime targets Node 24 or newer. Bun 1.3.14 is the sole package manager and
script launcher.

## Quick start

```bash
git clone https://github.com/ParkerRex/programmers-loop.git
cd programmers-loop
bun install --frozen-lockfile
bun run check
```

Explore the interface:

```bash
bun run cli -- --help
bun run cli -- standup
bun run cli -- skills list
bun run cli -- prompts list
```

Create a first packet without writing anything:

```bash
bun run cli -- assignment create \
  --slug example \
  --title "Example Assignment" \
  --dry-run
```

The complete command and output contract lives in the
[CLI reference](docs/CLI.md). Start with the
[documentation index](docs/index.md) for architecture, planning contracts,
development, reliability, and security.

## Status

The portable foundation, documentation spine, artifact interfaces, skill pack,
and doctors are implemented and dogfooded in this repository. Safe proof-command
execution and the resumable Program state machine remain active work.

Valid Markdown never implies permission to execute its commands. Future proof
execution must require explicit consent, configured allowlists, repository
containment, timeouts, and durable receipts.

## License

[MIT](LICENSE)
