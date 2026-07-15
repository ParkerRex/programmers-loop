import assert from "node:assert/strict"
import test from "node:test"

import { runCli } from "./cli.mjs"

test("reports success for a reachable target", async () => {
  const result = await runCli(["site.txt"], async () => true)
  assert.equal(result.exitCode, 0)
  assert.match(result.output, /ok site\.txt/)
})

test("reports failure for a missing target", async () => {
  const result = await runCli(["site.txt"], async () => false)
  assert.equal(result.exitCode, 1)
  assert.match(result.output, /missing site\.txt/)
})

test("prints a JSON object with --json", async () => {
  const result = await runCli(["--json", "site.txt"], async () => true)
  assert.equal(result.exitCode, 0)
  const parsed = JSON.parse(result.output)
  assert.equal(parsed.target, "site.txt")
  assert.equal(parsed.ok, true)
})

test("prints nothing on quiet success", async () => {
  const result = await runCli(["--quiet", "site.txt"], async () => true)
  assert.equal(result.exitCode, 0)
  assert.equal(result.output, "")
})

test("prints usage with --help", async () => {
  const result = await runCli(["--help"], async () => true)
  assert.equal(result.exitCode, 0)
  assert.match(result.output, /Usage: pulse/)
})

test("rejects unknown options", async () => {
  const result = await runCli(["--frobnicate", "site.txt"], async () => true)
  assert.equal(result.exitCode, 2)
  assert.match(result.output, /Unknown option/)
})

test("requires a target", async () => {
  const result = await runCli([], async () => true)
  assert.equal(result.exitCode, 2)
  assert.match(result.output, /Missing <path>/)
})
