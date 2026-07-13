import assert from "node:assert/strict"
import test from "node:test"

import {
  extractSection,
  parseMarkdownFrontmatter,
  validateMarkdownDocument,
} from "../src/markdown/frontmatter.js"

test("parses frontmatter and validates title and sections", () => {
  const parsed = parseMarkdownFrontmatter(`---
title: Example
read_when:
  - Testing
---

# Example

## Purpose

Useful text.
`)

  assert.deepEqual(parsed.issues, [])
  assert.equal(extractSection(parsed.body, "Purpose"), "Useful text.")
  assert.deepEqual(
    validateMarkdownDocument({
      body: parsed.body,
      metadata: parsed.metadata,
      requiredKeys: ["title", "read_when"],
      requiredSections: ["Purpose"],
    }),
    [],
  )
})

test("reports missing frontmatter deterministically", () => {
  const parsed = parseMarkdownFrontmatter("# Example\n")
  assert.deepEqual(parsed.issues, [
    "Missing YAML frontmatter block at the top of the document.",
  ])
})
