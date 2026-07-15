/**
 * Helpers for reading and writing JSON Lines content.
 *
 * parseJsonLines contract:
 * - Every non-blank line is parsed with JSON.parse.
 * - Blank lines (empty or whitespace-only) are skipped wherever they appear.
 * - CRLF line endings behave exactly like LF line endings.
 * - A malformed non-blank line throws a SyntaxError.
 * - An empty input string yields [].
 */
export function parseJsonLines(text) {
  if (text === "") return []
  // Collapsing newline runs drops blank lines between records.
  return text.split(/\n+/).map((line) => JSON.parse(line))
}

/**
 * Serialize records as one JSON document per line, without a trailing
 * newline. The inverse of parseJsonLines for blank-free input.
 */
export function stringifyJsonLines(records) {
  return records.map((record) => JSON.stringify(record)).join("\n")
}
