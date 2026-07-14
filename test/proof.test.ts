import assert from "node:assert/strict"
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"

import type { ProgrammersLoopConfig } from "../src/config.js"
import { executeProof, previewProof, tokenizeCommand } from "../src/proof.js"
import { runProcess } from "../src/process.js"

const config: ProgrammersLoopConfig = {
  schemaVersion: 1,
  planningRoot: "docs/assignments",
  agent: {
    adapter: "codex",
    command: "codex",
    maxOutputBytes: 1_048_576,
    model: null,
    profile: null,
    runTimeoutMs: 3_600_000,
  },
  github: { repository: null },
  proof: {
    allowedCommandPrefixes: ["bun run", "node --test", "git diff"],
    commandTimeoutMs: 30_000,
    maxOutputBytes: 65_536,
  },
}

async function writePlan(repoRoot: string, command: string): Promise<string> {
  const sourceRoot = path.resolve(import.meta.dirname, "..")
  const source = await readFile(
    path.join(
      sourceRoot,
      "docs/assignments/completed/2026-07-13-tiny-cli-feature/programs/completed/tiny-cli-feature/exec-plans/completed/2026-07-13-build-greet-command.md",
    ),
    "utf8",
  )
  const replaced = source
    .replace(/^program_id:.*\n/m, "")
    .replace(/^planning_brief:.*\n/m, "")
    .replace(
      /### Test Commands\n\n```bash\n[\s\S]*?\n```/,
      `### Test Commands\n\n\`\`\`bash\n${command}\n\`\`\``,
    )
  const planPath = path.join(repoRoot, "plan.md")
  await writeFile(planPath, replaced)
  return planPath
}

test("proof preview tokenizes allowlisted commands without a shell", async () => {
  const repoRoot = await mkdtemp(
    path.join(os.tmpdir(), "programmers-loop-proof-"),
  )
  try {
    const planPath = await writePlan(repoRoot, 'bun run test -- "one value"')
    const preview = await previewProof({ config, planPath, repoRoot })

    assert.equal(preview.executable, true)
    assert.deepEqual(preview.commands[0]?.argv, [
      "bun",
      "run",
      "test",
      "--",
      "one value",
    ])
    assert.deepEqual(tokenizeCommand("node --test 'one file.test.ts'"), [
      "node",
      "--test",
      "one file.test.ts",
    ])
  } finally {
    await rm(repoRoot, { force: true, recursive: true })
  }
})

test("proof preview rejects shell operators and commands outside the token allowlist", async () => {
  const repoRoot = await mkdtemp(
    path.join(os.tmpdir(), "programmers-loop-proof-"),
  )
  try {
    const operatorPlan = await writePlan(repoRoot, "bun run test && rm -rf /")
    const operatorPreview = await previewProof({
      config,
      planPath: operatorPlan,
      repoRoot,
    })
    assert.equal(operatorPreview.executable, false)
    assert.match(operatorPreview.commands[0]?.reason ?? "", /shell operator/)

    const unlistedPlan = await writePlan(repoRoot, "bunx untrusted-package")
    const unlistedPreview = await previewProof({
      config,
      planPath: unlistedPlan,
      repoRoot,
    })
    assert.equal(unlistedPreview.executable, false)
    assert.match(unlistedPreview.commands[0]?.reason ?? "", /token prefix/)
  } finally {
    await rm(repoRoot, { force: true, recursive: true })
  }
})

test("proof execution is sequential, bounded by the injected runner, and receipted", async () => {
  const repoRoot = await mkdtemp(
    path.join(os.tmpdir(), "programmers-loop-proof-"),
  )
  try {
    await mkdir(path.join(repoRoot, ".runtime"), { recursive: true })
    const planPath = await writePlan(repoRoot, "bun run test")
    const receipt = await executeProof({
      config,
      planPath,
      repoRoot,
      runProcess: async (request) => {
        assert.equal(request.command, "bun")
        assert.deepEqual(request.args, ["run", "test"])
        assert.equal(request.cwd, repoRoot)
        return {
          exitCode: 0,
          stderr: "",
          stderrTruncated: false,
          stdout: "ok\n",
          stdoutTruncated: false,
          timedOut: false,
        }
      },
    })

    assert.equal(receipt.status, "passed")
    assert.equal(receipt.commands.length, 1)
    const stored = JSON.parse(
      await readFile(path.join(repoRoot, receipt.receiptPath), "utf8"),
    ) as { status: string }
    assert.equal(stored.status, "passed")
  } finally {
    await rm(repoRoot, { force: true, recursive: true })
  }
})

test("proof spawn failures are converted into failed receipts", async () => {
  const repoRoot = await mkdtemp(
    path.join(os.tmpdir(), "programmers-loop-proof-"),
  )
  try {
    const planPath = await writePlan(repoRoot, "bun run test")
    const receipt = await executeProof({
      config,
      planPath,
      repoRoot,
      runProcess: async () => {
        throw new Error("executable missing")
      },
    })

    assert.equal(receipt.status, "failed")
    assert.match(receipt.commands[0]?.stderr ?? "", /executable missing/)
    await readFile(path.join(repoRoot, receipt.receiptPath), "utf8")
  } finally {
    await rm(repoRoot, { force: true, recursive: true })
  }
})

test("proof execution rejects a stale approved command preview", async () => {
  const repoRoot = await mkdtemp(
    path.join(os.tmpdir(), "programmers-loop-proof-"),
  )
  try {
    const planPath = await writePlan(repoRoot, "bun run test")
    const approvedPreview = await previewProof({ config, planPath, repoRoot })
    const source = await readFile(planPath, "utf8")
    await writeFile(planPath, source.replace("bun run test", "bun run lint"))

    await assert.rejects(
      executeProof({
        approvedPreview,
        config,
        planPath,
        repoRoot,
        runProcess: async () => {
          throw new Error("stale proof must not execute")
        },
      }),
      /no longer matches/,
    )
  } finally {
    await rm(repoRoot, { force: true, recursive: true })
  }
})

test("the shared process boundary truncates captured output", async () => {
  const result = await runProcess({
    args: ["-e", 'process.stdout.write("x".repeat(100))'],
    command: process.execPath,
    cwd: process.cwd(),
    maxOutputBytes: 8,
    timeoutMs: 10_000,
  })
  assert.equal(result.exitCode, 0)
  assert.equal(result.stdout, "xxxxxxxx")
  assert.equal(result.stdoutTruncated, true)
})

test("the shared process boundary reports timeouts", async () => {
  const result = await runProcess({
    args: ["-e", "setTimeout(() => {}, 10000)"],
    command: process.execPath,
    cwd: process.cwd(),
    timeoutMs: 25,
  })
  assert.equal(result.timedOut, true)
  assert.notEqual(result.exitCode, 0)
})
