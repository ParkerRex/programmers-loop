#!/usr/bin/env node
// Hidden grader for smoke-json-lines.
// Usage: node graders/grade.mjs <sandboxDir>
// Prints one JSON summary line ({functional, regression, scope, notes})
// to stdout and exits non-zero when any component fails.
import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import path from "node:path"
import { pathToFileURL } from "node:url"

// sha256 pins for workspace files the agent must not modify.
const UNTOUCHED_FILES = {
  "index.mjs":
    "06472cdd0a4310e14611cf5bacd0cda55e2d05f9f9326a7c0a0baf32d060a951",
  "README.md":
    "76b7cf714a805fab38659e372d15b886c558ac47bf7830dbcc78f528437efc90",
}

const notes = []

function describe(error) {
  const text = error instanceof Error ? error.message : String(error)
  return text.split("\n")[0]
}

async function passes(component, name, run) {
  try {
    await run()
    return true
  } catch (error) {
    notes.push(`${component}: ${name}: ${describe(error)}`)
    return false
  }
}

async function grade(sandboxDir) {
  let mod = null
  try {
    mod = await import(
      pathToFileURL(path.resolve(sandboxDir, "json-lines.mjs")).href
    )
  } catch (error) {
    notes.push(`import of json-lines.mjs failed: ${describe(error)}`)
  }

  let functional = mod !== null
  let regression = mod !== null
  if (mod !== null) {
    const { parseJsonLines, stringifyJsonLines } = mod
    const cases = [
      ["one record per line", '{"id":1}\n{"id":2}', [{ id: 1 }, { id: 2 }]],
      ["trailing newline", '{"id":1}\n{"id":2}\n', [{ id: 1 }, { id: 2 }]],
      ["single record trailing newline", '{"ok":true}\n', [{ ok: true }]],
      [
        "crlf endings with trailing crlf",
        '{"id":1}\r\n{"id":2}\r\n',
        [{ id: 1 }, { id: 2 }],
      ],
      [
        "blank line in the middle",
        '{"id":1}\n\n{"id":2}',
        [{ id: 1 }, { id: 2 }],
      ],
      [
        "whitespace-only line",
        '{"id":1}\n   \n{"id":2}',
        [{ id: 1 }, { id: 2 }],
      ],
      [
        "crlf blank line in the middle",
        '{"id":1}\r\n\r\n{"id":2}\r\n',
        [{ id: 1 }, { id: 2 }],
      ],
      ["leading newline", '\n{"id":1}', [{ id: 1 }]],
      ["empty input", "", []],
      ["newline-only input", "\n", []],
      [
        "mixed json value types",
        '1\n"two"\n[3]\n{"four":4}',
        [1, "two", [3], { four: 4 }],
      ],
    ]
    for (const [name, input, expected] of cases) {
      functional &&= await passes("functional", name, () => {
        assert.deepEqual(parseJsonLines(input), expected)
      })
    }
    functional &&= await passes(
      "functional",
      "malformed line still throws",
      () => {
        assert.throws(() => parseJsonLines('{"broken'), SyntaxError)
        assert.throws(() => parseJsonLines('{"a":1}\nnot json'), SyntaxError)
      },
    )

    regression &&= await passes(
      "regression",
      "stringifyJsonLines is unchanged",
      () => {
        assert.equal(
          stringifyJsonLines([{ a: 1 }, [1, 2], "x"]),
          '{"a":1}\n[1,2]\n"x"',
        )
        assert.equal(stringifyJsonLines([]), "")
      },
    )
  }

  let scope = true
  for (const [file, expected] of Object.entries(UNTOUCHED_FILES)) {
    scope &&= await passes("scope", `${file} is unmodified`, async () => {
      const digest = createHash("sha256")
        .update(await readFile(path.resolve(sandboxDir, file)))
        .digest("hex")
      assert.equal(digest, expected)
    })
  }

  return { functional, regression, scope }
}

const sandboxDir = process.argv[2]
let result = { functional: false, regression: false, scope: false }
if (sandboxDir === undefined) {
  notes.push("usage: node graders/grade.mjs <sandboxDir>")
} else {
  result = await grade(sandboxDir)
}

console.log(JSON.stringify({ ...result, notes }))
process.exitCode =
  result.functional && result.regression && result.scope ? 0 : 1
