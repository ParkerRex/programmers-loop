---
name: verify-programmers-loop
description: "Verify Programmers Loop changes with focused checks, aggregate proof, and honest failure reporting. Use before handoff, completion, commit, release, or after changing code, docs, prompts, skills, or planning artifacts."
---

# Verify Programmers Loop

1. Run the narrowest affected check first: focused artifact lint,
   `programmers-loop docs lint`, or the relevant test file.
2. Run `bun run check` after significant changes.
3. Run `programmers-loop doctor`; add `--github` only when remote lifecycle
   health is in scope.
4. Record the exact commands, results, warnings, and checks that could not run.
5. Claim completion only when acceptance behavior and every required gate pass.

Do not hide warnings, substitute formatting for behavior proof, or describe an
unrun check as successful.
