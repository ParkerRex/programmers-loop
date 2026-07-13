---
title: "Reliability"
summary: "Deterministic proof, doctors, receipts, and honest completion rules."
status: active
read_when:
  - "Designing validation, recovery, receipts, or completion gates."
---

# Reliability

## Owns

- The local proof stack and doctor expectations.
- Honest reporting of warnings, failures, and unrun checks.
- Deterministic receipts and bounded recovery for future runtime loops.

The current proof stack is `bun run check`. Documentation and planning lint are
separate named surfaces and are also part of the aggregate. Local doctor failure
blocks completion; an uncommitted worktree is a warning during development.
GitHub doctor is read-only and treats a deliberately missing remote as a warning.

Future proof execution must preview commands, require explicit consent, enforce
configured prefixes and repository containment, use timeouts, bound output, and
write a versioned receipt for every attempt.

## Does Not Own

- Artifact content requirements.
- Which model or provider an adapter selects.
- Authorization for publishing, pushing, or external mutation.

## Next

- [Development workflow](DEVELOPMENT.md)
- [Security model](SECURITY.md)
- [Assignment index](assignments/README.md)
