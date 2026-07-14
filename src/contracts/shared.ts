import path from "node:path"

import type { FrontmatterRecord } from "../markdown/frontmatter.js"

export const KEBAB_CASE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== ""
}

export function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false
  }
  const parsed = new Date(`${value}T00:00:00.000Z`)
  return (
    !Number.isNaN(parsed.valueOf()) &&
    parsed.toISOString().slice(0, 10) === value
  )
}

export function validateAllowedKeys(
  metadata: FrontmatterRecord,
  allowedKeys: ReadonlySet<string>,
): string[] {
  return Object.keys(metadata)
    .filter((key) => !allowedKeys.has(key))
    .toSorted()
    .map((key) => `Unexpected frontmatter key: ${key}.`)
}

export function safeRepoRelativePath(value: string): boolean {
  return (
    !path.isAbsolute(value) &&
    !path.win32.isAbsolute(value) &&
    !value.includes("\\") &&
    !value.includes("://") &&
    path.posix.normalize(value) === value &&
    !value
      .split("/")
      .some((segment) => segment === "" || segment === "." || segment === "..")
  )
}

export function extractSubsection(
  sectionBody: string,
  heading: string,
): string | null {
  const lines = sectionBody.split("\n")
  const start = lines.findIndex((line) => line === `### ${heading}`)
  if (start === -1) return null
  const next = lines.findIndex(
    (line, index) =>
      index > start && (line.startsWith("### ") || line.startsWith("## ")),
  )
  return lines
    .slice(start + 1, next === -1 ? undefined : next)
    .join("\n")
    .trim()
}

export function subsectionIndex(sectionBody: string, heading: string): number {
  return sectionBody.split("\n").findIndex((line) => line === `### ${heading}`)
}

export function isMeaningfulText(value: string | null): boolean {
  if (!value || value.trim() === "") return false
  return !/^(?:none yet|not complete yet|pending|tbd)\.?$/i.test(value.trim())
}
