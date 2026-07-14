import assert from "node:assert/strict"
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"

import type {
  AgentAdapter,
  AgentRunRequest,
  AgentRunResult,
} from "../src/agents/types.js"
import type { ProgrammersLoopConfig } from "../src/config.js"
import { previewProof, type ProofReceipt } from "../src/proof.js"
import {
  distillExecPlanOutline,
  grillExecPlan,
  parseGrillFooter,
  runExecPlanWorkflow,
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
import { makeExecPlanReady, makeProgramReady } from "./planning-fixtures.js"

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

  async run(request: AgentRunRequest): Promise<AgentRunResult> {
    this.prompts.push(request.prompt)
    if (request.prompt.startsWith("# Write an ExecPlan")) {
      const planPath =
        /<target_execplan_path>\n([^\n]+)\n<\/target_execplan_path>/.exec(
          request.prompt,
        )?.[1]
      if (planPath) {
        await makeExecPlanReady({ planPath, repoRoot: request.cwd })
      }
    }
    return result(this.messages.shift() ?? "done")
  }
}

async function scaffoldProgram(repoRoot: string, ready = true) {
  const assignment = await createAssignmentScaffold({
    config,
    date: "2026-07-13",
    repoRoot,
    slug: "workflow-test",
    title: "Workflow test",
  })
  const program = await createProgramScaffold({
    assignmentPath: assignment.path,
    config,
    date: "2026-07-13",
    programId: "portable-loop",
    repoRoot,
    title: "Portable loop",
  })
  if (ready) await makeProgramReady({ programPath: program.path, repoRoot })
  return program
}

test("outline distillation uses a read-only agent and writes a validated artifact", async () => {
  const repoRoot = await mkdtemp(
    path.join(os.tmpdir(), "programmers-loop-flow-"),
  )
  try {
    await writeFile(
      path.join(repoRoot, "notes.md"),
      "Build one bounded seam.\n",
    )
    const outline = `# Feature Outline

## Goal

Build one bounded seam.

## User-visible outcome

The behavior is observable.

## In Scope

- One seam.

## Out Of Scope

- Release work.

## Constraints

- Keep compatibility.

## Relevant repository surfaces

- src/

## Test Commands

- bun run test

## Open Questions

- None.

## Evidence Notes

- The source request is bounded.`
    const requests: Array<{ sandbox: string }> = []
    const adapter: AgentAdapter = {
      id: "outline-fake",
      async doctor() {
        return { available: true, detail: "fake" }
      },
      async run(request) {
        requests.push({ sandbox: request.sandbox })
        return result(outline)
      },
    }
    const receipt = await distillExecPlanOutline({
      adapter,
      config,
      inputPath: "notes.md",
      outputPath: "planning/outline.md",
      repoRoot,
    })

    assert.equal(receipt.status, "completed")
    assert.equal(requests[0]?.sandbox, "read-only")
    assert.equal(
      await readFile(path.join(repoRoot, "planning/outline.md"), "utf8"),
      `${outline}\n`,
    )
  } finally {
    await rm(repoRoot, { force: true, recursive: true })
  }
})

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
    await makeExecPlanReady({ planPath: plan.path, repoRoot })
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

test("the composed ExecPlan workflow writes an outline before execution", async () => {
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
      slug: "complete-flow",
      title: "Complete flow",
    })
    const adapter = new FakeAgent([
      "written",
      "AUTOMATION_STATUS: complete\nAUTOMATION_REPLY: none",
      "executed",
      "validated",
    ])
    const receipts = await runExecPlanWorkflow({
      adapter,
      config,
      outline: "Implement the bounded behavior and prove it.",
      planPath: plan.path,
      repoRoot,
    })

    assert.deepEqual(
      receipts.map((receipt) => receipt.phase),
      ["write", "grill", "execute", "validate"],
    )
    assert.ok(receipts.every((receipt) => receipt.status === "completed"))
  } finally {
    await rm(repoRoot, { force: true, recursive: true })
  }
})

test("an untouched ExecPlan scaffold cannot enter the grill", async () => {
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
      slug: "untouched-plan",
      title: "Untouched plan",
    })
    const adapter = new FakeAgent()
    await assert.rejects(
      grillExecPlan({ adapter, config, planPath: plan.path, repoRoot }),
      /scaffold placeholders/,
    )
    assert.equal(adapter.prompts.length, 0)
  } finally {
    await rm(repoRoot, { force: true, recursive: true })
  }
})

test("the grill resumes the exact session across bounded question rounds", async () => {
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
      slug: "session-grill",
      title: "Session grill",
    })
    await makeExecPlanReady({ planPath: plan.path, repoRoot })
    const requests: AgentRunRequest[] = []
    const adapter: AgentAdapter = {
      id: "session-fake",
      async doctor() {
        return { available: true, detail: "fake" }
      },
      async run(request) {
        requests.push(request)
        if (requests.length === 1) {
          return {
            ...result(
              "AUTOMATION_STATUS: question\nAUTOMATION_REPLY: use the repository default",
            ),
            sessionId: "019f62aa-0000-7000-8000-000000000001",
          }
        }
        return result("AUTOMATION_STATUS: complete\nAUTOMATION_REPLY: none")
      },
    }
    const receipt = await grillExecPlan({
      adapter,
      config,
      planPath: plan.path,
      repoRoot,
    })

    assert.equal(receipt.status, "completed")
    assert.equal(requests[0]?.ephemeral, false)
    assert.equal(requests[1]?.sessionId, "019f62aa-0000-7000-8000-000000000001")
  } finally {
    await rm(repoRoot, { force: true, recursive: true })
  }
})

test("the grill never continues a question in a fresh ambient session", async () => {
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
      slug: "missing-session-grill",
      title: "Missing session grill",
    })
    await makeExecPlanReady({ planPath: plan.path, repoRoot })
    const adapter = new FakeAgent([
      "AUTOMATION_STATUS: question\nAUTOMATION_REPLY: use the default",
    ])

    await assert.rejects(
      grillExecPlan({ adapter, config, planPath: plan.path, repoRoot }),
      /without returning an exact session id/,
    )
    assert.equal(adapter.prompts.length, 1)
  } finally {
    await rm(repoRoot, { force: true, recursive: true })
  }
})

test("a blocked grill receipt preserves the owner-facing question", async () => {
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
      slug: "blocked-grill",
      title: "Blocked grill",
    })
    await makeExecPlanReady({ planPath: plan.path, repoRoot })
    const receipt = await grillExecPlan({
      adapter: new FakeAgent([
        "Which compatibility boundary should the plan preserve?\n\nAUTOMATION_STATUS: blocked\nAUTOMATION_REPLY: none",
      ]),
      config,
      planPath: plan.path,
      repoRoot,
    })

    assert.equal(receipt.status, "blocked")
    assert.match(receipt.message, /Which compatibility boundary/)
    assert.doesNotMatch(receipt.message, /AUTOMATION_STATUS/)
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
    await makeExecPlanReady({ planPath: plan.path, repoRoot })
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
    await makeExecPlanReady({ planPath: plan.path, repoRoot })
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
    await readFile(path.join(repoRoot, first.planSnapshotPath), "utf8")
    assert.ok((first.milestoneCount ?? 0) > 0)
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

test("Program child-plan rejects scaffold placeholders before invoking an agent", async () => {
  const repoRoot = await mkdtemp(
    path.join(os.tmpdir(), "programmers-loop-flow-"),
  )
  try {
    const program = await scaffoldProgram(repoRoot, false)
    const adapter = new FakeAgent()
    await assert.rejects(
      runProgramChildPlan({
        adapter,
        config,
        date: "2026-07-13",
        programPath: program.path,
        repoRoot,
        slug: "unsafe-slice",
        title: "Unsafe slice",
      }),
      /not execution-ready/,
    )
    assert.equal(adapter.prompts.length, 0)
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
    const researchPath = path.join(
      repoRoot,
      program.path,
      "packet/research-pass-initial.md",
    )
    const adapter: AgentAdapter = {
      id: "single-transition-fake",
      async doctor() {
        return { available: true, detail: "fake" }
      },
      async run() {
        const source = await readFile(researchPath, "utf8")
        await writeFile(
          researchPath,
          `${source.trim()}\n\nAdditional evidence is updated by one bounded transition.\n`,
        )
        return result("updated one research pass")
      },
    }
    const receipt = await advanceProgram({
      adapter,
      config,
      programPath: program.path,
      repoRoot,
    })

    assert.equal(receipt.status, "completed")
    assert.equal(receipt.transition, "research")
    assert.deepEqual(receipt.changedPaths, ["packet/research-pass-initial.md"])
  } finally {
    await rm(repoRoot, { force: true, recursive: true })
  }
})

test("Program advance rejects a semantically incomplete stage artifact", async () => {
  const repoRoot = await mkdtemp(
    path.join(os.tmpdir(), "programmers-loop-flow-"),
  )
  try {
    const program = await scaffoldProgram(repoRoot)
    const researchPath = path.join(
      repoRoot,
      program.path,
      "packet/research-pass-initial.md",
    )
    const receipt = await advanceProgram({
      adapter: {
        id: "incomplete-stage-fake",
        async doctor() {
          return { available: true, detail: "fake" }
        },
        async run() {
          await writeFile(
            researchPath,
            "# Research Pass\n\nA claim without the required evidence sections.\n",
          )
          return result("updated research")
        },
      },
      config,
      programPath: program.path,
      repoRoot,
    })

    assert.equal(receipt.status, "failed")
    assert.match(receipt.message, /meaningful ## Question section/)
  } finally {
    await rm(repoRoot, { force: true, recursive: true })
  }
})

test("Program advance rejects a run that crosses durable transition stages", async () => {
  const repoRoot = await mkdtemp(
    path.join(os.tmpdir(), "programmers-loop-flow-"),
  )
  try {
    const program = await scaffoldProgram(repoRoot)
    const programRoot = path.join(repoRoot, program.path)
    const adapter: AgentAdapter = {
      id: "multi-transition-fake",
      async doctor() {
        return { available: true, detail: "fake" }
      },
      async run() {
        await writeFile(
          path.join(programRoot, "packet/research-pass-initial.md"),
          "# Research\n\nChanged evidence.\n",
        )
        await writeFile(
          path.join(programRoot, "packet/dependency-graph.md"),
          "# Dependency Graph\n\nChanged ordering.\n",
        )
        return result("changed two stages")
      },
    }
    const receipt = await advanceProgram({
      adapter,
      config,
      programPath: program.path,
      repoRoot,
    })

    assert.equal(receipt.status, "failed")
    assert.match(receipt.message, /multiple durable transitions/)
    assert.equal(receipt.transition, null)
  } finally {
    await rm(repoRoot, { force: true, recursive: true })
  }
})

test("Program advance changes only one independent research pass", async () => {
  const repoRoot = await mkdtemp(
    path.join(os.tmpdir(), "programmers-loop-flow-"),
  )
  try {
    const program = await scaffoldProgram(repoRoot)
    const packetRoot = path.join(repoRoot, program.path, "packet")
    const researchPath = path.join(packetRoot, "research-pass-initial.md")
    const receipt = await advanceProgram({
      adapter: {
        id: "two-research-passes-fake",
        async doctor() {
          return { available: true, detail: "fake" }
        },
        async run() {
          const source = await readFile(researchPath, "utf8")
          await writeFile(researchPath, `${source}\nUpdated first pass.\n`)
          await writeFile(
            path.join(packetRoot, "research-pass-second.md"),
            `${source}\nAdded second pass.\n`,
          )
          return result("changed two research passes")
        },
      },
      config,
      programPath: program.path,
      repoRoot,
    })

    assert.equal(receipt.status, "failed")
    assert.match(receipt.message, /exactly one pass artifact/)
  } finally {
    await rm(repoRoot, { force: true, recursive: true })
  }
})

test("Program advance rejects an agent success message without durable change", async () => {
  const repoRoot = await mkdtemp(
    path.join(os.tmpdir(), "programmers-loop-flow-"),
  )
  try {
    const program = await scaffoldProgram(repoRoot)
    const receipt = await advanceProgram({
      adapter: new FakeAgent(["claimed success"]),
      config,
      programPath: program.path,
      repoRoot,
    })

    assert.equal(receipt.status, "failed")
    assert.match(receipt.message, /without making a durable Program transition/)
    assert.deepEqual(receipt.changedPaths, [])
  } finally {
    await rm(repoRoot, { force: true, recursive: true })
  }
})

test("Program advance receipts retain partial mutations from a failed agent", async () => {
  const repoRoot = await mkdtemp(
    path.join(os.tmpdir(), "programmers-loop-flow-"),
  )
  try {
    const program = await scaffoldProgram(repoRoot)
    const researchPath = path.join(
      repoRoot,
      program.path,
      "packet/research-pass-initial.md",
    )
    const receipt = await advanceProgram({
      adapter: {
        id: "partial-failure-fake",
        async doctor() {
          return { available: true, detail: "fake" }
        },
        async run() {
          const source = await readFile(researchPath, "utf8")
          await writeFile(researchPath, `${source}\nPartial mutation.\n`)
          return { ...result("failed after write"), exitCode: 1 }
        },
      },
      config,
      programPath: program.path,
      repoRoot,
    })

    assert.equal(receipt.status, "failed")
    assert.equal(receipt.transition, null)
    assert.deepEqual(receipt.changedPaths, ["packet/research-pass-initial.md"])
  } finally {
    await rm(repoRoot, { force: true, recursive: true })
  }
})

test("Program advance detects an unrelated empty directory mutation", async () => {
  const repoRoot = await mkdtemp(
    path.join(os.tmpdir(), "programmers-loop-flow-"),
  )
  try {
    const program = await scaffoldProgram(repoRoot)
    const programRoot = path.join(repoRoot, program.path)
    const receipt = await advanceProgram({
      adapter: {
        id: "directory-mutation-fake",
        async doctor() {
          return { available: true, detail: "fake" }
        },
        async run() {
          await mkdir(path.join(programRoot, "unrelated-empty-directory"))
          return result("created a directory")
        },
      },
      config,
      programPath: program.path,
      repoRoot,
    })

    assert.equal(receipt.status, "failed")
    assert.match(receipt.message, /non-file artifact/)
  } finally {
    await rm(repoRoot, { force: true, recursive: true })
  }
})
