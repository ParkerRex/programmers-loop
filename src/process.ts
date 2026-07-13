import { spawn } from "node:child_process"

export type ProcessResult = {
  exitCode: number
  stdout: string
  stdoutTruncated: boolean
  stderr: string
  stderrTruncated: boolean
  timedOut: boolean
}

type Capture = {
  chunks: Buffer[]
  size: number
  truncated: boolean
}

function appendBounded(
  capture: Capture,
  chunk: Buffer,
  maxOutputBytes: number,
): void {
  const remaining = maxOutputBytes - capture.size
  if (remaining <= 0) {
    capture.truncated = true
    return
  }
  const retained = chunk.subarray(0, remaining)
  capture.chunks.push(retained)
  capture.size += retained.length
  if (retained.length < chunk.length) capture.truncated = true
}

export function runProcess(params: {
  command: string
  args?: string[]
  cwd: string
  input?: string
  maxOutputBytes?: number
  timeoutMs?: number
}): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(params.command, params.args ?? [], {
      cwd: params.cwd,
      env: process.env,
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
    })
    const maxOutputBytes = params.maxOutputBytes ?? 1024 * 1024
    if (!Number.isInteger(maxOutputBytes) || maxOutputBytes <= 0) {
      reject(new Error("maxOutputBytes must be a positive integer."))
      return
    }
    const stdout: Capture = { chunks: [], size: 0, truncated: false }
    const stderr: Capture = { chunks: [], size: 0, truncated: false }
    let timedOut = false
    let killTimer: NodeJS.Timeout | undefined
    const timer =
      params.timeoutMs === undefined
        ? undefined
        : setTimeout(() => {
            timedOut = true
            child.kill("SIGTERM")
            killTimer = setTimeout(() => child.kill("SIGKILL"), 2_000)
          }, params.timeoutMs)

    child.stdout.on("data", (chunk: Buffer) => {
      appendBounded(stdout, chunk, maxOutputBytes)
    })
    child.stderr.on("data", (chunk: Buffer) => {
      appendBounded(stderr, chunk, maxOutputBytes)
    })
    child.on("error", (error) => {
      if (timer) clearTimeout(timer)
      if (killTimer) clearTimeout(killTimer)
      reject(error)
    })
    child.on("close", (code) => {
      if (timer) clearTimeout(timer)
      if (killTimer) clearTimeout(killTimer)
      resolve({
        exitCode: code ?? 1,
        stdout: Buffer.concat(stdout.chunks).toString("utf8"),
        stdoutTruncated: stdout.truncated,
        stderr: Buffer.concat(stderr.chunks).toString("utf8"),
        stderrTruncated: stderr.truncated,
        timedOut,
      })
    })

    child.stdin.end(params.input)
  })
}
