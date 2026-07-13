---
name: plan-assignment
description: "Create or update a Programmers Loop Assignment packet. Use when one coherent body of work needs durable scope, shared evidence, Programs, standalone ExecPlans, or lifecycle status."
---

# Plan Assignment

1. Read `docs/contracts/assignment.md`.
2. Choose a stable kebab-case slug and preview `programmers-loop assignment
create --slug <slug> --title <title> --dry-run`.
3. Create the packet without `--dry-run`; review `README.md` and
   `assignment.yaml` before adding children.
4. Keep `assignment_id`, `assignment_slug`, folder slug, and `root_path`
   aligned.
5. Add shared evidence at the Assignment root only when multiple child plans
   need it.
6. Put discovery-heavy initiatives under `programs/active/`; put bounded
   standalone work under `exec-plans/active/`.
7. Run `programmers-loop assignment lint --path <assignment>` and repair every
   issue.

Move the entire packet to `completed/` only after its Programs and ExecPlans
are complete and its status and links are updated.
