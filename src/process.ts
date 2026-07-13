import { spawn } from "node:child_process"

export type ProcessResult = {
  exitCode: number
  stdout: string
  stderr: string
  timedOut: boolean
}

export function runProcess(params: {
  command: string
  args?: string[]
  cwd: string
  input?: string
  timeoutMs?: number
}): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(params.command, params.args ?? [], {
      cwd: params.cwd,
      env: process.env,
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
    })
    let stdout = ""
    let stderr = ""
    let timedOut = false
    const timer =
      params.timeoutMs === undefined
        ? undefined
        : setTimeout(() => {
            timedOut = true
            child.kill("SIGTERM")
          }, params.timeoutMs)

    child.stdout.setEncoding("utf8")
    child.stderr.setEncoding("utf8")
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk
    })
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk
    })
    child.on("error", (error) => {
      if (timer) clearTimeout(timer)
      reject(error)
    })
    child.on("close", (code) => {
      if (timer) clearTimeout(timer)
      resolve({
        exitCode: code ?? 1,
        stdout,
        stderr,
        timedOut,
      })
    })

    child.stdin.end(params.input)
  })
}
