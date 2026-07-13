---
name: diagnose-programmers-loop
description: "Diagnose local and GitHub health for a Programmers Loop repository. Use for missing tools, invalid packets, broken configuration, agent availability, authentication, remote setup, or lifecycle drift."
---

# Diagnose Programmers Loop

1. Run `programmers-loop doctor --github --json`.
2. Repair local failures first: Node, Git, Bun, configuration, contracts, skills,
   agent adapter, and planning lint.
3. Repair GitHub warnings second: `gh` authentication, target repository, and
   readable repository metadata.
4. Run `programmers-loop planning lint` directly for detailed contract errors;
   use focused `assignment`, `program`, or `exec-plan` lint when narrowing one
   packet.
5. Re-run the doctor and report remaining warnings separately from failures.

Keep diagnosis read-only. Do not create repositories, change authentication,
edit GitHub fields, or mutate issues and pull requests without explicit user
authority.
