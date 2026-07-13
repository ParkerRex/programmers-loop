export type CommandDefinition = {
  command: string
  summary: string
  usage: string
  details: string[]
}

export const COMMANDS: readonly CommandDefinition[] = [
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
    usage: "programmers-loop program lint --path <program> [--json]",
    details: [
      "Validates packet files, immutable briefs, and the current pointer.",
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
    usage: "programmers-loop exec-plan lint --path <plan.md> [--json]",
    details: ["Validation never executes commands found in Markdown."],
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
  const rows = COMMANDS.map(
    (entry) => `  ${entry.command.padEnd(19)} ${entry.summary}`,
  ).join("\n")
  return `Programmers Loop

Durable planning, critique, execution, and proof loops for coding agents.

Usage:
  programmers-loop <command> [options]

Commands:
${rows}
  help [command]      Show help for one command.

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
