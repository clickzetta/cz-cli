export function formatJson(data: unknown): string {
  return JSON.stringify(data, jsonReplacer)
}

export function formatPretty(data: unknown): string {
  return JSON.stringify(data, jsonReplacer, 2)
}

/** Replacer matching Python's json.dumps(default=str) behavior */
function jsonReplacer(_key: string, value: unknown): unknown {
  if (typeof value === "bigint") return String(value)
  if (value instanceof Date) return value.toISOString()
  if (value instanceof Buffer || value instanceof Uint8Array) return Buffer.from(value).toString("base64")
  return value
}

export function formatTable(columns: string[], rows: Record<string, unknown>[]): string {
  if (columns.length === 0 || rows.length === 0) {
    return formatPretty({ columns, rows })
  }

  const colWidths: Record<string, number> = {}
  for (const c of columns) {
    colWidths[c] = c.length
  }

  const strRows: Record<string, string>[] = []
  for (const row of rows) {
    const sr: Record<string, string> = {}
    for (const c of columns) {
      const val = row[c]
      const s = val === null || val === undefined ? "" : (typeof val === "object" ? JSON.stringify(val) : String(val))
      sr[c] = s
      colWidths[c] = Math.max(colWidths[c], s.length)
    }
    strRows.push(sr)
  }

  const lines: string[] = []
  lines.push(columns.map((c) => c.padEnd(colWidths[c])).join(" | "))
  lines.push(columns.map((c) => "-".repeat(colWidths[c])).join("-+-"))
  for (const sr of strRows) {
    lines.push(columns.map((c) => (sr[c] ?? "").padEnd(colWidths[c])).join(" | "))
  }

  return lines.join("\n")
}

export function formatTableNoHeader(columns: string[], rows: Record<string, unknown>[]): string {
  if (columns.length === 0 || rows.length === 0) return ""
  const lines: string[] = []
  for (const row of rows) {
    lines.push(columns.map((c) => {
      const val = row[c]
      return val === null || val === undefined ? "" : (typeof val === "object" ? JSON.stringify(val) : String(val))
    }).join("\t"))
  }
  return lines.join("\n")
}

export function formatCsv(columns: string[], rows: Record<string, unknown>[]): string {
  const lines: string[] = []
  lines.push(columns.map(csvEscape).join(","))
  for (const row of rows) {
    lines.push(
      columns
        .map((c) => {
          const val = row[c]
          if (val === null || val === undefined) return ""
          if (typeof val === "object") return csvEscape(JSON.stringify(val))
          return csvEscape(String(val))
        })
        .join(","),
    )
  }
  return lines.join("\n")
}

export function formatCsvNoHeader(columns: string[], rows: Record<string, unknown>[]): string {
  const lines: string[] = []
  for (const row of rows) {
    lines.push(
      columns
        .map((c) => {
          const val = row[c]
          if (val === null || val === undefined) return ""
          if (typeof val === "object") return csvEscape(JSON.stringify(val))
          return csvEscape(String(val))
        })
        .join(","),
    )
  }
  return lines.join("\n")
}

export function formatJsonl(rows: Record<string, unknown>[]): string {
  return rows.map((row) => JSON.stringify(row)).join("\n")
}

export function formatToon(data: unknown): string {
  return serializeToon(data, 0, "")
}

// ---------------------------------------------------------------------------
// TOON serializer — produces the same text format as Python `toons.dumps()`
// ---------------------------------------------------------------------------

/** Serialize any value to TOON text at the given indentation level. */
function serializeToon(value: unknown, indent: number, prefix: string): string {
  if (value === null || value === undefined) return `${prefix}null`
  if (typeof value === "boolean") return `${prefix}${value}`
  if (typeof value === "number" || typeof value === "bigint") return `${prefix}${value}`
  if (typeof value === "string") return `${prefix}${toonQuoteScalar(value)}`
  if (Array.isArray(value)) return serializeToonArray(value, indent, prefix)
  if (typeof value === "object") return serializeToonDict(value as Record<string, unknown>, indent, prefix)
  return `${prefix}${String(value)}`
}

/** Serialize a dict to TOON key: value lines. */
function serializeToonDict(obj: Record<string, unknown>, indent: number, prefix: string): string {
  const entries = Object.entries(obj)
  if (entries.length === 0) return `${prefix}{}`
  const pad = " ".repeat(indent)
  const lines: string[] = []
  for (const [key, val] of entries) {
    lines.push(serializeToonEntry(key, val, indent, pad))
  }
  return prefix + lines.join("\n")
}

/** Serialize a single key: value entry. */
function serializeToonEntry(key: string, val: unknown, indent: number, pad: string): string {
  if (val === null || val === undefined) return `${pad}${key}: null`
  if (typeof val === "boolean") return `${pad}${key}: ${val}`
  if (typeof val === "number" || typeof val === "bigint") return `${pad}${key}: ${val}`
  if (typeof val === "string") return `${pad}${key}: ${toonQuoteScalar(val)}`

  if (Array.isArray(val)) {
    return serializeToonArrayEntry(key, val, indent, pad)
  }

  if (typeof val === "object") {
    // Nested dict
    const nested = serializeToonDict(val as Record<string, unknown>, indent + 2, "")
    return `${pad}${key}:\n${nested}`
  }

  return `${pad}${key}: ${String(val)}`
}

/** Serialize an array value that is a dict entry. */
function serializeToonArrayEntry(key: string, arr: unknown[], indent: number, pad: string): string {
  const n = arr.length
  if (n === 0) return `${pad}${key}[0]:`

  // All scalars?
  if (arr.every(isToonScalar)) {
    const vals = arr.map((v) => toonQuoteCellValue(v))
    return `${pad}${key}[${n}]: ${vals.join(",")}`
  }

  // All uniform records with all-scalar values? → tabular form
  const tabular = tryTabularForm(arr)
  if (tabular !== null) {
    const { cols, rows } = tabular
    const header = `${pad}${key}[${n}]{${cols.join(",")}}:`
    const rowLines = rows.map((row) => `${pad}  ${row.map((v) => toonQuoteCellValue(v)).join(",")}`)
    return `${header}\n${rowLines.join("\n")}`
  }

  // Non-uniform records or mixed → list items
  const childPad = " ".repeat(indent + 2)
  const items: string[] = []
  for (const item of arr) {
    if (item !== null && typeof item === "object" && !Array.isArray(item)) {
      const entries = Object.entries(item as Record<string, unknown>)
      if (entries.length === 0) {
        items.push(`${childPad}- {}`)
      } else {
        const firstLine = `${childPad}- ${serializeToonEntry(entries[0][0], entries[0][1], indent + 4, "").trimStart()}`
        const restLines = entries.slice(1).map(([k, v]) =>
          serializeToonEntry(k, v, indent + 4, childPad + "  ")
        )
        items.push([firstLine, ...restLines].join("\n"))
      }
    } else {
      items.push(`${childPad}- ${serializeToon(item, indent + 4, "")}`)
    }
  }
  return `${pad}${key}[${n}]:\n${items.join("\n")}`
}

/** Serialize a top-level array (no key prefix). */
function serializeToonArray(arr: unknown[], indent: number, prefix: string): string {
  const n = arr.length
  const pad = " ".repeat(indent)
  if (n === 0) return `${prefix}${pad}[0]:`

  // All scalars?
  if (arr.every(isToonScalar)) {
    const vals = arr.map((v) => toonQuoteCellValue(v))
    return `${prefix}${pad}[${n}]: ${vals.join(",")}`
  }

  // Uniform records → tabular
  const tabular = tryTabularForm(arr)
  if (tabular !== null) {
    const { cols, rows } = tabular
    const header = `${pad}[${n}]{${cols.join(",")}}:`
    const rowLines = rows.map((row) => `${pad}  ${row.map((v) => toonQuoteCellValue(v)).join(",")}`)
    return `${prefix}${header}\n${rowLines.join("\n")}`
  }

  // Non-uniform → list items
  const childPad = " ".repeat(indent + 2)
  const items: string[] = []
  for (const item of arr) {
    if (item !== null && typeof item === "object" && !Array.isArray(item)) {
      const entries = Object.entries(item as Record<string, unknown>)
      if (entries.length === 0) {
        items.push(`${childPad}- {}`)
      } else {
        const firstLine = `${childPad}- ${serializeToonEntry(entries[0][0], entries[0][1], indent + 4, "").trimStart()}`
        const restLines = entries.slice(1).map(([k, v]) =>
          serializeToonEntry(k, v, indent + 4, childPad + "  ")
        )
        items.push([firstLine, ...restLines].join("\n"))
      }
    } else {
      items.push(`${childPad}- ${serializeToon(item, indent + 4, "")}`)
    }
  }
  return `${prefix}${pad}[${n}]:\n${items.join("\n")}`
}

/** Check if a value is a TOON scalar (null, bool, number, string). */
function isToonScalar(v: unknown): boolean {
  return v === null || v === undefined || typeof v === "string" || typeof v === "number" || typeof v === "bigint" || typeof v === "boolean"
}

/**
 * Try to represent an array as a tabular form.
 * Returns cols + cell values if all items are uniform dicts with all-scalar values.
 */
function tryTabularForm(arr: unknown[]): { cols: string[]; rows: unknown[][] } | null {
  if (arr.length === 0) return null
  if (!arr.every((item) => item !== null && typeof item === "object" && !Array.isArray(item))) return null

  const records = arr as Record<string, unknown>[]
  const cols = Object.keys(records[0])
  // All records must have the same keys
  for (const r of records) {
    const rk = Object.keys(r)
    if (rk.length !== cols.length || !cols.every((k) => k in r)) return null
  }
  // All values must be scalar
  for (const r of records) {
    for (const k of cols) {
      if (!isToonScalar(r[k])) return null
    }
  }

  const rows = records.map((r) => cols.map((k) => r[k]))
  return { cols, rows }
}

// ---------------------------------------------------------------------------
// TOON quoting rules (matching Python toons library behavior)
// ---------------------------------------------------------------------------

const LOOKS_LIKE_NUMBER = /^-?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/
const LOOKS_LIKE_BOOL = /^(true|false)$/
const LOOKS_LIKE_NULL = /^null$/
const NEEDS_QUOTE_CHARS = /[,:"\\[\]{}\n]/

/** Quote a scalar value for use as a dict value (after `: `). */
function toonQuoteScalar(s: string): string {
  if (s === "") return '""'
  if (LOOKS_LIKE_NUMBER.test(s) || LOOKS_LIKE_BOOL.test(s) || LOOKS_LIKE_NULL.test(s)) {
    return `"${toonEscape(s)}"`
  }
  if (NEEDS_QUOTE_CHARS.test(s)) {
    return `"${toonEscape(s)}"`
  }
  // Strings with leading/trailing whitespace must be quoted
  if (s !== s.trim()) {
    return `"${toonEscape(s)}"`
  }
  return s
}

/** Quote a cell value for use in tabular rows or scalar lists. */
function toonQuoteCellValue(v: unknown): string {
  if (v === null || v === undefined) return "null"
  if (typeof v === "boolean") return String(v)
  if (typeof v === "number" || typeof v === "bigint") return String(v)
  if (typeof v === "string") {
    if (v === "") return '""'
    if (LOOKS_LIKE_NUMBER.test(v) || LOOKS_LIKE_BOOL.test(v) || LOOKS_LIKE_NULL.test(v)) {
      return `"${toonEscape(v)}"`
    }
    if (NEEDS_QUOTE_CHARS.test(v)) {
      return `"${toonEscape(v)}"`
    }
    if (v !== v.trim()) {
      return `"${toonEscape(v)}"`
    }
    return v
  }
  return String(v)
}

/** Escape special characters inside a quoted TOON string. */
function toonEscape(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n").replace(/\t/g, "\\t")
}

function csvEscape(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return '"' + value.replace(/"/g, '""') + '"'
  }
  return value
}

export function formatText(columns: string[], rows: Record<string, unknown>[]): string {
  if (columns.length === 0 || rows.length === 0) return ""
  const lines: string[] = []
  for (const row of rows) {
    lines.push(columns.map((c) => {
      const val = row[c]
      return val === null || val === undefined ? "" : (typeof val === "object" ? JSON.stringify(val) : String(val))
    }).join("\t"))
  }
  return lines.join("\n")
}
