import assert from "node:assert/strict"
import test from "node:test"

import { buildCodexExecArgs } from "../src/agents/codex.js"

test("builds a sandboxed non-interactive Codex invocation", () => {
  const args = buildCodexExecArgs(
    {
      cwd: "/tmp/example",
      prompt: "Do the work",
      sandbox: "workspace-write",
      model: "example-model",
      profile: "cheap",
      ephemeral: true,
      outputSchemaPath: "/tmp/schema.json",
    },
    "/tmp/last-message.md",
  )

  assert.deepEqual(args.slice(0, 3), ["exec", "--cd", "/tmp/example"])
  assert.ok(args.includes("workspace-write"))
  assert.ok(args.includes("--json"))
  assert.ok(args.includes("--ephemeral"))
  assert.ok(args.includes("example-model"))
  assert.ok(args.includes("cheap"))
  assert.equal(args.at(-1), "-")
  assert.equal(args.includes("--yolo"), false)
  assert.equal(
    args.includes("--dangerously-bypass-approvals-and-sandbox"),
    false,
  )
})

test("does not force a model or profile", () => {
  const args = buildCodexExecArgs(
    {
      cwd: "/tmp/example",
      prompt: "Inspect",
      sandbox: "read-only",
    },
    "/tmp/last-message.md",
  )

  assert.equal(args.includes("--model"), false)
  assert.equal(args.includes("--profile"), false)
})
