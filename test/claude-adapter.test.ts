import assert from "node:assert/strict"
import test from "node:test"

import {
  buildClaudeArgs,
  buildClaudeEnv,
  SMALL_FAST_MODEL_ENV,
  summarizeClaudeEvents,
} from "../src/agents/claude.js"

function flagValue(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag)
  return index === -1 ? undefined : args[index + 1]
}

test("builds a non-interactive read-only Claude invocation", () => {
  const args = buildClaudeArgs(
    {
      cwd: "/tmp/example",
      prompt: "Inspect the repository",
      sandbox: "read-only",
      model: "claude-sonnet-5",
      ephemeral: true,
      maxTurns: 4,
    },
    null,
  )

  assert.equal(args[0], "-p")
  assert.equal(flagValue(args, "--output-format"), "stream-json")
  assert.ok(args.includes("--verbose"))
  assert.equal(flagValue(args, "--setting-sources"), "project,local")
  assert.ok(args.includes("--strict-mcp-config"))
  assert.ok(args.includes("--no-session-persistence"))
  const disallowed = flagValue(args, "--disallowedTools") ?? ""
  for (const tool of ["Bash", "Edit", "Write", "NotebookEdit"]) {
    assert.ok(disallowed.includes(tool), `read-only must disallow ${tool}`)
  }
  assert.equal(flagValue(args, "--model"), "claude-sonnet-5")
  assert.equal(flagValue(args, "--max-turns"), "4")
  assert.equal(args.includes("--permission-mode"), false)
  assert.equal(args.includes("--allowedTools"), false)
  assert.equal(args.includes("--dangerously-skip-permissions"), false)
  // The prompt travels over stdin, never argv.
  assert.equal(args.includes("Inspect the repository"), false)
})

test("pins reasoning effort with --effort when requested, omits it otherwise", () => {
  // Claude Code 2.1.206 exposes `--effort <level>` (confirmed in `claude
  // --help`), so a per-run reasoningEffort is applied, not merely recorded.
  const withEffort = buildClaudeArgs(
    {
      cwd: "/tmp/example",
      prompt: "Do the work",
      sandbox: "workspace-write",
      reasoningEffort: "high",
    },
    null,
  )
  assert.equal(flagValue(withEffort, "--effort"), "high")

  const withoutEffort = buildClaudeArgs(
    { cwd: "/tmp/example", prompt: "Do the work", sandbox: "workspace-write" },
    null,
  )
  assert.equal(withoutEffort.includes("--effort"), false)
})

test("workspace-write permits edits and commands without a blanket bypass", () => {
  const args = buildClaudeArgs(
    { cwd: "/tmp/example", prompt: "Do the work", sandbox: "workspace-write" },
    null,
  )

  assert.equal(args[0], "-p")
  assert.equal(flagValue(args, "--permission-mode"), "acceptEdits")
  const allowed = flagValue(args, "--allowedTools") ?? ""
  for (const tool of ["Bash", "Edit", "Write", "NotebookEdit"]) {
    assert.ok(allowed.includes(tool), `workspace-write must allow ${tool}`)
  }
  assert.equal(args.includes("--disallowedTools"), false)
  assert.equal(args.includes("--dangerously-skip-permissions"), false)
  assert.equal(args.includes("--model"), false)
  assert.equal(args.includes("--max-turns"), false)
  assert.equal(args.includes("--no-session-persistence"), false)
})

test("resumes the exact session and forwards a structured-output schema", () => {
  const args = buildClaudeArgs(
    {
      cwd: "/tmp/example",
      prompt: "Continue the grill",
      sandbox: "workspace-write",
      sessionId: "60836775-2b54-4617-9eef-3fbf6c06c39a",
      ephemeral: true,
    },
    '{"type":"object"}',
  )

  assert.equal(
    flagValue(args, "--resume"),
    "60836775-2b54-4617-9eef-3fbf6c06c39a",
  )
  // Resumed sessions stay persistent so later rounds can resume again.
  assert.equal(args.includes("--no-session-persistence"), false)
  assert.equal(flagValue(args, "--json-schema"), '{"type":"object"}')
})

const initEvent = {
  type: "system",
  subtype: "init",
  session_id: "s1",
  apiKeySource: "none",
  model: "claude-sonnet-5",
}

const assistantEvent = {
  type: "assistant",
  session_id: "s1",
  message: {
    role: "assistant",
    content: [
      { type: "tool_use", id: "tu1", name: "Read", input: {} },
      { type: "text", text: "ok" },
    ],
    usage: {
      input_tokens: 3490,
      cache_creation_input_tokens: 6030,
      cache_read_input_tokens: 25317,
      output_tokens: 4,
    },
  },
}

const resultEvent = {
  type: "result",
  subtype: "success",
  is_error: false,
  num_turns: 1,
  result: "ok",
  session_id: "s1",
  total_cost_usd: 0.0548861,
  usage: {
    input_tokens: 3490,
    cache_creation_input_tokens: 6030,
    cache_read_input_tokens: 25317,
    output_tokens: 4,
  },
}

test("extracts session, usage, cost, and auth mode from a Claude stream", () => {
  const summary = summarizeClaudeEvents([
    initEvent,
    assistantEvent,
    resultEvent,
  ])

  assert.equal(summary.sessionId, "s1")
  assert.equal(summary.lastMessage, "ok")
  assert.deepEqual(summary.usage, {
    // input_tokens plus cache_creation_input_tokens.
    inputTokens: 9520,
    outputTokens: 4,
    cachedInputTokens: 25317,
    reasoningTokens: null,
    modelCalls: 1,
    toolCalls: 1,
    costUsd: 0.0548861,
    authMode: "subscription",
  })
})

test("falls back to summed assistant usage when the result line is missing", () => {
  const secondAssistant = {
    type: "assistant",
    session_id: "s1",
    message: {
      role: "assistant",
      content: [{ type: "text", text: "wrapping up" }],
      usage: {
        input_tokens: 10,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 100,
        output_tokens: 6,
      },
    },
  }
  const summary = summarizeClaudeEvents([
    { ...initEvent, apiKeySource: "ANTHROPIC_API_KEY" },
    assistantEvent,
    secondAssistant,
  ])

  assert.equal(summary.lastMessage, "wrapping up")
  assert.deepEqual(summary.usage, {
    inputTokens: 9530,
    outputTokens: 10,
    cachedInputTokens: 25417,
    reasoningTokens: null,
    modelCalls: 2,
    toolCalls: 1,
    costUsd: null,
    authMode: "api-key",
  })
})

test("returns empty summary details for an empty stream", () => {
  const summary = summarizeClaudeEvents([])

  assert.equal(summary.usage, null)
  assert.equal(summary.sessionId, undefined)
  assert.equal(summary.lastMessage, "")
})

test("pins the utility model to the subject model when a model is set", () => {
  const baseEnv: NodeJS.ProcessEnv = {
    PATH: "/usr/bin",
    ANTHROPIC_BASE_URL: "https://example",
  }
  const env = buildClaudeEnv(
    {
      cwd: "/tmp/example",
      prompt: "Inspect the repository",
      sandbox: "read-only",
      model: "claude-sonnet-5",
    },
    baseEnv,
  )

  // The utility-model pin travels in the spawn env, matching the subject model.
  assert.equal(env[SMALL_FAST_MODEL_ENV], "claude-sonnet-5")
  // The rest of the parent env passes through alongside the pin.
  assert.equal(env.PATH, "/usr/bin")
  assert.equal(env.ANTHROPIC_BASE_URL, "https://example")
  // The caller's env object is not mutated in place.
  assert.equal(baseEnv[SMALL_FAST_MODEL_ENV], undefined)
})

test("leaves the utility model unpinned when no model is set", () => {
  const baseEnv: NodeJS.ProcessEnv = { PATH: "/usr/bin" }
  const env = buildClaudeEnv(
    { cwd: "/tmp/example", prompt: "Do the work", sandbox: "workspace-write" },
    baseEnv,
  )

  // No model configured, so no pin is added...
  assert.equal(env[SMALL_FAST_MODEL_ENV], undefined)
  // ...and the parent env passes through untouched.
  assert.equal(env, baseEnv)
})
