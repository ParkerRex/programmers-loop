# smoke-retry-flag authoring notes (hidden)

Bounded feature task: add `--retry <n>` to a small dependency-free CLI.

## Why it is interesting

The existing `parseArgs` is a flagless `for...of` loop; a value-taking
option forces a small parser rework. The injectable `attempt` seam
(`runCli(argv, attempt)`) is how the grader observes retry behavior
deterministically without touching the filesystem or timers.

## Required semantics

- `--retry <n>`: after a failed check, retry up to `n` more times; succeed
  as soon as one attempt passes (total attempts = 1 + n on full failure,
  and no further attempts after a success).
- `--retry 0` and the flag being absent both mean exactly one attempt.
- `n` must be a non-negative integer; anything else (including a missing
  value) is a usage error: exit code 2 and zero attempts.
- `--help` output documents `--retry`.
- Existing behavior is unchanged: `--json` object still includes `target`
  and `ok`, `--quiet` still prints nothing on success, unknown options and
  a missing target still exit 2, failures still exit 1.

The grader only drives the public `runCli(argv, attempt)` seam with a
counting stub, so any parser or control-flow rewrite with these semantics
passes.

## Grader components

- functional: retry semantics and validation above;
- regression: existing flags, outputs, and exit codes;
- scope: only `cli.mjs` and `*.test.mjs` files may change. Uses
  `git diff --name-only` (root commit to HEAD, plus porcelain status) when
  the sandbox itself is a git repository; otherwise falls back to comparing
  every non-allowed file against pinned sha256 baselines and flagging
  unexpected new files.
