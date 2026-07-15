# LoopBench scored-run sandbox image (Decision D11; ADR option i).
#
# A pinned Linux image that provides the agent toolchain and NOTHING from this
# repository: the task workspace is bind-mounted at run time (see
# `src/evals/sandbox.ts`), never baked in, so one image serves every task and no
# task fixture or hidden grader is ever layered into the image.
#
# Build (from the repo root):
#   docker build -f evals/docker/Dockerfile -t loopbench-sandbox:node24 evals/docker
# Override a pin:
#   docker build --build-arg CODEX_VERSION=0.144.3 --build-arg INSTALL_CLAUDE=true ...
#
# The digest of the built image is recorded per episode as the image CONFIG id
# (`docker image inspect --format {{.Id}}`); a locally built, unpushed image has
# no registry digest.
#
# NOTE: the exact CLI install commands below are pinned by version ARG but were
# NOT executed in a live build in the change that introduced this file (that
# awaits an API key and a network-enabled build host). Confirm the package names
# and versions resolve before the first scored build.

# Pin the base by major version; pin to a digest for a fully reproducible build.
ARG NODE_VERSION=24-bookworm-slim
FROM node:${NODE_VERSION}

# Toolchain versions (kept as ARGs so a run can pin the exact study versions).
ARG BUN_VERSION=1.3.14
ARG CODEX_VERSION=0.144.3
ARG CLAUDE_VERSION=2.1.206
# Claude Code is optional: the 0.1 scored pair is GPT-5.6 via Codex (D2). Build
# with --build-arg INSTALL_CLAUDE=true for smoke and future Anthropic arms.
ARG INSTALL_CLAUDE=false

# git: the harness git-inits the sandbox and graders diff against the baseline.
# ca-certificates: TLS to the model endpoint once allowlisted egress is wired.
# curl/unzip: fetch the pinned bun installer.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
        curl \
        git \
        unzip \
    && rm -rf /var/lib/apt/lists/*

# bun (pinned) — the Loop CLI shim and JS task toolchains run under bun 1.3.14.
ENV BUN_INSTALL=/usr/local/bun
ENV PATH=${BUN_INSTALL}/bin:${PATH}
RUN curl -fsSL https://bun.sh/install | bash -s "bun-v${BUN_VERSION}" \
    && bun --version

# codex CLI (pinned) — the scored-run agent (D2). Installed globally so it is on
# PATH as a bare `codex` command, matching the host adapter's spawn.
RUN npm install -g @openai/codex@${CODEX_VERSION} \
    && codex --version

# claude CLI (optional, pinned) — smoke runs and future Anthropic arms.
RUN if [ "${INSTALL_CLAUDE}" = "true" ]; then \
        npm install -g @anthropic-ai/claude-code@${CLAUDE_VERSION} \
        && claude --version; \
    fi

# No repo code is copied in. The workspace is bind-mounted at run time; the
# launcher sets --workdir to the mount path, so this WORKDIR is only a default.
WORKDIR /workspace

# Default to a shell so `docker run <image> <cmd>` overrides it with the agent
# invocation the launcher supplies.
CMD ["bash"]
