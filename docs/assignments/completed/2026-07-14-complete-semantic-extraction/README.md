---
title: "Complete semantic extraction"
summary: "Restore the full portable Assignment, Program, and ExecPlan contracts instead of retaining a reduced approximation."
status: complete
read_when:
  - "Tracking the semantic-parity extraction from the originating planning implementation."
---

# Complete semantic extraction

This Assignment restored the complete reusable planning behavior: strict
artifact contracts, safe lifecycle transitions, detailed operating prompts,
session and handoff input, deterministic proof boundaries, and regression
coverage. Product-specific application policy remains outside the standalone
core as an explicit extension surface.

See [proof.md](proof.md), [review.md](review.md), and [receipts.md](receipts.md)
for the completed evidence.
