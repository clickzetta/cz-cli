/**
 * Converter class ported from clickzetta/connector/v0/converter.py.
 * Converts JS values to ClickZetta SQL-compatible representations.
 */

const ZERO_TIMEDELTA_MS = 0

/**
 * Escape special characters in a string for SQL.
 */
export function escape(value: unknown): unknown {
  if (!value || typeof value !== "string") return value
  let res = value
  res = res.replace(/\\/g, "\\\\")
  res = res.replace(/\n/g, "\\n")
  res = res.replace(/\r/g, "\\r")
  res = res.replace(/'/g, "\\'")
  return res
}

/**
 * Quote a value for SQL insertion (handles nested types).
 */
export function quote(value: unknown): string {
  if (value === null || value === undefined) return "NULL"

  // Tuple-like (struct) → array in JS
  if (Array.isArray(value) && (value as unknown[]).length > 0 && isTuple(value)) {
    return "STRUCT(" + (value as unknown[]).map(item => quote(item)).join(",") + ")"
  }

  // Map/dict
  if (value instanceof Map || (typeof value === "object" && !Array.isArray(value) && !(value instanceof Date) && !Buffer.isBuffer(value))) {
    const entries = value instanceof Map ? [...value.entries()] : Object.entries(value as Record<string, unknown>)
    if (entries.length === 0) return "MAP()"
    return "MAP(" + entries.map(([k, v]) => quote(k) + "," + quote(v)).join(",") + ")"
  }

  // Array
  if (Array.isArray(value)) {
    if (value.length === 0) return "ARRAY()"
    return "ARRAY(" + value.map(item => quote(item)).join(",") + ")"
  }

  if (typeof value === "boolean") return value ? "true" : "false"
  if (typeof value === "number" || typeof value === "bigint") return String(value)

  if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
    const hex = Buffer.from(value).toString("ascii")
    return `X'${hex}'`
  }

  if (value instanceof Date) {
    return `TIMESTAMP '${formatDatetime(value)}'`
  }

  if (typeof value === "string") {
    if (value.startsWith("INTERVAL ")) return value
    if (value.startsWith("TIMESTAMP '") || value.startsWith("DATE '")) return value
    if (/^JSON\s*'/i.test(value.trim())) return value.trim()
    return `'${escape(value)}'`
  }

  return `'${escape(String(value))}'`
}

/** Marker to distinguish tuple-like arrays (structs) from regular arrays. */
/**
 * Marker symbol for STRUCT values. In Python, tuple vs list distinguishes
 * STRUCT from ARRAY. In TS, tag an array with this symbol to mark it as STRUCT.
 *
 * Usage: `const s = czStruct(1, "A", 2.0)` → generates `STRUCT(1,'A',2.0)`
 */
const CZ_STRUCT_MARKER = Symbol.for("CzStruct")

export function czStruct(...values: unknown[]): unknown[] {
  const arr = [...values] as unknown[] & { [CZ_STRUCT_MARKER]?: true }
  arr[CZ_STRUCT_MARKER] = true
  return arr
}

function isTuple(value: unknown[]): boolean {
  return (value as unknown as Record<symbol, unknown>)[CZ_STRUCT_MARKER] === true
}

function pad(n: number, w = 2): string {
  return String(n).padStart(w, "0")
}

function formatDatetime(d: Date): string {
  const y = d.getFullYear()
  const mo = pad(d.getMonth() + 1)
  const day = pad(d.getDate())
  const h = pad(d.getHours())
  const mi = pad(d.getMinutes())
  const s = pad(d.getSeconds())
  const ms = d.getMilliseconds()
  if (ms) {
    return `${y}-${mo}-${day} ${h}:${mi}:${s}.${pad(ms * 1000, 6)}`
  }
  return `${y}-${mo}-${day} ${h}:${mi}:${s}`
}

function formatDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/**
 * Converter class — converts JS values to ClickZetta-compatible forms.
 */
export class Converter {
  /**
   * Convert a JS value to its ClickZetta representation for pyformat/format style.
   */
  convertTo(value: unknown): unknown {
    if (value === null || value === undefined) return null
    if (typeof value === "number") return value
    if (typeof value === "bigint") return value
    if (typeof value === "boolean") return value
    if (typeof value === "string") return value
    if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
      return Buffer.from(value).toString("hex").toUpperCase()
    }
    if (value instanceof Date) {
      // Check if it's a date-only (no time component)
      if (value.getHours() === 0 && value.getMinutes() === 0 && value.getSeconds() === 0 && value.getMilliseconds() === 0) {
        return `DATE '${formatDate(value)}'`
      }
      return `TIMESTAMP '${formatDatetime(value)}'`
    }
    return value
  }

  /**
   * Convert a Date to a DATE literal.
   */
  convertDate(value: Date): string {
    return `DATE '${formatDate(value)}'`
  }

  /**
   * Convert a time string (HH:MM:SS or HH:MM:SS.ffffff) to its representation.
   */
  convertTime(hours: number, minutes: number, seconds: number, microseconds = 0): string {
    const base = `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`
    if (microseconds) return `${base}.${pad(microseconds, 6)}`
    return base
  }

  /**
   * Convert a timedelta-like value (total milliseconds) to HH:MM:SS format.
   */
  convertTimedelta(totalMs: number): string {
    const totalSecs = Math.floor(totalMs / 1000)
    const hours = Math.floor(totalSecs / 3600)
    const mins = Math.floor((totalSecs % 3600) / 60)
    const secs = totalSecs % 60
    const us = (totalMs % 1000) * 1000
    if (us) return `${pad(hours)}:${pad(mins)}:${pad(secs)}.${pad(us, 6)}`
    return `${pad(hours)}:${pad(mins)}:${pad(secs)}`
  }

  /**
   * Convert a decimal/number to float representation.
   */
  convertDecimal(value: number | string): number | null {
    if (value != null) return Number(value)
    return null
  }

  /**
   * Process a single parameter: convertTo then quote.
   */
  processSingleParam(value: unknown): string {
    return quote(this.convertTo(value))
  }
}
