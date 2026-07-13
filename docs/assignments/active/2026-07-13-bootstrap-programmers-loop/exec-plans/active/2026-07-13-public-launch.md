---
title: "Prepare the public launch"
status: active
created_at: 2026-07-13
completed_at: null
summary: "Explain why Programmers Loop exists, add a minimal visual identity, audit the repository, and publish it publicly."
post_build_recap: null
read_when:
  - "Preparing or reviewing the first public repository launch."
---

# Prepare the public launch

## Purpose / Big Picture

Publish Programmers Loop as a small, teachable public repository whose README
explains the original product insight: frontier models may improvise a strong
development process, while cheaper models benefit from durable external memory,
explicit lifecycle transitions, critique, and deterministic proof.

## Progress

- [x] Rewrite the README around the project rationale and intended audience.
- [x] Generate and add a minimal README hero image.
- [x] Complete the public-content and repository-history audit.
- [x] Select and add an open-source license.
- [x] Run final proof from the exact initial commit candidate.
- [ ] Create the public GitHub repository, update its metadata, and push `main`.

## Surprises & Discoveries

The generated 3:1 editorial illustration maps naturally to the lifecycle:
packet, convergence, and verified proof. The local repository is still an
unborn `main` branch, so the first commit can remain clean and intentional.
The Bun policy audit created an ignored local cache; `.bun-platform/` is now
excluded from the public tree.

## Decision Log

- 2026-07-13: Keep the README minimal and lead with the “why,” not the artifact
  schemas.
- 2026-07-13: Use a text-free raster hero so the image works across GitHub
  themes and does not duplicate the heading.
- 2026-07-13: Do not publish until the user selects the open-source license;
  repository policy explicitly reserves that legal choice.
- 2026-07-13: Use MIT as the conventional permissive license for a small
  educational runtime; attribute the project contributors rather than one
  individual.
- 2026-07-13: The complete Bun proof and all nine skill validators passed on
  the initial commit candidate.

## Outcomes & Retrospective

Pending license selection, publication, and final receipts.

## Context and Orientation

The root `README.md` owns the public entrypoint. The hero asset is
`assets/programmers-loop-hero.png`. Public-content rules live in
`docs/SECURITY.md`. The repository has no commits or remote yet.

## Plan of Work

### In Scope

- Public-facing README narrative and minimal generated hero image.
- License selection and checked-in license file.
- Secret, identity, path, source-history, generated-file, and package audit.
- Initial conventional commit on `main`.
- Public GitHub repository creation, description, topics, and initial push.

### Out of Scope

- npm publication, a tagged release, hosted CI, website, or social launch.
- Implementing safe proof execution or the Program runtime state machine.
- Rewriting planning contracts or runtime behavior for launch polish.

## Milestones

1. A new reader understands why the project exists within the first screen.
2. The public asset and every linked document pass repository validation.
3. The exact committed tree is public-safe and fully verified.
4. GitHub metadata accurately describes the repository and `main` is pushed.

## Concrete Steps

1. Rewrite the README and add the generated hero under `assets/`.
2. Audit the full tree for credentials, personal paths, private identifiers,
   source-repository references, and accidental generated state.
3. Add the user-selected license and update README status.
4. Run `bun install --frozen-lockfile`, skill validation, and the full check.
5. Commit the complete initial repository with a conventional message.
6. Create `ParkerRex/programmers-loop` as public, set description and topics,
   and push `main`.
7. Re-run GitHub doctor and verify repository visibility and metadata.

## Validation and Acceptance

The README must render with a valid local image and explain the project
rationale without private source context. The full repository check must pass.
The GitHub repository must be public, show the intended description and topics,
and expose the pushed `main` commit.

### Test Commands

```bash
bun install --frozen-lockfile
bun run check
bun run doctor:github
```

## Idempotence and Recovery

README and asset changes are local until publication. `gh repo create` must run
only after confirming the target does not already exist. If repository creation
succeeds but push or metadata update fails, retain the configured remote, repair
the failed step, and verify before retrying any create operation.

## Artifacts and Notes

Hero image prompt: minimal Swiss editorial technical illustration; continuous
cobalt loop through packet, convergence, and proof; warm bone background;
charcoal and one coral accent; no text, logos, people, robots, or watermark.

## Interfaces and Dependencies

Use the built-in image-generation path for the raster asset, Bun for local
verification, local Git for the initial commit and push, and authenticated
GitHub CLI for public repository creation and metadata.
