import assert from "node:assert/strict"
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"

import type { AgentAdapter, AgentRunResult } from "../src/agents/types.js"
import type { ProgrammersLoopConfig } from "../src/config.js"
import { previewProof, type ProofReceipt } from "../src/proof.js"
import {
  grillExecPlan,
  parseGrillFooter,
  validateExecPlan,
  writeExecPlan,
} from "../src/workflows/exec-plan.js"
import {
  advanceProgram,
  runProgramChildPlan,
} from "../src/workflows/program.js"
import {
  createAssignmentScaffold,
  createExecPlanScaffold,
  createProgramScaffold,
} from "../src/scaffold.js"

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

function result(lastMessage = "done"): AgentRunResult {
  return {
    events: [],
    exitCode: 0,
    lastMessage,
    stderr: "",
    stderrTruncated: false,
    timedOut: false,
  }
}

class FakeAgent implements AgentAdapter {
  readonly id = "fake"
  prompts: string[] = []

  constructor(private readonly messages: string[] = ["done"]) {}

  async doctor() {
    return { available: true, detail: "fake" }
  }

  async run(request: { prompt: string }): Promise<AgentRunResult> {
    this.prompts.push(request.prompt)
    return result(this.messages.shift() ?? "done")
  }
}

async function scaffoldProgram(repoRoot: string) {
  const assignment = await createAssignmentScaffold({
    config,
    date: "2026-07-13",
    repoRoot,
    slug: "workflow-test",
    title: "Workflow test",
  })
  return createProgramScaffold({
    assignmentPath: assignment.path,
    config,
    date: "2026-07-13",
    programId: "portable-loop",
    repoRoot,
    title: "Portable loop",
  })
}

test("ExecPlan agent phases use checked-in prompts and durable receipts", async () => {
  const repoRoot = await mkdtemp(
    path.join(os.tmpdir(), "programmers-loop-flow-"),
  )
  try {
    const program = await scaffoldProgram(repoRoot)
    const plan = await createExecPlanScaffold({
      config,
      date: "2026-07-13",
      ownerPath: program.path,
      repoRoot,
      slug: "bounded-slice",
      title: "Bounded slice",
    })
    const adapter = new FakeAgent([
      "written",
      "AUTOMATION_STATUS: complete\nAUTOMATION_REPLY: none",
      "validated",
    ])

    const written = await writeExecPlan({
      adapter,
      config,
      outline: "Keep the public interface small.",
      planPath: plan.path,
      repoRoot,
    })
    const grilled = await grillExecPlan({
      adapter,
      config,
      planPath: plan.path,
      repoRoot,
    })
    const validated = await validateExecPlan({
      adapter,
      config,
      planPath: plan.path,
      repoRoot,
    })

    assert.equal(written.status, "completed")
    assert.equal(grilled.status, "completed")
    assert.equal(validated.status, "completed")
    assert.match(adapter.prompts[0] ?? "", /feature_outline/)
    assert.match(adapter.prompts[1] ?? "", /AUTOMATION_STATUS/)
    assert.equal(parseGrillFooter(adapter.prompts[1] ?? ""), null)
    await readFile(path.join(repoRoot, written.receiptPath), "utf8")
  } finally {
    await rm(repoRoot, { force: true, recursive: true })
  }
})

test("failed agent phases still write workflow receipts", async () => {
  const repoRoot = await mkdtemp(
    path.join(os.tmpdir(), "programmers-loop-flow-"),
  )
  try {
    const program = await scaffoldProgram(repoRoot)
    const plan = await createExecPlanScaffold({
      config,
      date: "2026-07-13",
      ownerPath: program.path,
      repoRoot,
      slug: "failed-grill",
      title: "Failed grill",
    })
    const adapter: AgentAdapter = {
      id: "failing-fake",
      async doctor() {
        return { available: true, detail: "fake" }
      },
      async run() {
        return { ...result("failed"), exitCode: 1, stderr: "agent failed" }
      },
    }

    await assert.rejects(
      grillExecPlan({ adapter, config, planPath: plan.path, repoRoot }),
      /Agent run failed/,
    )
    const receiptRoot = path.join(repoRoot, ".runtime/workflows/exec-plans")
    const receiptFiles = await readdir(receiptRoot)
    assert.equal(receiptFiles.length, 1)
    const receipt = JSON.parse(
      await readFile(path.join(receiptRoot, receiptFiles[0]!), "utf8"),
    ) as { phase: string; status: string }
    assert.equal(receipt.phase, "grill")
    assert.equal(receipt.status, "failed")
  } finally {
    await rm(repoRoot, { force: true, recursive: true })
  }
})

test("validation retains the approved command set across bounded repairs", async () => {
  const repoRoot = await mkdtemp(
    path.join(os.tmpdir(), "programmers-loop-flow-"),
  )
  try {
    const program = await scaffoldProgram(repoRoot)
    const plan = await createExecPlanScaffold({
      config,
      date: "2026-07-13",
      ownerPath: program.path,
      repoRoot,
      slug: "repair-proof",
      title: "Repair proof",
    })
    const adapter = new FakeAgent(["repair one", "repair two"])
    let proofAttempt = 0
    const receipt = await validateExecPlan({
      adapter,
      config,
      executeProof: async (request): Promise<ProofReceipt> => {
        proofAttempt += 1
        const command = request.approvedPreview?.commands[0]
        assert.equal(command?.command, "bun run check")
        const passed = proofAttempt === 2
        return {
          schemaVersion: 1,
          commands: [
            {
              allowed: true,
              argv: ["bun", "run", "check"],
              command: "bun run check",
              durationMs: 1,
              exitCode: passed ? 0 : 1,
              reason: null,
              stderr: passed ? "" : "failed",
              stderrTruncated: false,
              stdout: "",
              stdoutTruncated: false,
              timedOut: false,
            },
          ],
          completedAt: new Date().toISOString(),
          planPath: request.approvedPreview?.planPath ?? plan.path,
          preview: request.approvedPreview?.commands ?? [],
          receiptPath: `.runtime/proof/fake-${proofAttempt}.json`,
          runId: `fake-${proofAttempt}`,
          startedAt: new Date().toISOString(),
          status: passed ? "passed" : "failed",
        }
      },
      executeProofCommands: true,
      planPath: plan.path,
      repoRoot,
    })

    assert.equal(receipt.status, "completed")
    assert.equal(proofAttempt, 2)
    assert.match(adapter.prompts[1] ?? "", /prior_proof_failure/)
    assert.match(adapter.prompts[1] ?? "", /bun run check/)
  } finally {
    await rm(repoRoot, { force: true, recursive: true })
  }
})

test("validation blocks when an agent changes approved proof commands", async () => {
  const repoRoot = await mkdtemp(
    path.join(os.tmpdir(), "programmers-loop-flow-"),
  )
  try {
    const program = await scaffoldProgram(repoRoot)
    const plan = await createExecPlanScaffold({
      config,
      date: "2026-07-13",
      ownerPath: program.path,
      repoRoot,
      slug: "stable-proof",
      title: "Stable proof",
    })
    const absolutePlanPath = path.join(repoRoot, plan.path)
    const approvedProof = await previewProof({
      config,
      planPath: plan.path,
      repoRoot,
    })
    const adapter: AgentAdapter = {
      id: "mutating-fake",
      async doctor() {
        return { available: true, detail: "fake" }
      },
      async run() {
        const source = await readFile(absolutePlanPath, "utf8")
        await writeFile(
          absolutePlanPath,
          source.replace("bun run check", "bun run lint"),
        )
        return result("changed proof")
      },
    }
    const receipt = await validateExecPlan({
      adapter,
      approvedProof,
      config,
      executeProof: async () => {
        throw new Error("proof must not run after commands change")
      },
      executeProofCommands: true,
      planPath: plan.path,
      repoRoot,
    })

    assert.equal(receipt.status, "blocked")
    assert.match(receipt.message, /changed the approved proof commands/)
  } finally {
    await rm(repoRoot, { force: true, recursive: true })
  }
})

test("Program child-plan runs pin and snapshot the exact brief idempotently", async () => {
  const repoRoot = await mkdtemp(
    path.join(os.tmpdir(), "programmers-loop-flow-"),
  )
  try {
    const program = await scaffoldProgram(repoRoot)
    const adapter = new FakeAgent()
    const first = await runProgramChildPlan({
      adapter,
      config,
      date: "2026-07-13",
      outline: "Implement one testable seam.",
      programPath: program.path,
      repoRoot,
      runId: "child-plan-test",
      slug: "first-slice",
      title: "First slice",
    })
    const second = await runProgramChildPlan({
      adapter,
      config,
      date: "2026-07-13",
      outline: "Implement one testable seam.",
      programPath: program.path,
      repoRoot,
      runId: "child-plan-test",
      slug: "first-slice",
      title: "First slice",
    })

    assert.equal(first.status, "completed")
    assert.deepEqual(second, first)
    assert.match(first.planningBriefPath, /planning-brief-1\.md$/)
    assert.equal(first.planningBriefSha256.length, 64)
    await readFile(path.join(repoRoot, first.planningBriefSnapshotPath), "utf8")
    await assert.rejects(
      runProgramChildPlan({
        adapter,
        config,
        date: "2026-07-13",
        programPath: program.path,
        repoRoot,
        runId: "different-run",
        slug: "first-slice",
        title: "First slice",
      }),
      /Refusing to overwrite existing child plan/,
    )
    assert.equal(adapter.prompts.length, 1)
  } finally {
    await rm(repoRoot, { force: true, recursive: true })
  }
})

test("Program advance performs one agent transition and validates afterward", async () => {
  const repoRoot = await mkdtemp(
    path.join(os.tmpdir(), "programmers-loop-flow-"),
  )
  try {
    const program = await scaffoldProgram(repoRoot)
    const adapter = new FakeAgent()
    const receipt = await advanceProgram({
      adapter,
      config,
      programPath: program.path,
      repoRoot,
    })

    assert.equal(receipt.status, "completed")
    assert.equal(adapter.prompts.length, 1)
    assert.match(adapter.prompts[0] ?? "", /program_path/)
  } finally {
    await rm(repoRoot, { force: true, recursive: true })
  }
})
