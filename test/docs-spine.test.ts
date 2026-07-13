import assert from "node:assert/strict"
import { mkdir, mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import test from "node:test"

import { lintMarkdownLinks } from "../src/docs/links.js"
import {
  validateDocsSpine,
  type DocsSpineDefinition,
} from "../src/docs/spine.js"

function spineDocument(title: string, nextTarget: string): string {
  return `---
title: "${title}"
summary: "Fixture documentation."
status: active
read_when:
  - "Testing the docs spine."
---

# ${title}

## Owns

Fixture ownership.

## Does Not Own

Other fixture concerns.

## Next

- [Next](${nextTarget})
`
}

const FIXTURE_DEFINITION: DocsSpineDefinition = {
  entrypoint: "docs/index.md",
  firstClass: {
    "docs/index.md": ["docs/next.md"],
    "docs/next.md": ["docs/index.md"],
  },
  requiredFiles: ["README.md", "docs/index.md", "docs/next.md"],
  routedDocs: ["docs/index.md", "docs/next.md"],
}

test("the repository documentation spine is valid", async () => {
  const repoRoot = path.resolve(import.meta.dirname, "..")
  const report = await validateDocsSpine({ repoRoot })

  assert.deepEqual(report.issues, [])
  assert.ok(report.checked.length >= 40)
})

test("reports broken local Markdown links", async () => {
  const repoRoot = await mkdtemp(path.join(tmpdir(), "programmers-loop-docs-"))
  const issues = await lintMarkdownLinks({
    repoRoot,
    source: "# Example\n\n[Missing](missing.md)\n",
    sourcePath: "README.md",
  })

  assert.equal(issues.length, 1)
  assert.match(issues[0]?.message ?? "", /does not exist/)
})

test("reports a missing required route and unreachable spine document", async () => {
  const repoRoot = await mkdtemp(path.join(tmpdir(), "programmers-loop-docs-"))
  await mkdir(path.join(repoRoot, "docs"), { recursive: true })
  await writeFile(path.join(repoRoot, "README.md"), "# Fixture\n")
  await writeFile(
    path.join(repoRoot, "docs/index.md"),
    spineDocument("Index", "index.md"),
  )
  await writeFile(
    path.join(repoRoot, "docs/next.md"),
    spineDocument("Next", "index.md"),
  )

  const report = await validateDocsSpine({
    repoRoot,
    definition: FIXTURE_DEFINITION,
  })

  assert.ok(
    report.issues.some((entry) =>
      entry.message.includes("## Next must link to docs/next.md"),
    ),
  )
  assert.ok(
    report.issues.some((entry) =>
      entry.message.includes("not reachable from docs/index.md"),
    ),
  )
})
