import { createHash } from "node:crypto"
import type { Dirent } from "node:fs"
import { readdir, readFile } from "node:fs/promises"
import path from "node:path"

import { parseMarkdownFrontmatter } from "../markdown/frontmatter.js"

/**
 * Curated procedural skill layer (SkillsBench, arXiv 2602.12670).
 *
 * The paper's findings drive every constant and rule in this module. Curated,
 * HUMAN-authored procedural skills lifted verified success by +16.2pp, but the
 * effect is fragile: two-to-three FOCUSED, SHORT skills were optimal, while
 * comprehensive documentation HURT (-2.9pp) and self-generated guidance landed
 * −8.1 to −11.3pp below the no-skills baseline. Advisory-only context is
 * ignored by some CLIs, so the value comes from selecting a small, curated set
 * and rendering it as a salient block — not from volume. The caps here are
 * therefore enforced in code, never trusted to authoring discipline.
 *
 * This module only SELECTS and RENDERS skills and hashes the pack for run
 * comparability. Wiring the rendered block into a phase prompt lives at the
 * prompt-assembly call sites in exec-plan.ts.
 */

/**
 * Hard cap on curated skills injected into any single phase prompt. The
 * SkillsBench "2-3 short skills optimal; more/longer guidance regressed"
 * finding is the reason this is 3 and is enforced rather than advisory.
 */
export const CURATED_SKILLS_MAX_PER_PHASE = 3

/**
 * Hard per-skill line budget for a SKILL.md file (frontmatter included). The
 * SkillsBench "comprehensive documentation hurt (-2.9pp)" finding is why an
 * oversized skill is REJECTED at load rather than truncated or warned.
 */
export const MAX_SKILL_LINES = 60

/** ExecPlan spine phases a curated skill may target. */
export const SKILL_PHASES = ["write", "grill", "execute", "validate"] as const
export type SkillPhase = (typeof SKILL_PHASES)[number]

/** Workflow shapes a curated skill may target (routed by the eval harness). */
export const SKILL_SHAPES = ["exec-plan", "program", "skip"] as const
export type SkillShape = (typeof SKILL_SHAPES)[number]

export type CuratedSkill = {
  /** Directory-name identity, e.g. `scope-discipline`. */
  slug: string
  /** Higher wins when the per-phase budget forces a choice; ties break by slug. */
  priority: number
  /** Phases this skill applies to; empty means every phase. */
  phases: SkillPhase[]
  /** Shapes this skill applies to; empty means every shape. */
  shapes: SkillShape[]
  /** Mechanically-checkable rule hint from frontmatter, or null. */
  lintable: string | null
  /** Rendered skill body (H1 + prose), frontmatter stripped. */
  body: string
  /** Line count of the full SKILL.md source, for the {@link MAX_SKILL_LINES} cap. */
  lineCount: number
}

function defaultCuratedSkillsDir(): string {
  // Mirrors loadRuntimePrompt's package-root resolution: from src/workflows,
  // `../..` is the package root, and curated skills ship under skills/curated/.
  return path.resolve(import.meta.dirname, "..", "..", "skills", "curated")
}

function asStringArray(value: unknown): string[] {
  if (value === undefined) return []
  if (
    !Array.isArray(value) ||
    value.some((entry) => typeof entry !== "string")
  ) {
    throw new Error("must be a list of strings")
  }
  return value as string[]
}

function parseCuratedSkill(
  slug: string,
  source: string,
  file: string,
): CuratedSkill {
  const lineCount = source.replace(/\n+$/, "").split("\n").length
  if (lineCount > MAX_SKILL_LINES) {
    throw new Error(
      `Curated skill ${file} is ${lineCount} lines, over the ${MAX_SKILL_LINES}-line budget (SkillsBench: comprehensive docs hurt).`,
    )
  }
  const { body, metadata, issues } = parseMarkdownFrontmatter(source)
  if (issues.length > 0) {
    throw new Error(
      `Curated skill ${file} frontmatter is invalid: ${issues[0]}`,
    )
  }
  const appliesTo = metadata.applies_to
  if (appliesTo === undefined) {
    throw new Error(`Curated skill ${file} must declare an applies_to object.`)
  }
  // `applies_to:` with no children (YAML null) means "every phase, every shape".
  if (
    appliesTo !== null &&
    (typeof appliesTo !== "object" || Array.isArray(appliesTo))
  ) {
    throw new Error(`Curated skill ${file} applies_to must be an object.`)
  }
  const applies = (appliesTo ?? {}) as Record<string, unknown>
  let phases: string[]
  let shapes: string[]
  try {
    phases = asStringArray(applies.phases)
    shapes = asStringArray(applies.shapes)
  } catch (error) {
    throw new Error(
      `Curated skill ${file} applies_to phases/shapes ${error instanceof Error ? error.message : "are invalid"}.`,
      { cause: error },
    )
  }
  for (const phase of phases) {
    if (!SKILL_PHASES.includes(phase as SkillPhase)) {
      throw new Error(`Curated skill ${file} names unknown phase: ${phase}.`)
    }
  }
  for (const shape of shapes) {
    if (!SKILL_SHAPES.includes(shape as SkillShape)) {
      throw new Error(`Curated skill ${file} names unknown shape: ${shape}.`)
    }
  }
  const priority = metadata.priority
  if (typeof priority !== "number" || !Number.isFinite(priority)) {
    throw new Error(`Curated skill ${file} must declare a numeric priority.`)
  }
  const lintable = metadata.lintable
  if (
    lintable !== undefined &&
    lintable !== null &&
    typeof lintable !== "string"
  ) {
    throw new Error(`Curated skill ${file} lintable must be a string when set.`)
  }
  return {
    slug,
    priority,
    phases: phases as SkillPhase[],
    shapes: shapes as SkillShape[],
    lintable: typeof lintable === "string" ? lintable : null,
    body: body.trim(),
    lineCount,
  }
}

/** Higher priority first; ties broken by slug for deterministic selection. */
function compareSkills(a: CuratedSkill, b: CuratedSkill): number {
  if (b.priority !== a.priority) return b.priority - a.priority
  return a.slug.localeCompare(b.slug)
}

/**
 * Load every `<slug>/SKILL.md` under `dir` (defaulting to the package's
 * `skills/curated/`). A missing directory yields no skills — a repository
 * without a curated pack simply injects nothing. A malformed or oversized skill
 * throws: the budgets are invariants, not warnings.
 */
export async function loadCuratedSkills(
  dir: string = defaultCuratedSkillsDir(),
): Promise<CuratedSkill[]> {
  let entries: Dirent<string>[]
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return []
  }
  const skills: CuratedSkill[] = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const file = path.join(dir, entry.name, "SKILL.md")
    let source: string
    try {
      source = await readFile(file, "utf8")
    } catch {
      continue
    }
    skills.push(parseCuratedSkill(entry.name, source, file))
  }
  return skills.toSorted(compareSkills)
}

/**
 * Apply the skill-ablation allowlist (Decision D18): keep only the skills whose
 * slug is in `include`, preserving order. A null/undefined `include` means no
 * filter — the SAME array is returned so the unfiltered path is byte-identical
 * to the pre-filter behavior. An empty list is the no-skill arm. A slug that
 * names no loaded skill throws: an ablation arm silently running the wrong
 * treatment is exactly the drift the config hash exists to prevent.
 */
export function filterCuratedSkills(
  skills: CuratedSkill[],
  include: readonly string[] | null | undefined,
): CuratedSkill[] {
  if (include === null || include === undefined) return skills
  const loaded = new Set(skills.map((skill) => skill.slug))
  const unknown = include.filter((slug) => !loaded.has(slug))
  if (unknown.length > 0) {
    throw new Error(
      `skills.include names unknown curated skill(s): ${unknown.join(", ")}. Loaded pack: ${[...loaded].join(", ") || "(empty)"}.`,
    )
  }
  const wanted = new Set(include)
  return skills.filter((skill) => wanted.has(skill.slug))
}

/**
 * Select the skills that apply to a phase+shape, priority-ordered and capped at
 * `max` (default {@link CURATED_SKILLS_MAX_PER_PHASE}). The cap is the load-
 * bearing SkillsBench control: a fourth applicable skill is dropped by design,
 * because injecting more than the optimal two-to-three regressed the benchmark.
 */
export function selectCuratedSkills(params: {
  skills: CuratedSkill[]
  phase: SkillPhase
  shape: SkillShape
  max?: number
}): CuratedSkill[] {
  const max = params.max ?? CURATED_SKILLS_MAX_PER_PHASE
  const applicable = params.skills
    .filter((skill) => {
      const phaseOk =
        skill.phases.length === 0 || skill.phases.includes(params.phase)
      const shapeOk =
        skill.shapes.length === 0 || skill.shapes.includes(params.shape)
      return phaseOk && shapeOk
    })
    .toSorted(compareSkills)
  return applicable.slice(0, Math.max(0, max))
}

/**
 * Render selected skills into a single prompt block body, or undefined when
 * none apply (so renderPrompt omits the block entirely). The caller wraps this
 * in a delimited `<curated_skills>` element.
 */
export function renderCuratedSkills(
  skills: readonly CuratedSkill[],
): string | undefined {
  if (skills.length === 0) return undefined
  const header =
    "Human-curated procedural skills selected for this phase (SkillsBench, arXiv 2602.12670), derived from observed live failures in this project. Follow them."
  return [header, ...skills.map((skill) => skill.body)].join("\n\n---\n\n")
}

/**
 * Load, filter, select, and render the curated-skills block for one phase+shape
 * in a single call — the convenience the prompt-assembly call sites use.
 * `include` is the Decision-D18 ablation allowlist (null/undefined = full
 * pack); it is applied to the loaded pack BEFORE the per-phase selection, so an
 * ablated run competes for the same per-phase budget from the reduced pack.
 */
export async function curatedSkillsBlock(params: {
  phase: SkillPhase
  shape: SkillShape
  max?: number
  dir?: string
  include?: readonly string[] | null
}): Promise<string | undefined> {
  const skills = filterCuratedSkills(
    await loadCuratedSkills(params.dir),
    params.include,
  )
  return renderCuratedSkills(
    selectCuratedSkills({
      skills,
      phase: params.phase,
      shape: params.shape,
      max: params.max,
    }),
  )
}

async function collectFiles(
  dir: string,
  base: string,
): Promise<{ rel: string; abs: string }[]> {
  let entries: Dirent<string>[]
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return []
  }
  const out: { rel: string; abs: string }[] = []
  for (const entry of entries.toSorted((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    const abs = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      out.push(...(await collectFiles(abs, base)))
    } else {
      out.push({ abs, rel: path.relative(base, abs).split(path.sep).join("/") })
    }
  }
  return out
}

/**
 * Stable sha256 fingerprint of the curated-skills pack (relative paths plus file
 * bytes, walked in sorted order). Mirrors the eval manifest's `promptDirHash`
 * (workspaceFingerprint over `prompts/`) so a run can stamp the exact skill pack
 * a loop episode was treated with. Exposed for the eval to fold into its config
 * hash; changing any SKILL.md byte changes this hash.
 */
export async function curatedSkillsHash(
  dir: string = defaultCuratedSkillsDir(),
): Promise<string> {
  const hash = createHash("sha256")
  for (const file of await collectFiles(path.resolve(dir), path.resolve(dir))) {
    const content = createHash("sha256")
      .update(await readFile(file.abs))
      .digest("hex")
    hash.update(`F ${file.rel} ${content}\n`)
  }
  return hash.digest("hex")
}
