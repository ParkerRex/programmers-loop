export type CommandDefinition = {
  command: string
  summary: string
  usage: string
  details: string[]
}

export const COMMANDS: readonly CommandDefinition[] = [
  {
    command: "demo",
    summary: "Tour the complete loop without changing anything.",
    usage: "programmers-loop demo [--json]",
    details: [
      "Runs local diagnosis, validates the bundled planning example, and previews its deterministic proof.",
      "The demo never invokes an agent, executes proof commands, or changes the repository.",
    ],
  },
  {
    command: "assignment create",
    summary: "Scaffold a valid Assignment packet.",
    usage:
      "programmers-loop assignment create --slug <slug> --title <title> [--summary <text>] [--date <YYYY-MM-DD>] [--dry-run] [--json]",
    details: [
      "Creates the packet under the configured active planning root.",
      "Refuses to overwrite an existing path.",
    ],
  },
  {
    command: "assignment lint",
    summary: "Validate one Assignment packet.",
    usage: "programmers-loop assignment lint --path <assignment> [--json]",
    details: ["Paths are repository-relative unless already absolute."],
  },
  {
    command: "program create",
    summary: "Scaffold a structurally valid Program packet.",
    usage:
      "programmers-loop program create --assignment <path> --id <id> --title <title> [--summary <text>] [--date <YYYY-MM-DD>] [--dry-run] [--json]",
    details: [
      "Initial packet and brief text are explicit placeholders and must be researched before execution.",
    ],
  },
  {
    command: "program lint",
    summary: "Validate one Program packet.",
    usage: "programmers-loop program lint --path <program> [--ready] [--json]",
    details: [
      "Validates packet files, immutable briefs, and the current pointer.",
      "--ready additionally rejects stale scaffold state and requires complete convergence plus an exact next child recommendation.",
    ],
  },
  {
    command: "program advance",
    summary: "Perform one durable Program transition.",
    usage:
      "programmers-loop program advance --path <program> [--execute] [--json]",
    details: [
      "Without --execute, reports the proposed agent phase without running it.",
      "Each invocation performs at most one transition and writes a runtime receipt.",
    ],
  },
  {
    command: "program child-plan",
    summary: "Pin a brief and write one child ExecPlan.",
    usage:
      "programmers-loop program child-plan --path <program> --slug <slug> --title <title> [--summary <text>] [--date <YYYY-MM-DD>] [--outline <file>] [--run-id <id>] [--execute] [--json]",
    details: [
      "Preview is the default. --execute snapshots the exact current brief, scaffolds the plan, invokes the writer, validates the result, and records the run.",
      "A repeated completed run-id returns its existing receipt; mismatched reuse is rejected.",
    ],
  },
  {
    command: "exec-plan create",
    summary: "Scaffold an Assignment- or Program-owned ExecPlan.",
    usage:
      "programmers-loop exec-plan create --owner <path> --slug <slug> --title <title> [--summary <text>] [--date <YYYY-MM-DD>] [--test-command <command>] [--dry-run] [--json]",
    details: [
      "Program ownership resolves and stamps the current immutable brief exactly once.",
    ],
  },
  {
    command: "exec-plan lint",
    summary: "Validate one ExecPlan.",
    usage:
      "programmers-loop exec-plan lint --path <plan.md> [--ready] [--json]",
    details: [
      "Validation never executes commands found in Markdown.",
      "--ready additionally rejects an untouched scaffold before execution.",
    ],
  },
  {
    command: "exec-plan outline",
    summary: "Distill source material into a durable feature outline.",
    usage:
      "programmers-loop exec-plan outline (--input <notes.md> | --session-jsonl <session.jsonl> | --handoff <handoff.json>) --output <outline.md> [--execute] [--json]",
    details: [
      "Preview is the default. --execute runs a read-only agent and writes validated outline Markdown without overwriting an existing file.",
      "Session and handoff inputs are parsed into bounded, normalized source material before the agent sees them.",
    ],
  },
  {
    command: "exec-plan write",
    summary: "Run the agent-neutral ExecPlan writer.",
    usage:
      "programmers-loop exec-plan write --path <plan.md> [--outline <file> | --handoff <handoff.json>] [--execute] [--json]",
    details: [
      "Preview is the default. --execute grants one bounded workspace-write agent run.",
    ],
  },
  {
    command: "exec-plan grill",
    summary: "Critique and repair an ExecPlan.",
    usage:
      "programmers-loop exec-plan grill --path <plan.md> [--max-rounds <N>] [--execute] [--json]",
    details: [
      "Uses the deterministic automation footer and a bounded recommended-reply loop.",
    ],
  },
  {
    command: "exec-plan execute",
    summary: "Execute one bounded ExecPlan slice.",
    usage:
      "programmers-loop exec-plan execute --path <plan.md> [--execute] [--json]",
    details: [
      "`execute` names the phase; the separate --execute flag is still required as explicit mutation consent.",
      "Deterministic proof remains a separate step.",
    ],
  },
  {
    command: "exec-plan proof",
    summary: "Preview or run deterministic acceptance commands.",
    usage:
      "programmers-loop exec-plan proof --path <plan.md> [--execute] [--json]",
    details: [
      "Preview is the default. Execution uses token-prefix allowlisting, direct spawning without a shell, repository containment, timeouts, bounded output, and receipts.",
    ],
  },
  {
    command: "exec-plan validate",
    summary: "Run bounded agent validation and optional proof.",
    usage:
      "programmers-loop exec-plan validate --path <plan.md> [--proof] [--max-attempts <N>] [--execute] [--json]",
    details: [
      "--execute authorizes agent repair; --proof additionally authorizes the previewed deterministic commands.",
    ],
  },
  {
    command: "exec-plan run",
    summary: "Grill, execute, validate, and optionally prove a plan.",
    usage:
      "programmers-loop exec-plan run --path <plan.md> [--outline <file> | --handoff <handoff.json>] [--proof] [--max-rounds <N>] [--max-attempts <N>] [--execute] [--json]",
    details: [
      "When --outline or --handoff is present, writes and readiness-checks the plan before grilling; otherwise the existing plan must already be execution-ready.",
      "Stops at the first incomplete phase and writes a receipt for every attempted phase.",
    ],
  },
  {
    command: "planning lint",
    summary: "Validate the complete planning tree.",
    usage: "programmers-loop planning lint [--json]",
    details: ["The legacy `programmers-loop lint` spelling remains an alias."],
  },
  {
    command: "docs lint",
    summary: "Validate the documentation spine and local links.",
    usage: "programmers-loop docs lint [--json]",
    details: [
      "Checks required routes, reachability, frontmatter, links, and anchors.",
    ],
  },
  {
    command: "standup",
    summary: "Show active work and repository health.",
    usage: "programmers-loop standup [--github] [--json]",
    details: [
      "Read-only. Add --github to include remote and authentication diagnosis.",
      "Reports lifecycle blockers, current briefs and slices, and the first unchecked ExecPlan action.",
    ],
  },
  {
    command: "doctor",
    summary: "Diagnose local and optional GitHub prerequisites.",
    usage: "programmers-loop doctor [--github] [--json]",
    details: ["Read-only. Warnings are reported separately from failures."],
  },
  {
    command: "skills list",
    summary: "List reusable agent skills.",
    usage: "programmers-loop skills list [--json]",
    details: ["Lists checked-in skills and their interface metadata paths."],
  },
  {
    command: "prompts list",
    summary: "List checked-in Program and ExecPlan prompts.",
    usage: "programmers-loop prompts list [--json]",
    details: ["Prompts remain agent-neutral checked-in assets."],
  },
] as const

export function topLevelHelp(): string {
  const width = Math.max(...COMMANDS.map((entry) => entry.command.length)) + 2
  const rows = COMMANDS.map(
    (entry) => `  ${entry.command.padEnd(width)} ${entry.summary}`,
  ).join("\n")
  return `Programmers Loop

Durable planning, critique, execution, and proof loops for coding agents.

Usage:
  programmers-loop <command> [options]

Commands:
${rows}
  ${"help [command]".padEnd(width)} Show help for one command.

Global options:
  -h, --help          Show help.
  --version           Print the version.

Run \`programmers-loop help <command>\` for command details.
`
}

export function commandHelp(topic: string): string {
  const normalized = topic.trim().replace(/\s+/g, " ")
  const exact = COMMANDS.find((entry) => entry.command === normalized)
  const matches = exact
    ? [exact]
    : COMMANDS.filter(
        (entry) =>
          entry.command === normalized ||
          entry.command.startsWith(`${normalized} `),
      )
  if (matches.length === 0) {
    throw new Error(`Unknown help topic: ${topic}`)
  }
  if (!exact && matches.length > 1) {
    return `${normalized}\n\nCommands:\n${matches
      .map((entry) => `  ${entry.command.padEnd(19)} ${entry.summary}`)
      .join("\n")}\n`
  }
  const entry = matches[0]
  if (!entry) throw new Error(`Unknown help topic: ${topic}`)
  return `${entry.command}\n\n${entry.summary}\n\nUsage:\n  ${entry.usage}\n\n${entry.details.join("\n")}\n`
}
