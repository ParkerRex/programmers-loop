import { randomUUID } from "node:crypto"

import type { ProcessLaunchSpec, ProcessLauncher } from "../agents/types.js"
import { runProcess } from "../process.js"

/**
 * Machine-enforced episode execution behind `sandbox.mode` (ADR
 * `.runtime/evals/sandbox-adr.md`, option i; Decisions D10/D11/D12).
 *
 * `host` mode is the existing macOS temp-dir sandbox — the identity launcher,
 * no container. `container` mode wraps every adapter spawn in `docker run` so a
 * scored episode executes inside a pinned Linux image (D11) with the two
 * controls the host sandbox only *declares*: OS-enforced filesystem containment
 * (the container rootfs + a single bind mount) and OS-enforced network egress
 * denial (a `none` network namespace). What is enforced versus still declared
 * is recorded verbatim on every episode's sandbox-policy block — see
 * {@link describeNetworkEnforcement} — so no report can overclaim isolation.
 */
export type SandboxMode = "host" | "container"

/**
 * Egress policy for `container` mode.
 *
 * - `none` — the only mode whose enforcement is machine-real today: a `--network
 *   none` namespace with no interfaces, so *all* egress is kernel-denied. This
 *   also denies the model endpoint, so it cannot back a live model call; it is
 *   the enforced default for the plumbing smoke and any offline in-container
 *   step.
 * - `allowlist` — the ADR's anticipated scored path: deny everything except the
 *   model endpoint (and declared registries) via a dual-homed proxy sidecar on
 *   an internal network. Its enforcement is NOT wired in this version; a live
 *   `allowlist` run is refused (never silently downgraded to weaker egress
 *   control), and only the reusable allowlist predicate {@link isHostAllowed}
 *   and the topology docs ship as groundwork. It awaits an API key to validate.
 */
export type SandboxNetworkPolicy = "none" | "allowlist"

/** The pinned default image tag built from `evals/docker/Dockerfile`. */
export const DEFAULT_SANDBOX_IMAGE = "loopbench-sandbox:node24"

/** Fully-resolved sandbox settings (see `loadConfig` for defaults). */
export type ResolvedSandboxConfig = {
  mode: SandboxMode
  image: string
  network: SandboxNetworkPolicy
  /** Declared allowlist entries (`host[:port]`); meaningful only for `allowlist`. */
  allowlist: string[]
}

/** The default when a config omits the `sandbox` block: unchanged host behavior. */
export function defaultSandboxConfig(): ResolvedSandboxConfig {
  return {
    mode: "host",
    image: DEFAULT_SANDBOX_IMAGE,
    network: "none",
    allowlist: [],
  }
}

/**
 * The env-var NAMES a container run forwards for an adapter. Only the *name* is
 * ever placed on the `docker run` argv (`-e NAME`); Docker reads each value
 * from its own inherited environment at spawn time, so a secret's value never
 * touches argv, a receipt, or a log. Names absent from the host env forward
 * nothing (Docker treats `-e NAME` with an unset NAME as a no-op), so listing
 * them unconditionally is safe and keeps the forwarded set auditable.
 */
export function containerEnvPassthrough(adapterId: string): string[] {
  if (adapterId === "codex") return ["OPENAI_API_KEY"]
  if (adapterId === "claude") {
    // ANTHROPIC_SMALL_FAST_MODEL carries the D13 utility-model pin the Claude
    // adapter overlays onto process.env around the spawn; forwarding it by name
    // keeps that pin intact inside the container.
    return ["ANTHROPIC_API_KEY", "ANTHROPIC_SMALL_FAST_MODEL"]
  }
  return []
}

export type ContainerLaunchOptions = {
  image: string
  network: SandboxNetworkPolicy
  allowlist: string[]
  /** Env-var names to forward by name (never value). See {@link containerEnvPassthrough}. */
  envPassthrough: string[]
  /** Deterministic container name for teardown; defaults to a random one per call. */
  containerName: string
}

/**
 * Raised when a live `container` run selects `network: allowlist`, whose
 * enforcement is not wired in this version. Refusing (rather than running with
 * weaker or no egress control) is the ADR's "no overclaiming" rule made
 * executable: an unenforceable policy must fail loudly, not silently degrade.
 */
export class AllowlistEgressNotWiredError extends Error {
  constructor() {
    super(
      "sandbox.network 'allowlist' is not wired for live runs yet: it requires " +
        "a proxy sidecar on an internal network and an API key to validate. Use " +
        "network 'none' (kernel-enforced total egress denial) for offline steps, " +
        "or run on the host. See evals/README.md 'Containerized scored runs'.",
    )
    this.name = "AllowlistEgressNotWiredError"
  }
}

/**
 * Pure allowlist predicate for the anticipated proxy sidecar: is `host`
 * (optionally `host:port`) permitted by `allowlist`? Case-insensitive exact
 * host match; an allowlist entry may pin a port (`api.openai.com:443`) or omit
 * it to allow any port. Ships now as validated groundwork for the proxy the ADR
 * anticipates; it is not yet consumed by any live run.
 */
export function isHostAllowed(target: string, allowlist: string[]): boolean {
  const [host, port] = splitHostPort(target)
  if (host === "") return false
  return allowlist.some((entry) => {
    const [allowHost, allowPort] = splitHostPort(entry)
    if (allowHost.toLowerCase() !== host.toLowerCase()) return false
    return allowPort === "" || allowPort === port
  })
}

function splitHostPort(value: string): [string, string] {
  const trimmed = value.trim()
  const colon = trimmed.lastIndexOf(":")
  if (colon === -1) return [trimmed, ""]
  const maybePort = trimmed.slice(colon + 1)
  if (maybePort !== "" && /^\d+$/.test(maybePort)) {
    return [trimmed.slice(0, colon), maybePort]
  }
  return [trimmed, ""]
}

/**
 * Build the `docker run …` argv that wraps an adapter's host spawn. Pure and
 * deterministic given its inputs (mirrors `buildCodexExecArgs`), so mounts,
 * network args, and the env passthrough list are unit-testable without a
 * daemon.
 *
 * Key choices, justified:
 * - **Identity bind mount** (`-v cwd:cwd -w cwd`): the sandbox is mounted at the
 *   SAME absolute path it has on the host, not a fixed `/workspace`. The adapter
 *   builds Codex/Claude argv referencing the sandbox by absolute path
 *   (`--cd <sandbox>`, `--output-last-message <sandbox>/.runtime/…`); an
 *   identity mount makes every such path resolve unchanged inside the container
 *   with ZERO argv rewriting — which is what keeps this a launcher seam rather
 *   than a fork of adapter logic. It deviates from the ADR's literal "fixed
 *   path" wording and leaks the host path into the container transcript (a minor
 *   D11 reproducibility wrinkle); both are called out in evals/README.md.
 * - **`-i`**: the prompt travels over stdin; `-i` forwards the client's stdin
 *   to the container process.
 * - **`--rm` + `--name`**: `--rm` reclaims the container on clean exit; the name
 *   lets {@link makeContainerLauncher} force-remove it if the run times out
 *   (SIGKILL of the `docker run` client does not stop the container).
 * - **`-e NAME`** name-only env forwarding: redaction by construction.
 */
export function buildContainerRunArgs(
  spec: ProcessLaunchSpec,
  options: ContainerLaunchOptions,
): string[] {
  if (options.network === "allowlist") throw new AllowlistEgressNotWiredError()
  const args = [
    "run",
    "--rm",
    "-i",
    "--name",
    options.containerName,
    // Kernel-enforced total egress denial: an isolated network namespace with no
    // interfaces. Also denies the model endpoint, so this cannot back a live
    // model call — recorded honestly on the episode's sandbox policy.
    "--network",
    "none",
    // Identity mount + workdir: host path == container path, so the adapter's
    // absolute-path argv resolves and its outputs land back on the host.
    "-v",
    `${spec.cwd}:${spec.cwd}`,
    "--workdir",
    spec.cwd,
  ]
  for (const name of options.envPassthrough) args.push("-e", name)
  args.push(options.image, spec.command, ...spec.args)
  return args
}

/**
 * A {@link ProcessLauncher} that runs each adapter spawn inside `docker run`.
 * Every invocation gets a unique container name so the loop arm's multiple
 * phase calls never collide, and `cleanup` best-effort force-removes that
 * container so a timed-out run (where `runProcess` SIGKILLs only the client)
 * cannot orphan it.
 */
export function makeContainerLauncher(options: {
  image: string
  network: SandboxNetworkPolicy
  allowlist: string[]
  envPassthrough: string[]
  dockerCommand?: string
}): ProcessLauncher {
  const dockerCommand = options.dockerCommand ?? "docker"
  return (spec) => {
    const containerName = `loopbench-${randomUUID().slice(0, 12)}`
    const args = buildContainerRunArgs(spec, {
      allowlist: options.allowlist,
      containerName,
      envPassthrough: options.envPassthrough,
      image: options.image,
      network: options.network,
    })
    return {
      args,
      cleanup: async () => {
        try {
          await runProcess({
            args: ["rm", "--force", containerName],
            command: dockerCommand,
            cwd: spec.cwd,
            timeoutMs: 30_000,
          })
        } catch {
          // Best-effort teardown: `--rm` handles the clean-exit case, so a
          // failure here means the container was already gone.
        }
      },
      command: dockerCommand,
      cwd: spec.cwd,
    }
  }
}

/**
 * Resolve the local image's config digest via `docker image inspect`. This is
 * the content id of the locally built image (`sha256:…`), NOT a registry
 * digest — a locally built, unpushed image has no registry digest — and it is
 * recorded as such (never labeled a registry digest). Null when the image is
 * absent or the daemon is unreachable.
 */
export async function resolveImageDigest(
  image: string,
  dockerCommand = "docker",
): Promise<string | null> {
  try {
    const result = await runProcess({
      args: ["image", "inspect", image, "--format", "{{.Id}}"],
      command: dockerCommand,
      cwd: process.cwd(),
      timeoutMs: 30_000,
    })
    if (result.exitCode !== 0) return null
    const id = result.stdout.trim()
    return id === "" ? null : id
  } catch {
    return null
  }
}

/** True when a Docker daemon answers `docker version`. Best-effort, never throws. */
export async function dockerAvailable(
  dockerCommand = "docker",
): Promise<boolean> {
  try {
    const result = await runProcess({
      args: ["version", "--format", "{{.Server.Version}}"],
      command: dockerCommand,
      cwd: process.cwd(),
      timeoutMs: 15_000,
    })
    return result.exitCode === 0 && result.stdout.trim() !== ""
  } catch {
    return false
  }
}

/**
 * Human-readable, deliberately non-overclaiming description of what a network
 * policy actually enforces, recorded verbatim on each episode's sandbox policy.
 */
export function describeNetworkEnforcement(
  network: SandboxNetworkPolicy,
): string {
  return network === "none"
    ? "kernel-enforced total egress denial (--network none); model endpoint unreachable, so live model calls await the allowlisted-egress path and an API key"
    : "declared only — allowlisted egress via proxy sidecar is not wired; live runs are refused pending an API key"
}
