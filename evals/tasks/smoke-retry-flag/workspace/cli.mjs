#!/usr/bin/env node
import { access } from "node:fs/promises"

export const USAGE = [
  "Usage: pulse [options] <path>",
  "",
  "Checks that <path> exists and reports the result.",
  "",
  "Options:",
  "  --json   Print the result as a JSON object.",
  "  --quiet  Print nothing on success.",
  "  --help   Show this message.",
].join("\n")

export function parseArgs(argv) {
  const options = { help: false, json: false, quiet: false, target: null }
  for (const arg of argv) {
    if (arg === "--help") options.help = true
    else if (arg === "--json") options.json = true
    else if (arg === "--quiet") options.quiet = true
    else if (arg.startsWith("--")) return { error: `Unknown option: ${arg}` }
    else if (options.target === null) options.target = arg
    else return { error: `Unexpected argument: ${arg}` }
  }
  if (!options.help && options.target === null) {
    return { error: "Missing <path> argument" }
  }
  return { options }
}

export async function defaultAttempt(target) {
  try {
    await access(target)
    return true
  } catch {
    return false
  }
}

export async function runCli(argv, attempt = defaultAttempt) {
  const parsed = parseArgs(argv)
  if (parsed.error !== undefined) {
    return { exitCode: 2, output: `${parsed.error}\n\n${USAGE}` }
  }
  const { options } = parsed
  if (options.help) return { exitCode: 0, output: USAGE }
  const ok = await attempt(options.target)
  if (options.json) {
    return {
      exitCode: ok ? 0 : 1,
      output: JSON.stringify({ target: options.target, ok }),
    }
  }
  if (ok) {
    return { exitCode: 0, output: options.quiet ? "" : `ok ${options.target}` }
  }
  return { exitCode: 1, output: `missing ${options.target}` }
}

if (import.meta.url === new URL(process.argv[1] ?? "", "file:").href) {
  const result = await runCli(process.argv.slice(2))
  if (result.output !== "") process.stdout.write(`${result.output}\n`)
  process.exitCode = result.exitCode
}
