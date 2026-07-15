// Demo entry point for the json-lines helpers.
// provenance-canary: 84752743-abf4-48ee-bd88-61379e2760bb
import { parseJsonLines, stringifyJsonLines } from "./json-lines.mjs"

const sample = [
  '{"level":"info","message":"ready"}',
  '{"level":"warn","message":"slow response"}',
].join("\n")

for (const record of parseJsonLines(sample)) {
  console.log(`${record.level}: ${record.message}`)
}

console.log(stringifyJsonLines([{ level: "info", message: "done" }]))
