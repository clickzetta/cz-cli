// cz_change: single place that decides what counts as true/false for a
// hand-written boolean. Both surfaces that need one — options in profiles.toml
// and CZ_* env vars — are typed by a human, so "0"/"false"/"no"/"off" and their
// positive counterparts all show up in practice.

const TRUE_WORDS = new Set(["1", "true", "yes", "on"])
const FALSE_WORDS = new Set(["0", "false", "no", "off"])

/**
 * Parse a human-written boolean. Returns undefined for anything unrecognised —
 * an empty string, a typo, a non-string value — so a caller reads that as "no
 * preference expressed" and keeps its own default instead of silently flipping
 * behaviour on a misspelling.
 */
export function parseBoolish(raw: unknown): boolean | undefined {
  if (typeof raw === "boolean") return raw
  if (typeof raw !== "string") return undefined
  const value = raw.trim().toLowerCase()
  if (TRUE_WORDS.has(value)) return true
  if (FALSE_WORDS.has(value)) return false
  return undefined
}
