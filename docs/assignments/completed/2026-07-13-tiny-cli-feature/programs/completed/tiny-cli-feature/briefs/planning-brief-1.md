---
title: "Build the tiny CLI greeting command"
program_id: tiny-cli-feature
brief_version: 1
status: current
summary: "Implement one dependency-free command with pure-function tests."
read_when:
  - "Writing or reviewing the child ExecPlan."
---

# Build the tiny CLI greeting command

Create `runCli(args)` so `greet Ada` returns `Hello, Ada!`; otherwise return
`Usage: tiny greet <name>`. Add a process entrypoint and Node tests. Do not add
dependencies, packaging, or other commands.
