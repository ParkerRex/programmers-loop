#!/usr/bin/env node

export function runCli(args) {
  const [command, name] = args
  if (command === "greet" && name) return `Hello, ${name}!`
  return "Usage: tiny greet <name>"
}

if (import.meta.url === new URL(process.argv[1] ?? "", "file:").href) {
  process.stdout.write(`${runCli(process.argv.slice(2))}\n`)
}
