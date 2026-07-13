import assert from "node:assert/strict"
import test from "node:test"

import { runCli } from "./cli.mjs"

test("greets one named person", () => {
  assert.equal(runCli(["greet", "Ada"]), "Hello, Ada!")
})

test("shows usage for incomplete input", () => {
  assert.equal(runCli(["greet"]), "Usage: tiny greet <name>")
})
