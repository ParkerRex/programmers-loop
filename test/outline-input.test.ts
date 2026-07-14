import assert from "node:assert/strict"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"

import {
  loadCodexSessionTranscript,
  loadOutlineSource,
  readExecPlanHandoffAsOutline,
} from "../src/outline-input.js"

test("Codex session JSONL becomes a bounded role-preserving transcript", async () => {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "programmers-loop-session-"),
  )
  try {
    const sessionPath = path.join(root, "session.jsonl")
    await writeFile(
      sessionPath,
      [
        JSON.stringify({
          type: "session_meta",
          payload: { id: "session-123", cwd: "/private/work" },
        }),
        JSON.stringify({
          type: "response_item",
          payload: {
            type: "message",
            role: "user",
            content: [{ type: "input_text", text: "Build the workflow" }],
          },
        }),
        JSON.stringify({
          type: "response_item",
          payload: {
            type: "message",
            role: "assistant",
            phase: "commentary",
            content: [{ type: "output_text", text: "Inspecting the repo" }],
          },
        }),
      ].join("\n"),
    )

    const transcript = await loadCodexSessionTranscript(sessionPath)
    assert.equal(transcript.sessionId, "session-123")
    assert.equal(transcript.messages.length, 2)
    assert.match(transcript.renderedTranscript, /Build the workflow/)
    assert.match(transcript.renderedTranscript, /assistant \(commentary\)/)
    assert.doesNotMatch(transcript.renderedTranscript, /private\/work/)
  } finally {
    await rm(root, { force: true, recursive: true })
  }
})

test("a versioned workshop handoff becomes deterministic outline source", async () => {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "programmers-loop-handoff-"),
  )
  try {
    const handoffPath = path.join(root, "handoff.json")
    await writeFile(
      handoffPath,
      JSON.stringify({
        version: "1",
        sourceRunId: "run-123",
        producedAt: "2026-07-14T12:00:00.000Z",
        problemStatement: "The request needs a durable boundary.",
        purpose: "Qualify it for ExecPlan writing.",
        userVisibleOutcome: "An operator can review the bounded slice.",
        inScope: ["normalize the request"],
        outOfScope: ["implement the slice"],
        assumptions: ["the repository is available"],
        risks: ["scope drift"],
        testCommands: ["bun run check"],
        nextAction: "Write the ExecPlan.",
        handoffNotes: ["keep the slice narrow"],
      }),
    )

    const source = await readExecPlanHandoffAsOutline(handoffPath)
    assert.match(source, /# Systems Workshop Handoff/)
    assert.match(source, /## Out Of Scope/)
    assert.match(source, /- keep the slice narrow/)
    assert.equal(
      await loadOutlineSource({
        inputPath: handoffPath,
        kind: "handoff",
        repoRoot: root,
      }),
      source,
    )
  } finally {
    await rm(root, { force: true, recursive: true })
  }
})

test("session input rejects malformed JSONL instead of silently dropping it", async () => {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "programmers-loop-session-"),
  )
  try {
    const sessionPath = path.join(root, "broken.jsonl")
    await writeFile(sessionPath, "{not json}\n")
    await assert.rejects(loadCodexSessionTranscript(sessionPath), /line 1/)
  } finally {
    await rm(root, { force: true, recursive: true })
  }
})
