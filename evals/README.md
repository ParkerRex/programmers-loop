# Evaluation task packages

This directory holds versioned task packages for the model-overhang
evaluation (`docs/MODEL-OVERHANG-EVAL.md`). A task package is the unit an
episode runner consumes: it deterministically resets one evaluation task
without revealing the hidden acceptance criteria to the evaluated agent.

The TypeScript contract lives in `src/evals/task-package.ts`
(`loadTaskPackage`, `materializeWorkspace`, `workspaceFingerprint`,
`parseGraderSummary`).

## Package layout

```text
evals/tasks/<id>/
  task.yaml     public manifest (schema below)
  workspace/    starting repository snapshot for the evaluated agent
  graders/      HIDDEN acceptance; never materialized into the sandbox
    grade.mjs   entry script: node graders/grade.mjs <sandboxDir>
  reference/    HIDDEN authoring aids (optional)
```

The names `graders` and `reference` are reserved: they may not appear as a
path segment anywhere inside `workspace/`, and materialization fails closed
if they would ever reach a sandbox.

## task.yaml schema (schema_version 1)

| Field                                              | Meaning                                                                                                 |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `schema_version`                                   | Must equal `1`.                                                                                         |
| `id`                                               | Kebab-case slug; must match the package directory name.                                                 |
| `version`                                          | Positive integer; bump on any change to workspace, grader, or manifest.                                 |
| `title`                                            | Human-readable task name.                                                                               |
| `request`                                          | The concise developer-facing prompt handed to the agent.                                                |
| `setup_command`                                    | Command run in the sandbox before the agent starts, or `null`.                                          |
| `tool_policy.network`                              | Always `deny`; only offline tasks are supported.                                                        |
| `budgets.max_wall_ms` / `max_phases` / `max_turns` | Positive integers; hard episode ceilings.                                                               |
| `workflow_shape`                                   | `skip`, `exec-plan`, or `program`: the smallest route the task should exercise.                         |
| `expected_stratum`                                 | `saturation`, `substitution`, `frontier-overhang`, `reliability`, or `null` until calibrated.           |
| `scope.allowed_paths`                              | Globs relative to the workspace root the agent may modify (`*` within a segment, `**` across segments). |
| `scope.forbidden_paths`                            | Explicitly protected paths (informational; graders enforce independently).                              |
| `provenance.source`                                | `synthetic-public` or `private`.                                                                        |
| `provenance.contamination_notes`                   | How the task could leak and how results must be interpreted.                                            |
| `provenance.canary`                                | GUID embedded verbatim in at least one workspace file; validated at load time.                          |
| `grader.command`                                   | Argv list; `command[0]` is a package-relative script under `graders/`.                                  |
| `grader.timeout_ms`                                | Positive integer grader ceiling.                                                                        |

## Grader protocol

The runner executes, from the package directory:

```bash
node <command[0]> <...command slice 1> <sandboxDir>
```

A grader must be deterministic and offline, use only Node built-ins, print
exactly one JSON line to stdout, and exit `0` only when every component
passes:

```json
{ "functional": true, "regression": true, "scope": true, "notes": [] }
```

- `functional`: hidden acceptance for the requested behavior.
- `regression`: pre-existing behavior is intact.
- `scope`: only allowed files changed (via `git diff --name-only` when the
  sandbox is its own git repository, degrading to sha256 content baselines
  when git is absent).

Graders must accept any correct implementation, not one blessed patch, and
must never be materialized into the sandbox or shown to the evaluated
agent. The evaluated model must not generate its own acceptance criteria.

## Determinism and reset

`materializeWorkspace` copies `workspace/` (and nothing else) into an empty
destination in stable sorted order; symbolic links are rejected.
`workspaceFingerprint` hashes relative paths plus file bytes, so two resets
of the same package version are byte-identical. Never edit a shipped
version in place; bump `version` instead.

## Public smoke tasks

The two packages here are public and disposable. They exist to smoke-test
the contract and the episode runner, not to measure models: their graders
are published beside them, so treat any score as contaminated calibration
data.

- `smoke-json-lines` (false-completion trap): the visible test suite is
  deliberately weak; the hidden grader adds stricter functional cases and a
  malformed-input-must-throw check that fails naive "swallow the error"
  fixes, plus regression and scope checks.
- `smoke-retry-flag` (bounded feature): add `--retry <n>` to a small CLI;
  the hidden grader drives the injectable `runCli(argv, attempt)` seam with
  a counting stub and enforces flag validation, retry semantics, regression
  of existing flags, and scope.

Because the trap task ships an intentionally failing visible test, do not
point repo-wide test runners at `evals/tasks/**` (the repository's `bun run
test` glob already excludes it).

## Adding a task

1. Create `evals/tasks/<id>/` with the layout above; embed a fresh canary
   GUID in a workspace file the agent has no reason to touch.
2. Keep the workspace dependency-free or declare a `setup_command`.
3. Write the grader against observable behavior, not one expected diff, and
   verify it passes at least two distinct correct implementations and fails
   the plausible naive ones.
4. Run `loadTaskPackage` (see `test/evals-task-package.test.ts`) until it
   reports zero issues.

## Authoring toolkit (`evals task-init`)

`evals task-init` (see `src/evals/task-init.ts`) turns a real source repo plus
an accepted-work commit into a task-package skeleton, automating steps 1–2
above and scaffolding step 3. It is the force multiplier for authoring the
private calibration tasks.

```bash
programmers-loop evals task-init \
  --source <path-to-git-repo> --commit <accepted-sha> \
  --slug <task-slug> [--output <dir>] [--request "<text>"] [--execute] [--json]
```

Preview is the default; `--execute` writes the package. The **parent** of
`--commit` becomes the `workspace/` snapshot, so the evaluated agent starts
from the pre-change tree and the accepted commit is one valid answer. The
snapshot is produced with `git archive` (no `.git`, no history), and the tool
verifies no `.git` reaches `workspace/`.

- **Default output is `.runtime/evals/private-tasks/<slug>`** (git-ignored).
  Headline tasks are private and must never be committed to this public repo
  (Decision D5); a loud warning fires if `--output` lands inside the tracked
  tree.
- **Prefilled** in `task.yaml`: `schema_version`, `id`, `version`, `title`
  (commit subject), `request` (from `--request`, else a placeholder),
  `tool_policy`, `expected_stratum: null`, `scope.allowed_paths` (the accepted
  commit's changed files), `provenance` (`source: private`, contamination
  notes with source/commit/date, a freshly generated canary GUID), and the
  grader command.
- **Left as `TODO`** (inline YAML comments): `workflow_shape` (a sentinel that
  intentionally fails validation), `setup_command`, `budgets`, and a review
  marker on `scope`.
- **Canary injection:** the GUID is embedded as a comment in the shallowest
  comment-friendly workspace file the agent has no reason to touch (outside
  `allowed_paths`), which doubles as a free scope tripwire. Its location is
  recorded in `reference/notes.md`.
- **`graders/grade.mjs`** is a runnable scaffold with the standard JSON summary
  contract. Its scope check is complete (git-diff with the sha256 no-git
  fallback, baselines generated from the snapshot); the `functional` and
  `regression` sections are clearly-marked `TODO`s and default to `false` so a
  fresh grader never grades green by accident.
- **`reference/notes.md`** captures the accepted commit's message and diffstat
  as an authoring aid (never shipped to a sandbox).

After writing, the tool runs `loadTaskPackage` and prints an authoring
checklist plus the validation issues. A fresh skeleton reports exactly one
schema issue (the `workflow_shape` sentinel); exit `0` means "skeleton written,
TODOs remain", exit `1` means an unexpected (generator-bug) issue, and exit `2`
is a usage error.

## Episode runner

The minimal episode runner (`src/evals/`) turns task packages into scored
episodes under two harness conditions and grades them deterministically. It
never makes a live agent call in tests: `test/evals-runner.test.ts` injects a
scripted mock adapter, and real model runs belong to a later workstream.

### Episode and run model (`manifest.ts`)

An **episode** is one immutable matrix cell: `{episodeId, taskId, system, rep,
seed}`, where `system` is `direct` or `loop`. A **run manifest** is the ordered
episode list plus the frozen configuration inputs (adapter id, model,
`prompts/` tree hash, and this repository's git SHA) hashed into `configHash`.
`buildManifest` is pure — episode ids, ordering, and `baseSeed + index` seeds
depend only on inputs, so a plan is reproducible and the git SHA degrades to
`null` rather than throwing when git is unavailable.

Every episode ends in exactly one terminal state:

| Terminal state           | Meaning                                                |
| ------------------------ | ------------------------------------------------------ |
| `verified_success`       | Grader passed (both runs agreed, exit 0).              |
| `verified_failure`       | Grader failed (both runs agreed, non-zero exit).       |
| `timeout`                | Agent run exceeded `budgets.max_wall_ms`.              |
| `budget_exhausted`       | Loop stopped before a phase would exceed `max_phases`. |
| `owner_blocked`          | Loop grill halted for owner input (scored a failure).  |
| `harness_failure`        | Agent plumbing failed with no usable work product.     |
| `infrastructure_failure` | Grader crashed/disagreed, or sandbox setup failed.     |

Durable records are written atomically under
`.runtime/evals/runs/<runId>/`: `manifest.json` plus
`episodes/<episodeId>.json`. Re-running the same `runId` skips any episode that
already has a terminal record, so a run resumes by filling gaps and never
re-calls the adapter for finished work.

### Sandbox lifecycle

Each episode materializes the task workspace into
`.runtime/evals/sandboxes/<runId>/<episodeId>/`, records the pristine
`workspaceFingerprint` **before** any treatment or git metadata, writes an eval
`.gitignore`, applies the Loop treatment when required, and then makes a single
`git init` + baseline commit. Committing before the agent runs makes the
grader's `git diff root..HEAD` and `git status --porcelain` show only the
agent's own edits, and having a real commit history that starts at the baseline
means history mining is impossible.

The `.gitignore` lists the exact paths the runner introduces — `.runtime/`
(agent-event transcripts, phase receipts, and the Loop CLI shim, written in
**both** conditions or the loop condition respectively), `/docs/assignments/`,
`/docs/contracts/`, and `/programmers-loop.config.yaml` (the sandbox-local Loop
config) — so planning artifacts and treatment surface never count as
out-of-scope changes. Exact paths are ignored rather than a blanket `docs/` so a
task shipping its own docs cannot be silently hidden.

### Cross-arm budget semantics

Both arms are bounded identically so a scored comparison measures the treatment,
not a budget asymmetry (issue #7; the earlier asymmetry was smoke-report defect
E2). The semantics are versioned (`BUDGET_SEMANTICS_VERSION`) and recorded on
every episode's `budget` block and on the run manifest's
`budgetSemanticsVersion`:

- **`max_wall_ms` is a per-EPISODE total in both arms.** The direct arm's single
  call is bounded by it. The loop arm tracks one deadline across the spine and
  hands each phase only the _remaining_ budget (via a budgeted adapter wrapper),
  so multi-round phases cannot each restart the full clock; when the remainder is
  spent the episode terminates `timeout`.
- **`max_turns` is a per-agent-CALL cap in both arms.** The direct arm passes it
  as the single call's turn cap; the loop arm injects the same cap into every
  phase call (the workflow's `runAgent` sets none on its own). CLIs that ignore
  turn caps (Codex) still record the intent.
- **`max_phases` additionally bounds the loop spine.** Each of write → grill →
  execute → validate counts as one phase; exhausting the ceiling terminates
  `budget_exhausted` (distinct from `timeout`).

The manifest also stamps the adapter binary version (from `adapter.doctor()`,
resolved once per executed run) and each episode records any `AGENTS.md` the
materialized workspace carried (`agentsMdPaths`), pinning the remaining
baseline-identity gaps from issue #7.

### Direct baseline

One `workspace-write` agent run in the sandbox with the task request plus the
shared no-human preamble (`NO_HUMAN_PREAMBLE`, the identical text used by both
arms per `docs/evals/DECISIONS.md`). Wall budget comes from
`budgets.max_wall_ms` and turns from `budgets.max_turns`. Outcome mapping:
`timedOut → timeout`; exit 0 → grade; non-zero exit with a work product (a
non-empty `git status`) → grade (the grader judges the artifact); non-zero exit
with no work product → `harness_failure`.

### Loop treatment (foreign repository root)

The exec-plan workflow already binds to a `repoRoot` parameter and its agent
`cwd`, and it reads its phase prompts from **this** repository's `prompts/` via
`import.meta.dirname` — not from `repoRoot`. The Loop harness therefore reuses
the existing `writeExecPlan` / `grillExecPlan` / `executeExecPlan` /
`validateExecPlan` functions unchanged, pointing `repoRoot` at the sandbox. No
workflow code is forked. Sandbox preparation copies
`docs/contracts/exec-plan.md` (the execute prompt asks the agent to read it) and
scaffolds a standalone Assignment plus one ExecPlan at
`docs/assignments/active/<date>-<id>/exec-plans/active/<date>-<id>.md` — the
exact path the ExecPlan lint pattern expects, which is why `repoRoot` must equal
the sandbox. Scaffold date and slug are fixed so sandboxes stay reproducible.

**Treatment materialization is specified and recorded** (issue #8). The loop arm
also injects a sandbox-local `programmers-loop.config.yaml` and an executable
`programmers-loop` shim under `.runtime/loop-bin/` that runs this repository's
CLI (`bun --no-install <repo>/src/cli.ts`) against the sandbox as cwd. This makes
the write/grill prompts' focused-linter instruction (`programmers-loop
exec-plan lint …`) satisfiable inside the sandbox — live grill runs previously
observed `exit 127` and blocked (grill-triage-002) — while the sibling config
keeps `findRepoRoot` from walking up and escaping the sandbox. The shim is placed
on the episode's PATH for the agent's child processes and is network-inert. The
direct arm receives none of this. The full injected set (contract, config, shim,
Assignment, ExecPlan) is recorded on the episode's `treatment.injectedPaths`.

The harness drives the fixed spine write → grill → execute → validate. Each
spine phase counts as one phase against `budgets.max_phases`; when the next
phase would exceed the cap the run stops with `budget_exhausted` (so a
tight-budget "skip" task honestly surfaces forced-orchestration overhead). A
grill that ends in a question or blocked state maps to `owner_blocked` — the
treatment must never consult a human. Validation runs with proof commands off;
the hidden task grader is the acceptance oracle. Every phase receipt path and a
`sumUsage` rollup are recorded on the episode.

### Grading (`grade.ts`)

The task grader is run twice from the package directory, exactly as the grader
contract specifies, with the grader tree left in place and never copied into the
sandbox. Two separate processes are used (never an in-process import, which
would cache and mask nondeterminism). A crash or timeout, or any disagreement on
the scored decision between the two runs, is an `infrastructure_failure` with an
audit note — never silently scored as a model result.

### CLI

- `programmers-loop evals plan --tasks <dir> --systems direct,loop --reps <N>
[--json]` — read-only; prints the deterministic episode matrix and config
  hash with no spend.
- `programmers-loop evals run --run-id <id> --tasks <dir> --systems ...
--reps <N> [--retain] [--execute] [--json]` — preview by default; `--execute`
  drives the harnesses and writes records. Re-running the id resumes.
- `programmers-loop evals grade --episode <record.json> [--json]` — regrades a
  retained sandbox for one episode record.
- `programmers-loop evals corpus-manifest --tasks <dir> [--output <file>]
[--json]` — read-only; validates every package and emits a deterministic,
  versioned manifest pinning each task's version, workspace fingerprint,
  `task.yaml` hash, and hidden grader hashes. This is the freeze artifact a
  scored study hashes to prove the corpus never shifted.

## Containerized scored runs

Decision D11 requires scored episodes to run inside a pinned Linux container;
the macOS temp-dir sandbox is acceptable for unscored smoke only. This is the
groundwork for that path (ADR `.runtime/evals/sandbox-adr.md`, option i:
API-key-in-container). Grading always stays on the host — the hidden graders are
never mounted into the container.

### Enabling it

Container mode is off by default. Opt in per config:

```yaml
sandbox:
  mode: container # host (default) | container
  image: loopbench-sandbox:node24
  network: none # none (enforced) | allowlist (declared; awaits an API key)
```

Build the image first (no repo code is baked in — the workspace is bind-mounted
at run time):

```bash
docker build -f evals/docker/Dockerfile -t loopbench-sandbox:node24 evals/docker
# add --build-arg INSTALL_CLAUDE=true for the Claude adapter
```

The seam is a `ProcessLauncher` (`src/agents/types.ts`) injected into the
adapter: host mode uses the identity launcher (byte-for-byte the prior host
spawn), container mode wraps each adapter spawn in `docker run` via
`makeContainerLauncher` (`src/evals/sandbox.ts`). No adapter logic is forked.

### What is machine-enforced vs. still declared

| Control                      | Host mode                              | Container mode (`network: none`)                                                          |
| ---------------------------- | -------------------------------------- | ----------------------------------------------------------------------------------------- |
| Filesystem containment       | path-checks only (not kernel-enforced) | **enforced** — container rootfs + a single bind mount                                     |
| Execution environment        | the operator's macOS host              | **enforced** — pinned image, config digest recorded per episode                           |
| Network egress denial        | not enforced                           | **enforced** — `--network none`, an isolated namespace with no interfaces (kernel-denied) |
| Egress to the model endpoint | n/a                                    | **declared, not wired** — see below                                                       |

`--network none` denies _all_ egress, including the model endpoint, so it cannot
back a live model call. Reaching exactly `api.openai.com` (plus declared
registries) and nothing else — the ADR's anticipated scored path — needs a proxy
sidecar on an internal network. That orchestration is **not wired in this
version**: a live `network: allowlist` run is _refused_ (never silently
downgraded to weaker egress control). Only the reusable allowlist predicate
(`isHostAllowed`) and this topology note ship as groundwork. So **live scored
container episodes await an API key** and the allowlisted-egress path; today
container mode machine-enforces filesystem containment, the pinned execution
environment, and total egress denial.

Every episode records its posture honestly in a `sandbox` block: `mode`, `image`,
`imageDigest` (the local image **config** id from `docker image inspect` — a
locally built image has no registry digest), the network policy with a candid
`enforcement` string and `liveValidated: false`, the mount path, and
`envForwarded` (env-var **names** only — see redaction below).

### Auth and cost (D12)

Subscription auth (Claude/ChatGPT logins) is host-bound and unavailable inside a
clean container, so containerized runs authenticate with an **API key**
(`OPENAI_API_KEY` for Codex, `ANTHROPIC_API_KEY` for Claude). D12 reprices every
scored economic outcome from recorded tokens at a frozen price table, so
subscription-vs-API-key does not move any scored number — it only moves real
dollars, which D7's budget governs. Keys are passed with `docker run -e NAME`
(name only): Docker reads the value from its own inherited environment, so a
secret's value never touches the argv, a receipt, or a log (asserted in
`test/evals-sandbox.test.ts`). Keys are never written to disk by this path.

### Deviations, called out

- **Identity bind mount, not a fixed `/workspace`.** The sandbox is mounted at
  the same absolute path it has on the host (`-v cwd:cwd -w cwd`) so the
  adapter's absolute-path CLI arguments resolve inside the container with zero
  rewriting — which is what keeps the seam a launcher rather than an adapter
  fork. Trade-off: the host path appears in the container transcript (a minor
  D11 reproducibility wrinkle).
- **The loop arm is not supported in container mode yet.** Its CLI shim runs
  _this_ repository's CLI, which would require bind-mounting the repo source and
  thereby exposing the hidden graders (`evals/tasks/**/graders`) into the
  container. Container mode therefore supports the **direct** arm today; the loop
  arm is refused with that reason and awaits a graders-excluded image. Run the
  loop arm on the host until then.

### Smoke

`test/evals-sandbox.test.ts` unit-tests the container command construction,
env-name redaction, config parsing, and the host identity launcher offline (no
daemon). One daemon-gated test builds a minimal image and proves `docker run
--network none` both executes a command and denies an outbound connection; it
skips cleanly when Docker is unavailable or the base image is not quickly
buildable, and it makes no model call and needs no API key.

## Adapt: failure-driven harness proposals (`evals adapt`)

```text
programmers-loop evals adapt --runs <id,...> [--output <file>] [--diversity] [--json]
```

`evals adapt` reads finished runs and produces `ADAPT-REPORT.md` — a diagnosis
of what failed and a set of concrete, evidence-linked harness edits to consider.
It is the diagnostic half of the "Better Harnesses, Smaller Models" method
(arXiv 2607.08938): read failures from the durable records and raw transcripts,
map each to an adaptation strategy, and stop at a proposal. The default output is
`.runtime/evals/adapt/<runs>/ADAPT-REPORT.md`; `--output` overrides the path.

The command is **read-only, mechanical, and makes no model call.** Classification
is derived only from evidence already on disk, so `v1` never invents a diagnosis
it cannot support.

### Proposals only — never auto-applied

Every report leads with:

> PROPOSALS ONLY — human curation required before adoption (SkillsBench:
> self-generated guidance −8.1 to −11.5pp below the no-skills baseline).

SkillsBench (arXiv 2602.12670) found that _self-generated_ guidance adopted
without human curation scored −8.1 to −11.5pp below the no-skills baseline
(Table 6). `evals adapt` therefore proposes and never writes a skill, prompt,
or policy. A
human curator accepts, rewrites, or rejects each suggestion.

### How failures are classified

Each unsuccessful episode receives one primary class from the 13-category
taxonomy in `docs/MODEL-OVERHANG-EVAL.md`, derived mechanically:

| Evidence source              | Signal                                       | Primary class        |
| ---------------------------- | -------------------------------------------- | -------------------- |
| Grading components           | `scope: false`                               | regression or scope  |
| Grading components           | `regression: false`                          | regression or scope  |
| Grading components           | `functional: false`                          | validation or proof  |
| Terminal state               | `timeout` / `budget_exhausted`               | budget or timeout    |
| Terminal state               | `owner_blocked`                              | owner-blocked        |
| Terminal state               | `harness_failure`                            | harness              |
| Terminal state               | `infrastructure_failure`                     | infrastructure       |
| Event transcript (secondary) | `tool_result` `is_error`, permission denials | tool-use signal tags |

A `verified_failure` with no recorded grade, or one whose components all pass, is
left honestly `unclassified` rather than guessed. Secondary transcript signals
(tool errors, permission denials) are attached as contributing evidence with
1-based event-line references, so a proposal cites `episode-id (transcript:line)`.

### From class to proposal

Each represented class maps to the paper's adaptation strategies (context
additions covered 86% of their fixes, tool creation 43%, tool filtering 29%;
instruction-following plus knowledge fixes covered 81%), rendered as a concrete
edit against this repository's surfaces: context additions become curated-skill
or prompt-block suggestions, tool failures become `tool_policy` suggestions, and
instruction-following gaps become contract lint-gate suggestions. Only classes
that actually occurred carry evidence-linked proposals; the full 13-class table
is printed as a curation reference.

### Tool-call-sequence diversity

Every report includes a diversity statistic (`--diversity` prints it alone):
the mean pairwise normalized Levenshtein distance between episodes' ordered
tool-call sequences, per task and across the corpus (0 = identical, 1 =
disjoint). The paper reports ρ = −0.96 between a task's diversity and the success
of a single static harness edit across its episodes, so the higher these numbers,
the less any one proposal is expected to generalize — the statistic contextualizes
every suggestion.

### Determinism

The report is a pure function of the run records and transcripts: runs and
episodes are visited in sorted / manifest order, and the only date is the
newest episode `completedAt` (never the wall clock). Two invocations over
unchanged inputs are byte-identical. A missing manifest or an unreadable
transcript (a clean-mode episode kept no sandbox) degrades to a recorded note
instead of an error, and no-transcript episodes are excluded from diversity
rather than folded in as empty sequences. `test/evals-adapt.test.ts` covers the
classification mapping, per-class proposals with evidence links, diversity math
on known sequences, determinism, and the zero-failure path.
