import assert from "node:assert/strict"
import test from "node:test"

import { parseJsonLines } from "./json-lines.mjs"

test("parses one record per line", () => {
  assert.deepEqual(parseJsonLines('{"id":1}\n{"id":2}'), [{ id: 1 }, { id: 2 }])
})

test("skips a blank line between records", () => {
  assert.deepEqual(parseJsonLines('{"id":1}\n\n{"id":2}'), [
    { id: 1 },
    { id: 2 },
  ])
})

test("parses a file that ends with a newline", () => {
  assert.deepEqual(parseJsonLines('{"id":1}\n'), [{ id: 1 }])
})
