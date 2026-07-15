import assert from "node:assert/strict"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"

import { ClaudeAdapter } from "../src/agents/claude.js"
import { CodexAdapter } from "../src/agents/codex.js"
import {
  addAgentUsage,
  estimateCostUsd,
  MODEL_LIST_PRICES,
} from "../src/agents/types.js"
import type { AgentUsage } from "../src/agents/types.js"
import { readRuntimeJson, writeRuntimeJson } from "../src/runtime/store.js"
import { sumUsage } from "../src/workflows/exec-plan.js"
import type {
  AgentAttempt,
  WorkflowReceipt,
} from "../src/workflows/exec-plan.js"

const subscriptionUsage: AgentUsage = {
  inputTokens: 100,
  outputTokens: 10,
  cachedInputTokens: null,
  reasoningTokens: 5,
  modelCalls: 1,
  toolCalls: 0,
  costUsd: 0.01,
  authMode: "subscription",
}

const apiKeyUsage: AgentUsage = {
  inputTokens: 50,
  outputTokens: null,
  cachedInputTokens: 20,
  reasoningTokens: null,
  modelCalls: 1,
  toolCalls: 2,
  costUsd: null,
  authMode: "api-key",
}

test("estimateCostUsd prices tokens against the pinned list table", () => {
  const sonnet = MODEL_LIST_PRICES.models["claude-sonnet-5"]
  assert.ok(sonnet, "pinned table must include claude-sonnet-5")

  const estimate = estimateCostUsd(
    { inputTokens: 9520, cachedInputTokens: 25317, outputTokens: 4 },
    sonnet,
  )
  assert.ok(estimate !== null)
  assert.ok(Math.abs(estimate - 0.0362151) < 1e-9)

  assert.equal(
    estimateCostUsd(
      { inputTokens: null, cachedInputTokens: null, outputTokens: null },
      sonnet,
    ),
    null,
  )
  // Partial counts price only the known components; nothing is guessed.
  assert.equal(
    estimateCostUsd(
      { inputTokens: 1_000_000, cachedInputTokens: null, outputTokens: null },
      sonnet,
    ),
    3,
  )
  assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(MODEL_LIST_PRICES.asOf))
})

test("gpt-5.6 tiers reprice from tokens and are flagged unverified", () => {
  const terra = MODEL_LIST_PRICES.models["gpt-5.6-terra"]
  assert.ok(terra, "pinned table must include gpt-5.6-terra")

  // Repricing a gpt-5.6-terra episode yields a non-null figure (Decision D12).
  const estimate = estimateCostUsd(
    {
      inputTokens: 1_000_000,
      cachedInputTokens: 1_000_000,
      outputTokens: 1_000_000,
    },
    terra,
  )
  assert.ok(estimate !== null)
  // 2.5 fresh input + 0.25 cached + 15 output per MTok.
  assert.ok(Math.abs(estimate - 17.75) < 1e-9)

  // Every gpt-5.6 row is present, priced, and marked unverified with an as-of
  // date so repricing outputs can flag figures that were not confirmed live.
  for (const id of ["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"] as const) {
    const row = MODEL_LIST_PRICES.models[id]
    assert.ok(row, `pinned table must include ${id}`)
    assert.equal(row.unverified, true, `${id} must be flagged unverified`)
    assert.ok(row.asOf, `${id} must carry a pricing as-of date`)
    assert.ok(row.inputUsdPerMTok > 0 && row.outputUsdPerMTok > 0)
  }
})

test("addAgentUsage accumulates without inventing missing fields", () => {
  assert.deepEqual(addAgentUsage(subscriptionUsage, apiKeyUsage), {
    inputTokens: 150,
    outputTokens: 10,
    cachedInputTokens: 20,
    reasoningTokens: 5,
    modelCalls: 2,
    toolCalls: 2,
    costUsd: 0.01,
    authMode: null,
  })
})

test("sumUsage rolls attempts up and treats mixed auth modes as unknown", () => {
  const total = sumUsage([
    { usage: subscriptionUsage },
    { usage: null },
    { usage: apiKeyUsage },
  ])
  assert.ok(total)
  assert.equal(total.inputTokens, 150)
  assert.equal(total.cachedInputTokens, 20)
  assert.equal(total.modelCalls, 2)
  assert.equal(total.authMode, null)

  assert.equal(sumUsage([{ usage: null }]), null)
  assert.equal(sumUsage([]), null)
  const same = sumUsage([
    { usage: subscriptionUsage },
    { usage: subscriptionUsage },
  ])
  assert.equal(same?.authMode, "subscription")
})

test("workflow receipts round-trip usage and events paths", async () => {
  const repoRoot = await mkdtemp(
    path.join(os.tmpdir(), "programmers-loop-usage-"),
  )
  try {
    const attempt: AgentAttempt = {
      eventsPath: ".runtime/agent-events/claude-example.jsonl",
      exitCode: 0,
      lastMessage: "ok",
      round: 1,
      sessionId: "s1",
      stderr: "",
      stderrTruncated: false,
      timedOut: false,
      usage: subscriptionUsage,
    }
    const receipt: WorkflowReceipt = {
      schemaVersion: 1,
      runId: "execute-usage-roundtrip",
      phase: "execute",
      planPath: "docs/assignments/example.md",
      startedAt: "2026-07-14T00:00:00.000Z",
      completedAt: "2026-07-14T00:01:00.000Z",
      status: "completed",
      attempts: [attempt],
      proofReceipts: [],
      message: "done",
      receiptPath: ".runtime/workflows/exec-plans/execute-usage-roundtrip.json",
    }
    await writeRuntimeJson({
      relativePath: receipt.receiptPath,
      repoRoot,
      value: receipt,
    })
    const loaded = await readRuntimeJson<WorkflowReceipt>({
      relativePath: receipt.receiptPath,
      repoRoot,
    })
    assert.ok(loaded)
    assert.deepEqual(loaded, receipt)
    assert.deepEqual(sumUsage(loaded.attempts), subscriptionUsage)
  } finally {
    await rm(repoRoot, { force: true, recursive: true })
  }
})

async function writeFakeAgent(dir: string, lines: string[]): Promise<string> {
  const script = path.join(dir, "fake-agent.sh")
  const body = [
    "#!/bin/sh",
    "cat >/dev/null",
    ...lines.map((line) => `printf '%s\\n' '${line}'`),
    "",
  ].join("\n")
  await writeFile(script, body, { encoding: "utf8", mode: 0o755 })
  return script
}

test("CodexAdapter persists a durable JSONL event stream, usage, and auth mode", async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "programmers-loop-codex-"))
  const codexHome = await mkdtemp(path.join(os.tmpdir(), "codex-home-"))
  try {
    // Real event lines captured from `codex exec --json` (codex-cli 0.144.3):
    // the sole usage carrier is `turn.completed.usage`, `input_tokens` includes
    // `cached_input_tokens`, and the two `item.completed` entries are non-tool.
    const script = await writeFakeAgent(cwd, [
      '{"type":"thread.started","thread_id":"019f6331-3a58-7b21-8601-af506cd3f13c"}',
      '{"type":"turn.started"}',
      '{"type":"item.completed","item":{"id":"item_0","type":"error","message":"Skill descriptions were shortened to fit the 2% skills context budget."}}',
      '{"type":"item.completed","item":{"id":"item_1","type":"agent_message","text":"ok"}}',
      '{"type":"turn.completed","usage":{"input_tokens":18117,"cached_input_tokens":9984,"output_tokens":5,"reasoning_output_tokens":0}}',
    ])
    // Subscription auth file mirroring the real ~/.codex/auth.json structure.
    await writeFile(
      path.join(codexHome, "auth.json"),
      JSON.stringify({ auth_mode: "chatgpt", OPENAI_API_KEY: null }),
    )
    const adapter = new CodexAdapter(script, { codexHome })
    const result = await adapter.run({
      cwd,
      prompt: "hello",
      sandbox: "read-only",
    })

    assert.equal(result.exitCode, 0)
    assert.equal(result.sessionId, "019f6331-3a58-7b21-8601-af506cd3f13c")
    assert.ok(result.eventsPath?.startsWith(".runtime/agent-events/"))
    const raw = await readFile(path.join(cwd, result.eventsPath ?? ""), "utf8")
    assert.equal(raw.trimEnd().split("\n").length, 5)
    assert.deepEqual(result.usage, {
      inputTokens: 8133,
      outputTokens: 5,
      cachedInputTokens: 9984,
      reasoningTokens: 0,
      modelCalls: 1,
      toolCalls: 0,
      costUsd: null,
      authMode: "subscription",
    })
  } finally {
    await rm(cwd, { force: true, recursive: true })
    await rm(codexHome, { force: true, recursive: true })
  }
})

test("ClaudeAdapter persists events and reads the result record", async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "programmers-loop-claude-"))
  try {
    const script = await writeFakeAgent(cwd, [
      '{"type":"system","subtype":"init","session_id":"s9","apiKeySource":"none"}',
      '{"type":"assistant","session_id":"s9","message":{"role":"assistant","content":[{"type":"text","text":"ok"}],"usage":{"input_tokens":7,"cache_creation_input_tokens":3,"cache_read_input_tokens":11,"output_tokens":2}}}',
      '{"type":"result","subtype":"success","is_error":false,"result":"ok","session_id":"s9","total_cost_usd":0.005,"usage":{"input_tokens":7,"cache_creation_input_tokens":3,"cache_read_input_tokens":11,"output_tokens":2}}',
    ])
    const adapter = new ClaudeAdapter(script)
    const result = await adapter.run({
      cwd,
      prompt: "hello",
      sandbox: "workspace-write",
    })

    assert.equal(result.exitCode, 0)
    assert.equal(result.sessionId, "s9")
    assert.equal(result.lastMessage, "ok")
    assert.ok(result.eventsPath?.startsWith(".runtime/agent-events/"))
    const raw = await readFile(path.join(cwd, result.eventsPath ?? ""), "utf8")
    assert.equal(raw.trimEnd().split("\n").length, 3)
    assert.deepEqual(result.usage, {
      inputTokens: 10,
      outputTokens: 2,
      cachedInputTokens: 11,
      reasoningTokens: null,
      modelCalls: 1,
      toolCalls: 0,
      costUsd: 0.005,
      authMode: "subscription",
    })
  } finally {
    await rm(cwd, { force: true, recursive: true })
  }
})
