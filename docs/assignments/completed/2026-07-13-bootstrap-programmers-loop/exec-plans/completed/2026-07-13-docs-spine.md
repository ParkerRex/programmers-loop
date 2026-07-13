---
title: "Add the documentation spine and linter"
status: complete
created_at: 2026-07-13
completed_at: 2026-07-13
summary: "Create first-class documentation routes and enforce their metadata, links, ownership, and reachability."
post_build_recap: "Added an eight-page first-class docs spine, all-repository Markdown link linting, route and reachability enforcement, Bun scripts, doctor integration, and three regression tests."
read_when:
  - "Building or reviewing the Programmers Loop documentation system."
---

# Add the documentation spine and linter

## Purpose / Big Picture

Give humans and agents one reliable route through the repository and prevent
important documents from becoming missing, broken, or unreachable.

## Progress

- [x] Define the first-class spine and routing contract.
- [x] Add the architecture, development, reliability, security, plans, prompt,
      and skill indexes.
- [x] Implement metadata, section, route, reachability, local-link, and empty-
      file checks.
- [x] Wire docs lint into the CLI, doctor, and full check.
- [x] Add regression tests and run full proof.

## Surprises & Discoveries

The foundation has strong artifact contracts but no canonical entrypoint beyond
the root README. Links are currently incidental rather than enforced as a graph.

## Decision Log

- Make `docs/index.md` the documentation entrypoint.
- Require `Owns`, `Does Not Own`, and `Next` sections on first-class spine docs.
- Validate all repository Markdown links, but require graph reachability only
  for durable spine nodes.
- Keep archived planning packets outside the reachability requirement while
  still validating their local links.

## Outcomes & Retrospective

The documentation index now reaches every durable spine node. The linter checks
all repository Markdown, first-class metadata and ownership sections, required
`Next` routes, graph reachability, local paths, heading anchors, repository
containment, and empty files. It runs directly, inside the aggregate check, and
inside local and GitHub doctor output. The repository also migrated to Bun as
its sole package manager during this slice.

## Context and Orientation

Existing documentation lives under `docs/`, skills under `skills/`, and prompts
under `prompts/`. Planning lint is separate from the new documentation graph.

## Plan of Work

### In Scope

- First-class documentation pages and indexes.
- Portable Markdown local-link and heading-anchor validation.
- Required-file, frontmatter, ownership-section, route, reachability, and empty-
  file checks.
- CLI, Bun scripts, doctor, and tests.

### Out of Scope

- Generated documentation, web rendering, prose style scoring, or spellcheck.
- Requiring every historical packet to appear in the main docs navigation.
- External URL availability checks.

## Milestones

1. The docs index reaches every durable spine node.
2. Broken paths, anchors, required routes, and metadata fail deterministically.
3. Local doctor and `bun run check` include docs-spine health.

## Concrete Steps

1. Write the first-class docs with explicit ownership and next routes.
2. Implement Markdown discovery and local-link resolution.
3. Implement the spine definition and validator.
4. Add `programmers-loop docs lint` and `bun run docs:lint`.
5. Add negative and dogfood tests.
6. Run all repository proof and archive this plan.

## Validation and Acceptance

The checked-in repository must pass docs lint. Tests must demonstrate detection
of a broken local link and a missing required route.

### Test Commands

```bash
bun run docs:lint
bun run test
bun run check
```

## Idempotence and Recovery

All documentation validation is read-only and deterministic. Re-running it does
not change documents or runtime state.

## Artifacts and Notes

Keep the spine definition small and explicit so readers can understand the
navigation contract without learning repository-specific topology tooling.

## Interfaces and Dependencies

Use Node filesystem and path APIs plus the existing YAML frontmatter parser. Do
not add a Markdown AST dependency for the initial link subset.
