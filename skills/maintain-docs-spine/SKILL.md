---
name: maintain-docs-spine
description: "Maintain the Programmers Loop documentation spine and Markdown quality contract. Use when adding, moving, linking, or revising repository docs, prompt routes, skill routes, architecture pages, or planning guidance."
---

# Maintain Docs Spine

1. Start at `docs/index.md`; read the nearest owning page before editing.
2. Update the narrowest canonical document. Avoid duplicating contract details
   into indexes, skills, prompts, or root guidance.
3. Give first-class spine documents `title`, `summary`, `status`, `read_when`,
   and `Owns`, `Does Not Own`, and `Next` sections.
4. Use repository-relative Markdown links and valid heading anchors.
5. When adding a durable route, update `src/docs/spine.ts` and the nearest index
   together.
6. Run `programmers-loop docs lint`, repair every issue, then run the narrowest
   affected tests.

Do not add unreachable doctrine or a second source of truth for an existing
contract.
