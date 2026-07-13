---
title: "Documentation"
summary: "Canonical entrypoint and routing map for Programmers Loop."
status: active
read_when:
  - "Starting meaningful work in this repository."
  - "Finding the owner of a contract, runtime, prompt, or skill."
---

# Documentation

## Owns

- The canonical route into repository documentation.
- The map from product concepts to their owning documents.
- The minimum reading order for humans and agents.

## Does Not Own

- Artifact details owned by the Assignment, Program, and ExecPlan contracts.
- Implementation details owned by source modules and tests.
- Live run state under `.runtime/`.

## How agents load repository guidance

Read root `AGENTS.md`, then this index, then the nearest linked contract or
skill. More specific instructions should narrow broader repository guidance.
Use checked-in plans as durable work state; do not depend on hidden chat history.

## Next

- [Architecture](ARCHITECTURE.md)
- [Command-line interface](CLI.md)
- [Configuration](CONFIGURATION.md)
- [Extraction boundary](EXTRACTION.md)
- [Planning model](PLANS.md)
- [Development workflow](DEVELOPMENT.md)
- [Reliability and proof](RELIABILITY.md)
- [Security model](SECURITY.md)
- [Assignments](assignments/README.md)
- [Artifact anatomy and selection](assignments/artifact-guide.md)
- [Prompt index](prompts/README.md)
- [Skill index](skills/README.md)
