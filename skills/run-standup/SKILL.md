---
name: run-standup
description: "Produce a read-only Programmers Loop standup from active Assignments, Programs, ExecPlans, and doctor checks. Use for status, handoff, lifecycle drift, blockers, or local and GitHub health review."
---

# Run Standup

1. Run `programmers-loop standup --github --json` when GitHub context is
   configured; otherwise omit `--github`.
2. Summarize active Assignments, each Program, and every active ExecPlan from
   checked-in artifacts rather than chat history or logs.
3. Report failures first, then warnings, blocked work, the current slice, and
   the next durable action.
4. Distinguish absent optional GitHub setup from a local lifecycle failure.
5. Link or name the exact artifact that owns each status claim.

Keep the pass read-only. Do not edit packets, change GitHub state, authenticate,
or advance a lifecycle transition during standup.
