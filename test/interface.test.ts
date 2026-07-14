import assert from "node:assert/strict"
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"

import { runCli, type CliIo } from "../src/cli.js"
import { COMMANDS, commandHelp, topLevelHelp } from "../src/cli/help.js"
import {
  listPrompts,
  listSkills,
  REQUIRED_PROMPTS,
  REQUIRED_SKILLS,
  validatePromptPack,
  validateSkillPack,
} from "../src/inventory.js"
import { VERSION } from "../src/version.js"

function captureIo(): { io: CliIo; stderr: string[]; stdout: string[] } {
  const stderr: string[] = []
  const stdout: string[] = []
  return {
    io: {
      stderr: (text) => stderr.push(text),
      stdout: (text) => stdout.push(text),
    },
    stderr,
    stdout,
  }
}

test("help, version, and usage exit codes form a stable CLI contract", async () => {
  const help = topLevelHelp()
  for (const command of COMMANDS) {
    assert.match(help, new RegExp(command.command.replace("-", "\\-")))
    assert.match(commandHelp(command.command), /Usage:/)
  }

  const versionOutput = captureIo()
  assert.equal(
    await runCli({ args: ["--version"], cwd: "/", io: versionOutput.io }),
    0,
  )
  assert.equal(versionOutput.stdout.join(""), `${VERSION}\n`)
  assert.equal(versionOutput.stderr.join(""), "")

  const unknownOutput = captureIo()
  assert.equal(
    await runCli({ args: ["not-a-command"], cwd: "/", io: unknownOutput.io }),
    2,
  )
  assert.match(unknownOutput.stderr.join(""), /Unknown command/)

  const invalidOutput = captureIo()
  const repoRoot = path.resolve(import.meta.dirname, "..")
  assert.equal(
    await runCli({
      args: [
        "assignment",
        "create",
        "--slug",
        "Not-Kebab",
        "--title",
        "Invalid",
        "--dry-run",
      ],
      cwd: repoRoot,
      io: invalidOutput.io,
    }),
    2,
  )
  assert.match(invalidOutput.stderr.join(""), /kebab-case/)
})

test("package version, skills, prompts, and indexes stay synchronized", async () => {
  const repoRoot = path.resolve(import.meta.dirname, "..")
  const packageJson = JSON.parse(
    await readFile(path.join(repoRoot, "package.json"), "utf8"),
  ) as {
    exports: { ".": { import: string; types: string } }
    files: string[]
    types: string
    version: string
  }
  assert.equal(packageJson.version, VERSION)
  assert.equal(packageJson.types, "./dist/index.d.ts")
  assert.equal(packageJson.exports["."].import, "./dist/index.js")
  assert.equal(packageJson.exports["."].types, "./dist/index.d.ts")
  for (const packagedPath of [
    "dist",
    "docs",
    "examples",
    "prompts",
    "skills",
    "templates",
  ]) {
    assert.ok(packageJson.files.includes(packagedPath))
  }

  const skills = await listSkills(repoRoot)
  assert.deepEqual(
    skills.map((skill) => skill.name),
    [...REQUIRED_SKILLS],
  )
  assert.deepEqual(await validateSkillPack(repoRoot), [])
  const skillIndex = await readFile(
    path.join(repoRoot, "docs", "skills", "README.md"),
    "utf8",
  )
  for (const skill of skills) {
    assert.match(skillIndex, new RegExp(`\\.\\./\\.\\./${skill.path}`))
  }

  const prompts = await listPrompts(repoRoot)
  assert.deepEqual(
    prompts.map((prompt) => `${prompt.category}/${prompt.name}`),
    [...REQUIRED_PROMPTS],
  )
  assert.deepEqual(await validatePromptPack(repoRoot), [])
  const promptIndex = await readFile(
    path.join(repoRoot, "docs", "prompts", "README.md"),
    "utf8",
  )
  for (const prompt of prompts) {
    assert.match(promptIndex, new RegExp(`\\.\\./\\.\\./${prompt.path}`))
  }
})

test("prompt validation rejects a semantically truncated runtime prompt", async () => {
  const sourceRoot = path.resolve(import.meta.dirname, "..")
  const repoRoot = await mkdtemp(
    path.join(os.tmpdir(), "programmers-loop-prompts-"),
  )
  try {
    await cp(path.join(sourceRoot, "prompts"), path.join(repoRoot, "prompts"), {
      recursive: true,
    })
    await writeFile(
      path.join(repoRoot, "prompts/exec-plans/validate.md"),
      "# Validate an ExecPlan\n\nLooks good.\n",
    )
    const issues = await validatePromptPack(repoRoot)
    assert.ok(
      issues.some(
        (entry) =>
          entry.path === "prompts/exec-plans/validate.md" &&
          entry.message.includes("Prompt contract is missing required text"),
      ),
    )
  } finally {
    await rm(repoRoot, { force: true, recursive: true })
  }
})

test("the demo command supports stable JSON output", async () => {
  const repoRoot = path.resolve(import.meta.dirname, "..")
  const output = captureIo()
  assert.equal(
    await runCli({ args: ["demo", "--json"], cwd: repoRoot, io: output.io }),
    0,
  )
  const report = JSON.parse(output.stdout.join("")) as {
    hierarchy: unknown[]
    readOnly: boolean
  }
  assert.equal(report.readOnly, true)
  assert.equal(report.hierarchy.length, 3)
  assert.equal(output.stderr.join(""), "")
})
