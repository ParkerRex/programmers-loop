import assert from "node:assert/strict"
import path from "node:path"
import test from "node:test"

import type { ProgrammersLoopConfig } from "../src/config.js"
import { EXAMPLE_PLAN, formatDemoReport, runDemo } from "../src/demo.js"

const config: ProgrammersLoopConfig = {
  schemaVersion: 1,
  planningRoot: "docs/assignments",
  agent: {
    adapter: "codex",
    command: "codex",
    maxOutputBytes: 65_536,
    model: null,
    profile: null,
    runTimeoutMs: 30_000,
  },
  github: { repository: null },
  proof: {
    allowedCommandPrefixes: ["bun run"],
    commandTimeoutMs: 30_000,
    maxOutputBytes: 65_536,
  },
}

test("the demo is a read-only tour with an actionable next step", async () => {
  const repoRoot = path.resolve(import.meta.dirname, "..")
  const report = await runDemo(
    { config, repoRoot },
    {
      async runDoctor() {
        return {
          status: "pass",
          checks: [
            {
              id: "planning-contracts",
              scope: "local",
              status: "pass",
              detail: "valid",
            },
          ],
        }
      },
      async previewProof() {
        return {
          commands: [
            {
              allowed: true,
              argv: ["bun", "run", "test:examples"],
              command: "bun run test:examples",
              reason: null,
            },
          ],
          executable: true,
          planPath: EXAMPLE_PLAN,
        }
      },
    },
  )

  assert.equal(report.status, "pass")
  assert.equal(report.readOnly, true)
  assert.equal(report.planning.valid, true)
  assert.deepEqual(
    report.hierarchy.map((artifact) => artifact.kind),
    ["Assignment", "Program", "ExecPlan"],
  )
  assert.match(formatDemoReport(report), /Nothing was executed or changed\./)
  assert.match(formatDemoReport(report), /assignment create/)
})
