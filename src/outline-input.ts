import { readFile, realpath, stat } from "node:fs/promises"
import path from "node:path"

import { resolveExistingRepoPath, UserInputError } from "./repo-path.js"

const MAX_OUTLINE_INPUT_BYTES = 16 * 1024 * 1024

type JsonRecord = Record<string, unknown>

export type SessionTranscriptPhase = "commentary" | "final" | "unknown"

export type SessionTranscriptMessage = {
  phase: SessionTranscriptPhase
  role: "user" | "assistant"
  text: string
}

export type SessionTranscript = {
  cwd?: string
  messages: SessionTranscriptMessage[]
  renderedTranscript: string
  sessionId?: string
  sourcePath: string
}

export type OutlineInputKind = "notes" | "session-jsonl" | "handoff"

function isRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

async function readBounded(filePath: string): Promise<string> {
  const details = await stat(filePath)
  if (!details.isFile()) {
    throw new UserInputError(`Outline input must be a file: ${filePath}`)
  }
  if (details.size > MAX_OUTLINE_INPUT_BYTES) {
    throw new UserInputError(
      `Outline input exceeds ${MAX_OUTLINE_INPUT_BYTES} bytes: ${filePath}`,
    )
  }
  return readFile(filePath, "utf8")
}

async function resolveExplicitReadPath(
  repoRoot: string,
  inputPath: string,
): Promise<string> {
  const candidate = path.isAbsolute(inputPath)
    ? inputPath
    : path.resolve(repoRoot, inputPath)
  try {
    return await realpath(candidate)
  } catch {
    throw new UserInputError(`Outline input does not exist: ${inputPath}`)
  }
}

function readTextParts(content: unknown): string[] {
  if (!Array.isArray(content)) return []
  return content.flatMap((item) => {
    if (!isRecord(item)) return []
    if (
      (item.type === "input_text" ||
        item.type === "output_text" ||
        item.type === "text") &&
      typeof item.text === "string"
    ) {
      return [item.text]
    }
    return []
  })
}

function normalizeMessage(params: {
  phase?: SessionTranscriptPhase
  role: "user" | "assistant"
  textParts: string[]
}): SessionTranscriptMessage | null {
  const text = params.textParts.join("\n\n").trim()
  if (text === "") return null
  return {
    phase: params.phase ?? "unknown",
    role: params.role,
    text,
  }
}

function responseItemMessage(
  entry: JsonRecord,
): SessionTranscriptMessage | null {
  if (entry.type !== "response_item" || !isRecord(entry.payload)) return null
  const payload = entry.payload
  if (
    payload.type !== "message" ||
    (payload.role !== "user" && payload.role !== "assistant")
  ) {
    return null
  }
  const phase: SessionTranscriptPhase =
    payload.phase === "commentary" || payload.phase === "final"
      ? payload.phase
      : "unknown"
  return normalizeMessage({
    phase,
    role: payload.role,
    textParts: readTextParts(payload.content),
  })
}

function fallbackEventMessage(
  entry: JsonRecord,
): SessionTranscriptMessage | null {
  if (entry.type !== "event_msg" || !isRecord(entry.payload)) return null
  const payload = entry.payload
  if (payload.type === "user_message" && typeof payload.message === "string") {
    return normalizeMessage({ role: "user", textParts: [payload.message] })
  }
  if (
    payload.type === "agent_message" &&
    typeof payload.message === "string" &&
    (payload.phase === "commentary" || payload.phase === "final")
  ) {
    return normalizeMessage({
      phase: payload.phase,
      role: "assistant",
      textParts: [payload.message],
    })
  }
  return null
}

function sessionMetadata(records: JsonRecord[]): {
  cwd?: string
  sessionId?: string
} {
  const metadata = records.find(
    (entry) => entry.type === "session_meta" && isRecord(entry.payload),
  )?.payload
  if (!isRecord(metadata)) return {}
  return {
    cwd: typeof metadata.cwd === "string" ? metadata.cwd : undefined,
    sessionId: typeof metadata.id === "string" ? metadata.id : undefined,
  }
}

function renderSessionTranscript(params: {
  messages: SessionTranscriptMessage[]
  sessionId?: string
  sourcePath: string
}): string {
  const header = [
    "# Session Transcript",
    "",
    `Source file: ${path.basename(params.sourcePath)}`,
  ]
  if (params.sessionId) header.push(`Session id: ${params.sessionId}`)
  const messages = params.messages.flatMap((message, index) => [
    "",
    `## Message ${index + 1}`,
    `Role: ${message.role}${message.phase === "unknown" ? "" : ` (${message.phase})`}`,
    "",
    message.text,
  ])
  return [...header, ...messages].join("\n").trim()
}

export async function loadCodexSessionTranscript(
  sessionJsonlPath: string,
): Promise<SessionTranscript> {
  const source = await readBounded(sessionJsonlPath)
  const records: JsonRecord[] = []
  for (const [index, line] of source.split(/\r?\n/).entries()) {
    if (line.trim() === "") continue
    let parsed: unknown
    try {
      parsed = JSON.parse(line) as unknown
    } catch {
      throw new UserInputError(
        `Invalid session JSONL at line ${index + 1}: ${sessionJsonlPath}`,
      )
    }
    if (isRecord(parsed)) records.push(parsed)
  }
  const responseMessages = records
    .map(responseItemMessage)
    .filter((message) => message !== null)
  const messages =
    responseMessages.length > 0
      ? responseMessages
      : records.map(fallbackEventMessage).filter((message) => message !== null)
  if (messages.length === 0) {
    throw new UserInputError(
      `Could not extract user or assistant messages from ${sessionJsonlPath}`,
    )
  }
  const metadata = sessionMetadata(records)
  return {
    ...metadata,
    messages,
    renderedTranscript: renderSessionTranscript({
      messages,
      sessionId: metadata.sessionId,
      sourcePath: sessionJsonlPath,
    }),
    sourcePath: sessionJsonlPath,
  }
}

const HANDOFF_KEYS = [
  "version",
  "sourceRunId",
  "producedAt",
  "problemStatement",
  "purpose",
  "userVisibleOutcome",
  "inScope",
  "outOfScope",
  "assumptions",
  "risks",
  "testCommands",
  "nextAction",
  "handoffNotes",
] as const

function handoffString(record: JsonRecord, key: string): string {
  const value = record[key]
  if (typeof value !== "string" || value.trim() === "") {
    throw new UserInputError(`Handoff ${key} must be a non-empty string.`)
  }
  return value.trim()
}

function handoffList(record: JsonRecord, key: string): string[] {
  const value = record[key]
  if (
    !Array.isArray(value) ||
    value.some((item) => typeof item !== "string" || item.trim() === "")
  ) {
    throw new UserInputError(`Handoff ${key} must be a string list.`)
  }
  return value.map((item) => String(item).trim())
}

export async function readExecPlanHandoffAsOutline(
  handoffFilePath: string,
): Promise<string> {
  let parsed: unknown
  try {
    parsed = JSON.parse(await readBounded(handoffFilePath)) as unknown
  } catch (error) {
    if (error instanceof UserInputError) throw error
    throw new UserInputError(`Invalid handoff JSON: ${handoffFilePath}`)
  }
  if (!isRecord(parsed)) {
    throw new UserInputError("Handoff JSON must contain an object.")
  }
  const unexpected = Object.keys(parsed).filter(
    (key) => !(HANDOFF_KEYS as readonly string[]).includes(key),
  )
  if (unexpected.length > 0) {
    throw new UserInputError(`Unexpected handoff key: ${unexpected[0]}.`)
  }
  const version = handoffString(parsed, "version")
  if (version !== "1") throw new UserInputError("Handoff version must equal 1.")
  const producedAt = handoffString(parsed, "producedAt")
  if (Number.isNaN(Date.parse(producedAt))) {
    throw new UserInputError("Handoff producedAt must be an ISO timestamp.")
  }
  const lines = [
    "# Systems Workshop Handoff",
    "",
    `- source run id: ${handoffString(parsed, "sourceRunId")}`,
    `- produced at: ${producedAt}`,
    "",
    "## Problem Statement",
    handoffString(parsed, "problemStatement"),
    "",
    "## Purpose",
    handoffString(parsed, "purpose"),
    "",
    "## User-Visible Outcome",
    handoffString(parsed, "userVisibleOutcome"),
  ]
  for (const [heading, key] of [
    ["In Scope", "inScope"],
    ["Out Of Scope", "outOfScope"],
    ["Assumptions", "assumptions"],
    ["Risks", "risks"],
    ["Test Commands", "testCommands"],
  ] as const) {
    lines.push(
      "",
      `## ${heading}`,
      ...handoffList(parsed, key).map((item) => `- ${item}`),
    )
  }
  lines.push(
    "",
    "## Next Action",
    handoffString(parsed, "nextAction"),
    "",
    "## Handoff Notes",
    ...handoffList(parsed, "handoffNotes").map((item) => `- ${item}`),
  )
  return lines.join("\n").trim()
}

export async function loadOutlineSource(params: {
  inputPath: string
  kind: OutlineInputKind
  repoRoot: string
}): Promise<string> {
  if (params.kind === "notes") {
    const inputPath = await resolveExistingRepoPath(
      params.repoRoot,
      params.inputPath,
    )
    return readBounded(inputPath)
  }
  const inputPath = await resolveExplicitReadPath(
    params.repoRoot,
    params.inputPath,
  )
  if (params.kind === "session-jsonl") {
    return (await loadCodexSessionTranscript(inputPath)).renderedTranscript
  }
  return readExecPlanHandoffAsOutline(inputPath)
}
