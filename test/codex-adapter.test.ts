import assert from "node:assert/strict"
import test from "node:test"

import {
  buildCodexExecArgs,
  codexAuthMode,
  parseCodexUsage,
} from "../src/agents/codex.js"
import type { ProgrammersLoopConfig } from "../src/config.js"
import { liveAdapter } from "../src/evals/runner.js"

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

test("does not force a model, profile, or reasoning effort", () => {
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
  assert.equal(
    args.some((arg) => arg.startsWith("model_reasoning_effort")),
    false,
  )
})

test("threads reasoning effort as a quoted TOML config override", () => {
  // Verified against codex-cli 0.144.3: `-c model_reasoning_effort="high"` is
  // accepted (exit 0). The value is TOML-parsed, hence the inner quotes, and it
  // rides alongside the approval-policy override rather than replacing it.
  const fresh = buildCodexExecArgs(
    { cwd: "/tmp/example", prompt: "Work", sandbox: "workspace-write" },
    "/tmp/last-message.md",
    "high",
  )
  const at = fresh.indexOf('model_reasoning_effort="high"')
  assert.ok(at > 0, "effort override must be present")
  assert.equal(fresh[at - 1], "--config")
  assert.ok(fresh.includes('approval_policy="never"'))
  assert.equal(fresh.at(-1), "-")

  // Effort is threaded on the resume path too.
  const resumed = buildCodexExecArgs(
    {
      cwd: "/tmp/example",
      prompt: "Continue",
      sandbox: "workspace-write",
      sessionId: "019f62aa-0000-7000-8000-000000000001",
    },
    "/tmp/last-message.md",
    "xhigh",
  )
  assert.ok(resumed.includes('model_reasoning_effort="xhigh"'))
})

test("resumes the exact agent session without selecting an ambient last session", () => {
  const args = buildCodexExecArgs(
    {
      cwd: "/tmp/example",
      prompt: "Continue the grill",
      sandbox: "workspace-write",
      sessionId: "019f62aa-0000-7000-8000-000000000001",
    },
    "/tmp/last-message.md",
  )

  assert.deepEqual(args.slice(0, 4), [
    "exec",
    "resume",
    "019f62aa-0000-7000-8000-000000000001",
    "--json",
  ])
  assert.equal(args.includes("--last"), false)
  assert.equal(args.includes("--cd"), false)
  assert.equal(args.at(-1), "-")
})

test("parses the live codex-cli 0.144.3 turn.completed usage shape", () => {
  // Real events captured from `codex exec --json` (codex-cli 0.144.3). The only
  // usage carrier is a per-turn `usage` object on `turn.completed`; there is no
  // `token_count` event and no cumulative `total_token_usage`. `input_tokens`
  // is inclusive of `cached_input_tokens` and is normalized to the fresh-input
  // convention. `item.completed` entries that are not tool activity (here an
  // advisory `error` note and the final `agent_message`) do not count as tools.
  const usage = parseCodexUsage([
    {
      type: "thread.started",
      thread_id: "019f6331-3a58-7b21-8601-af506cd3f13c",
    },
    { type: "turn.started" },
    {
      type: "item.completed",
      item: {
        id: "item_0",
        type: "error",
        message:
          "Skill descriptions were shortened to fit the 2% skills context budget.",
      },
    },
    {
      type: "item.completed",
      item: { id: "item_1", type: "agent_message", text: "ok" },
    },
    {
      type: "turn.completed",
      usage: {
        input_tokens: 18117,
        cached_input_tokens: 9984,
        output_tokens: 5,
        reasoning_output_tokens: 0,
      },
    },
  ])

  assert.deepEqual(usage, {
    inputTokens: 8133,
    outputTokens: 5,
    cachedInputTokens: 9984,
    reasoningTokens: 0,
    modelCalls: 1,
    toolCalls: 0,
    costUsd: null,
    authMode: null,
  })
})

test("sums per-turn Codex usage and counts tool executions", () => {
  const usage = parseCodexUsage([
    { type: "thread.started", thread_id: "t2" },
    {
      type: "item.completed",
      item: { id: "i1", type: "command_execution", command: "ls" },
    },
    {
      type: "turn.completed",
      usage: {
        input_tokens: 900,
        cached_input_tokens: 100,
        output_tokens: 150,
        reasoning_output_tokens: 40,
      },
    },
    {
      type: "item.completed",
      item: { id: "i2", type: "agent_message", text: "done" },
    },
    {
      type: "turn.completed",
      usage: {
        input_tokens: 1100,
        cached_input_tokens: 600,
        output_tokens: 250,
        reasoning_output_tokens: 60,
      },
    },
  ])

  assert.deepEqual(usage, {
    inputTokens: 1300,
    outputTokens: 400,
    cachedInputTokens: 700,
    reasoningTokens: 100,
    modelCalls: 2,
    toolCalls: 1,
    costUsd: null,
    authMode: null,
  })
})

test("prefers a cumulative token total when a CLI reports one (defensive fallback)", () => {
  // codex-cli 0.144.3 does NOT emit these shapes; the cumulative
  // `total_token_usage`/`info` handling is retained only as a defensive
  // fallback for other or future CLI event layouts.
  const usage = parseCodexUsage([
    { type: "thread.started", thread_id: "t1" },
    {
      type: "token_count",
      info: {
        total_token_usage: {
          input_tokens: 1200,
          cached_input_tokens: 200,
          output_tokens: 300,
          reasoning_output_tokens: 50,
          total_tokens: 1550,
        },
        last_token_usage: {
          input_tokens: 1200,
          cached_input_tokens: 200,
          output_tokens: 300,
        },
      },
    },
    {
      type: "token_count",
      info: {
        total_token_usage: {
          input_tokens: 2400,
          cached_input_tokens: 400,
          output_tokens: 700,
          reasoning_output_tokens: 120,
          total_tokens: 3220,
        },
      },
    },
    { type: "turn.completed" },
  ])

  assert.deepEqual(usage, {
    inputTokens: 2000,
    outputTokens: 700,
    cachedInputTokens: 400,
    reasoningTokens: 120,
    modelCalls: null,
    toolCalls: null,
    costUsd: null,
    authMode: null,
  })
})

test("returns null usage when Codex events carry no usage signal", () => {
  assert.equal(
    parseCodexUsage([{ type: "thread.started", thread_id: "t3" }, "noise", 42]),
    null,
  )
  assert.equal(parseCodexUsage([]), null)
})

test("codexAuthMode maps auth.json contents to an auth mode", () => {
  // Codex `AuthMode` serializes lowercase; `chatgpt`/`chatgptAuthTokens` are
  // subscription auth, `apikey` bills per token. Structure verified against a
  // live ~/.codex/auth.json (auth_mode="chatgpt", OPENAI_API_KEY: null).
  assert.equal(
    codexAuthMode('{"auth_mode":"chatgpt","OPENAI_API_KEY":null}'),
    "subscription",
  )
  assert.equal(
    codexAuthMode('{"auth_mode":"chatgptAuthTokens"}'),
    "subscription",
  )
  assert.equal(codexAuthMode('{"auth_mode":"apikey"}'), "api-key")
  // API-key fallback when auth_mode is absent but a key is stored.
  assert.equal(
    codexAuthMode('{"OPENAI_API_KEY":"sk-example-value"}'),
    "api-key",
  )
  // Never guessed: unknown mode, empty key, non-JSON, and null all yield null.
  assert.equal(codexAuthMode('{"auth_mode":"other"}'), null)
  assert.equal(codexAuthMode('{"OPENAI_API_KEY":""}'), null)
  assert.equal(codexAuthMode("not json"), null)
  assert.equal(codexAuthMode(null), null)
})

function configWithAgent(
  agent: Partial<ProgrammersLoopConfig["agent"]>,
): ProgrammersLoopConfig {
  return {
    schemaVersion: 1,
    planningRoot: "docs/assignments",
    agent: {
      adapter: "codex",
      command: "codex",
      maxOutputBytes: 1_048_576,
      model: null,
      profile: null,
      runTimeoutMs: 30_000,
      ...agent,
    },
    github: { repository: null },
    proof: {
      allowedCommandPrefixes: [],
      commandTimeoutMs: 30_000,
      maxOutputBytes: 65_536,
    },
  }
}

test("liveAdapter selects the configured coding-agent CLI", () => {
  assert.equal(
    liveAdapter(configWithAgent({ adapter: "codex", command: "codex" })).id,
    "codex",
  )
  assert.equal(
    liveAdapter(configWithAgent({ adapter: "claude", command: "claude" })).id,
    "claude",
  )
})
