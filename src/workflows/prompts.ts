import { readFile } from "node:fs/promises"
import path from "node:path"

export const PROMPT_PATHS = {
  "exec-plan.execute": "prompts/exec-plans/execute.md",
  "exec-plan.grill": "prompts/exec-plans/grill.md",
  "exec-plan.outline": "prompts/exec-plans/outline.md",
  "exec-plan.validate": "prompts/exec-plans/validate.md",
  "exec-plan.workflow": "prompts/exec-plans/workflow.md",
  "exec-plan.write": "prompts/exec-plans/write.md",
  "program.orchestrate": "prompts/programs/orchestrate.md",
} as const

export type RuntimePrompt = keyof typeof PROMPT_PATHS

export async function loadRuntimePrompt(
  _repoRoot: string,
  prompt: RuntimePrompt,
): Promise<string> {
  const packageRoot = path.resolve(import.meta.dirname, "../..")
  return readFile(path.join(packageRoot, PROMPT_PATHS[prompt]), "utf8")
}

export function renderPrompt(
  base: string,
  blocks: Record<string, string | undefined>,
): string {
  const rendered = Object.entries(blocks)
    .filter((entry): entry is [string, string] => entry[1] !== undefined)
    .map(([name, value]) => `<${name}>\n${value.trim()}\n</${name}>`)
    .join("\n\n")
  return `${base.trim()}\n\n${rendered}\n`
}
