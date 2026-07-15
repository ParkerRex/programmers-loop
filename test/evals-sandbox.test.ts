import assert from "node:assert/strict"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import test from "node:test"

import { hostLauncher } from "../src/agents/types.js"
import { loadConfig } from "../src/config.js"
import { runProcess } from "../src/process.js"
import {
  AllowlistEgressNotWiredError,
  buildContainerRunArgs,
  containerEnvPassthrough,
  DEFAULT_SANDBOX_IMAGE,
  describeNetworkEnforcement,
  dockerAvailable,
  isHostAllowed,
  makeContainerLauncher,
} from "../src/evals/sandbox.js"

const SANDBOX_SPEC = {
  command: "codex",
  args: ["exec", "--cd", "/tmp/sbx", "--output-last-message", "/tmp/sbx/x.md"],
  cwd: "/tmp/sbx",
}

// --- Container command construction -----------------------------------------

test("buildContainerRunArgs identity-mounts the sandbox and denies the network", () => {
  const args = buildContainerRunArgs(SANDBOX_SPEC, {
    allowlist: [],
    containerName: "loopbench-fixed",
    envPassthrough: ["OPENAI_API_KEY"],
    image: DEFAULT_SANDBOX_IMAGE,
    network: "none",
  })
  // Identity bind mount + workdir: host path == container path (no arg rewriting).
  const mountIndex = args.indexOf("-v")
  assert.equal(args[mountIndex + 1], "/tmp/sbx:/tmp/sbx")
  assert.equal(args[args.indexOf("--workdir") + 1], "/tmp/sbx")
  // Kernel-enforced egress denial.
  assert.equal(args[args.indexOf("--network") + 1], "none")
  // Teardown + stdin plumbing.
  assert.ok(args.includes("--rm"))
  assert.ok(args.includes("-i"))
  assert.equal(args[args.indexOf("--name") + 1], "loopbench-fixed")
  // The image precedes the wrapped command and its argv, in order.
  const imageIndex = args.indexOf(DEFAULT_SANDBOX_IMAGE)
  assert.equal(args[imageIndex + 1], "codex")
  assert.deepEqual(args.slice(imageIndex + 2), SANDBOX_SPEC.args)
})

test("env forwarding places only NAMES on argv, never values (redaction)", () => {
  // A launcher reads no secret value; buildContainerRunArgs is handed names only.
  const secret = "sk-super-secret-do-not-log-1234567890"
  const previous = process.env.OPENAI_API_KEY
  process.env.OPENAI_API_KEY = secret
  try {
    const args = buildContainerRunArgs(SANDBOX_SPEC, {
      allowlist: [],
      containerName: "loopbench-redact",
      envPassthrough: ["OPENAI_API_KEY", "ANTHROPIC_API_KEY"],
      image: DEFAULT_SANDBOX_IMAGE,
      network: "none",
    })
    // The env var name is forwarded (Docker reads the value from its own env).
    const first = args.indexOf("-e")
    assert.equal(args[first + 1], "OPENAI_API_KEY")
    assert.ok(args.includes("ANTHROPIC_API_KEY"))
    // The VALUE never appears anywhere in the constructed argv.
    assert.ok(
      !JSON.stringify(args).includes(secret),
      "the secret value must never reach the docker argv",
    )
  } finally {
    if (previous === undefined) delete process.env.OPENAI_API_KEY
    else process.env.OPENAI_API_KEY = previous
  }
})

test("containerEnvPassthrough forwards the adapter's auth env names only", () => {
  assert.deepEqual(containerEnvPassthrough("codex"), ["OPENAI_API_KEY"])
  assert.deepEqual(containerEnvPassthrough("claude"), [
    "ANTHROPIC_API_KEY",
    // The D13 utility-model pin must survive into the container.
    "ANTHROPIC_SMALL_FAST_MODEL",
  ])
  assert.deepEqual(containerEnvPassthrough("mock"), [])
})

test("makeContainerLauncher wraps a spawn in docker run with a unique name", () => {
  const launcher = makeContainerLauncher({
    allowlist: [],
    envPassthrough: ["OPENAI_API_KEY"],
    image: DEFAULT_SANDBOX_IMAGE,
    network: "none",
  })
  const a = launcher(SANDBOX_SPEC)
  const b = launcher(SANDBOX_SPEC)
  assert.equal(a.command, "docker")
  assert.equal(a.args[0], "run")
  assert.equal(a.cwd, "/tmp/sbx")
  assert.equal(typeof a.cleanup, "function")
  // Each invocation gets its own container name so loop phase calls never collide.
  const nameA = a.args[a.args.indexOf("--name") + 1]
  const nameB = b.args[b.args.indexOf("--name") + 1]
  assert.notEqual(nameA, nameB)
})

// --- Allowlist egress: predicate ships, live runs refused --------------------

test("buildContainerRunArgs refuses an unwired allowlist policy", () => {
  assert.throws(
    () =>
      buildContainerRunArgs(SANDBOX_SPEC, {
        allowlist: ["api.openai.com:443"],
        containerName: "loopbench-x",
        envPassthrough: [],
        image: DEFAULT_SANDBOX_IMAGE,
        network: "allowlist",
      }),
    AllowlistEgressNotWiredError,
  )
})

test("isHostAllowed matches host and optional port exactly", () => {
  const allow = ["api.openai.com:443", "registry.npmjs.org"]
  assert.equal(isHostAllowed("api.openai.com:443", allow), true)
  // A port-pinned entry rejects a different port.
  assert.equal(isHostAllowed("api.openai.com:80", allow), false)
  // A portless entry allows any port.
  assert.equal(isHostAllowed("registry.npmjs.org:443", allow), true)
  // Case-insensitive host, but a foreign host is denied.
  assert.equal(isHostAllowed("API.OpenAI.com:443", allow), true)
  assert.equal(isHostAllowed("evil.example.com:443", allow), false)
  assert.equal(isHostAllowed("", allow), false)
})

test("describeNetworkEnforcement never overclaims", () => {
  assert.match(
    describeNetworkEnforcement("none"),
    /kernel-enforced total egress/,
  )
  assert.match(describeNetworkEnforcement("none"), /await/)
  assert.match(describeNetworkEnforcement("allowlist"), /declared only/)
})

// --- Host mode is the identity transform -------------------------------------

test("hostLauncher is the identity transform with a no-op cleanup", async () => {
  const launched = hostLauncher(SANDBOX_SPEC)
  assert.equal(launched.command, SANDBOX_SPEC.command)
  assert.deepEqual(launched.args, SANDBOX_SPEC.args)
  assert.equal(launched.cwd, SANDBOX_SPEC.cwd)
  // Cleanup resolves without spawning anything.
  await launched.cleanup()
})

// --- Config parsing ----------------------------------------------------------

const BASE_CONFIG = `schema_version: 1
planning_root: docs/assignments
agent:
  adapter: codex
  command: codex
  run_timeout_ms: 3600000
  max_output_bytes: 1048576
github:
  repository: null
proof:
  command_timeout_ms: 1800000
  max_output_bytes: 65536
  allowed_command_prefixes:
    - node --test
`

async function configFrom(body: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "sandbox-config-"))
  await writeFile(path.join(dir, "programmers-loop.config.yaml"), body, "utf8")
  return dir
}

test("loadConfig defaults sandbox to host when the block is omitted", async () => {
  const dir = await configFrom(BASE_CONFIG)
  try {
    const config = await loadConfig(dir)
    assert.equal(config.sandbox?.mode, "host")
    assert.equal(config.sandbox?.image, DEFAULT_SANDBOX_IMAGE)
    assert.equal(config.sandbox?.network, "none")
    assert.deepEqual(config.sandbox?.allowlist, [])
  } finally {
    await rm(dir, { force: true, recursive: true })
  }
})

test("loadConfig resolves an explicit container sandbox block", async () => {
  const dir = await configFrom(
    `${BASE_CONFIG}sandbox:\n  mode: container\n  image: loopbench-sandbox:pinned\n  network: none\n`,
  )
  try {
    const config = await loadConfig(dir)
    assert.equal(config.sandbox?.mode, "container")
    assert.equal(config.sandbox?.image, "loopbench-sandbox:pinned")
    assert.equal(config.sandbox?.network, "none")
  } finally {
    await rm(dir, { force: true, recursive: true })
  }
})

test("loadConfig rejects an invalid sandbox mode or network", async () => {
  const badMode = await configFrom(`${BASE_CONFIG}sandbox:\n  mode: vm\n`)
  const badNet = await configFrom(
    `${BASE_CONFIG}sandbox:\n  mode: container\n  network: open\n`,
  )
  try {
    await assert.rejects(loadConfig(badMode), /sandbox\.mode/)
    await assert.rejects(loadConfig(badNet), /sandbox\.network/)
  } finally {
    await rm(badMode, { force: true, recursive: true })
    await rm(badNet, { force: true, recursive: true })
  }
})

// --- Daemon-gated smoke: build a minimal image, prove --network none denies ---

/**
 * Build a throwaway image and prove the exact plumbing the launcher relies on:
 * `docker run --network none` runs a command and denies egress. Skips (never
 * fails) when Docker is unavailable or the base image is not quickly buildable,
 * per the task's "if an image build is quick" hedge. Requires no API key and
 * makes no model call.
 */
test("smoke: docker run --network none executes and denies egress", async (t) => {
  if (!(await dockerAvailable())) {
    t.skip("Docker daemon unavailable; skipping container smoke")
    return
  }
  const tag = "loopbench-smoke:test"
  const context = await mkdtemp(path.join(tmpdir(), "loopbench-smoke-"))
  await writeFile(
    path.join(context, "Dockerfile"),
    "FROM node:24-bookworm-slim\n",
    "utf8",
  )
  try {
    // Bounded build: instant if the base is cached, skipped if a slow pull would
    // blow the hedge.
    const build = await runProcess({
      args: ["build", "-t", tag, context],
      command: "docker",
      cwd: context,
      timeoutMs: 180_000,
    })
    if (build.timedOut || build.exitCode !== 0) {
      t.skip("base image not quickly buildable; skipping container smoke")
      return
    }
    // echo proves the run plumbing.
    const echo = await runProcess({
      args: ["run", "--rm", "--network", "none", tag, "echo", "loopbench-ok"],
      command: "docker",
      cwd: context,
      timeoutMs: 60_000,
    })
    assert.equal(echo.exitCode, 0, echo.stderr)
    assert.match(echo.stdout, /loopbench-ok/)
    // Egress denial: a connect must fail under --network none (issue #4). The
    // one-liner exits 7 on any connection error, 1 only if it actually connects.
    const deny = await runProcess({
      args: [
        "run",
        "--rm",
        "--network",
        "none",
        tag,
        "node",
        "-e",
        "const s=require('net').connect(443,'1.1.1.1');s.on('error',()=>process.exit(7));s.on('connect',()=>process.exit(1));setTimeout(()=>process.exit(7),3000)",
      ],
      command: "docker",
      cwd: context,
      timeoutMs: 60_000,
    })
    assert.notEqual(
      deny.exitCode,
      1,
      "egress must be denied under --network none",
    )
    // Execute the REAL launcher argv end-to-end: prove the identity bind mount
    // makes a host file readable at the same path inside the container, that the
    // argv ordering runProcess sees is correct, and that cleanup runs. This is
    // the only test that drives makeContainerLauncher's output through an actual
    // spawn (the unit tests assert construction only).
    const mountDir = await mkdtemp(path.join(tmpdir(), "loopbench-mount-"))
    await writeFile(path.join(mountDir, "marker.txt"), "mounted-ok", "utf8")
    const launcher = makeContainerLauncher({
      allowlist: [],
      envPassthrough: [],
      image: tag,
      network: "none",
    })
    const launched = launcher({
      args: ["-c", `cat ${path.join(mountDir, "marker.txt")}`],
      command: "sh",
      cwd: mountDir,
    })
    try {
      const mounted = await runProcess({
        args: launched.args,
        command: launched.command,
        cwd: launched.cwd,
        timeoutMs: 60_000,
      })
      assert.equal(mounted.exitCode, 0, mounted.stderr)
      assert.match(mounted.stdout, /mounted-ok/)
    } finally {
      // Teardown resolves without throwing (the container already --rm'd).
      await launched.cleanup()
      await rm(mountDir, { force: true, recursive: true })
    }
  } finally {
    await runProcess({
      args: ["rmi", "-f", tag],
      command: "docker",
      cwd: context,
      timeoutMs: 60_000,
    }).catch(() => {})
    await rm(context, { force: true, recursive: true })
  }
})
