import assert from "node:assert/strict"
import path from "node:path"
import test from "node:test"

import { loadConfig } from "../src/config.js"
import { lintPlanningTree } from "../src/lint.js"

test("the repository dogfoods valid planning contracts", async () => {
  const repoRoot = path.resolve(import.meta.dirname, "..")
  const config = await loadConfig(repoRoot)
  const report = await lintPlanningTree({ repoRoot, config })

  assert.deepEqual(report.issues, [])
  assert.ok(report.checked.length >= 2)
})
