/**
 * literal.ts — SQL literal escaping and quoting.
 *
 * Python → TS mapping:
 *   converter.py:218-227  Converter.escape → escape
 *   converter.py:229-268  Converter.quote  → quote
 *
 * Used by the pyformat parameter substitution path in session.ts and
 * by any caller that needs to embed a JS value into a SQL string safely.
 */

/**
 * converter.py:218-227 Converter.escape
 * Escapes a string value for embedding inside single-quoted SQL literals.
 */
export function escape(value: unknown): unknown {
  if (!value || typeof value !== "string") return value
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/'/g, "\\'")
}

/**
 * converter.py:229-268 Converter.quote
 * Converts a JS value to its SQL literal representation.
 *
 * Type mapping (mirrors Python):
 *   null/undefined → NULL
 *   boolean        → true / false
 *   number         → repr (string)
 *   Uint8Array     → X'<hex>'
 *   string         → '<escaped>' (with INTERVAL/TIMESTAMP/DATE/JSON pass-through)
 *   Date           → TIMESTAMP '<iso>'
 *   Array          → ARRAY(...)
 *   Map            → MAP(...)
 *   object (plain) → MAP(...)
 *   tuple (Array used as tuple) → STRUCT(...)
 */
export function quote(value: unknown): string {
  // converter.py:247 — None → NULL
  if (value == null) return "NULL"

  // converter.py:249-250 — bool
  if (typeof value === "boolean") return value ? "true" : "false"

  // converter.py:251-253 — int / float / Decimal (number in JS)
  if (typeof value === "number") return String(value)
  if (typeof value === "bigint") return String(value)

  // converter.py:254-256 — bytes → X'<hex>'
  if (value instanceof Uint8Array) {
    const hex = Array.from(value)
      .map((b) => b.toString(16).padStart(2, "0").toUpperCase())
      .join("")
    return `X'${hex}'`
  }

  // converter.py:257-263 — string with special prefixes
  if (typeof value === "string") {
    if (value.startsWith("INTERVAL ")) return value
    if (value.startsWith("TIMESTAMP '") || value.startsWith("DATE '")) return value
    if (/^JSON\s*'/i.test(value.trim())) return value.trim()
    return `'${escape(value)}'`
  }

  // converter.py:264-265 — Date → TIMESTAMP
  if (value instanceof Date) {
    return `TIMESTAMP '${value.toISOString().replace("T", " ").replace("Z", "+00:00")}'`
  }

  // converter.py:242-246 — Array → ARRAY(...)
  if (Array.isArray(value)) {
    if (value.length === 0) return "ARRAY()"
    return `ARRAY(${value.map(quote).join(",")})`
  }

  // converter.py:236-241 — Map / dict → MAP(...)
  if (value instanceof Map) {
    if (value.size === 0) return "MAP()"
    const pairs = Array.from(value.entries())
      .map(([k, v]) => `${quote(k)},${quote(v)}`)
      .join(",")
    return `MAP(${pairs})`
  }

  // Plain object → MAP(...)
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
    if (entries.length === 0) return "MAP()"
    const pairs = entries.map(([k, v]) => `${quote(k)},${quote(v)}`).join(",")
    return `MAP(${pairs})`
  }

  // Fallback
  return `'${escape(String(value))}'`
}
