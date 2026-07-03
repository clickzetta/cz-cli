const ANSI_BOLD = "\x1b[1m"
const ANSI_RESET = "\x1b[0m"
const ANSI_DIM = "\x1b[2m"

/**
 * Render a markdown string to a human-readable terminal string.
 * Handles: headings, bold, inline code, horizontal rules, and markdown tables.
 * Falls back to plain text for anything else.
 */
export function formatMarkdown(text: string): string {
  const lines = text.split("\n")
  const out: string[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]

    // Heading: ## Foo or ### Foo
    const headingMatch = line.match(/^(#{1,6})\s+(.*)$/)
    if (headingMatch) {
      out.push(ANSI_BOLD + renderInline(headingMatch[2]) + ANSI_RESET)
      i++
      continue
    }

    // Horizontal rule: --- or ===
    if (/^(-{3,}|={3,})$/.test(line.trim())) {
      out.push(ANSI_DIM + "─".repeat(60) + ANSI_RESET)
      i++
      continue
    }

    // Markdown table: collect header + separator + rows
    if (line.trimStart().startsWith("|") && i + 1 < lines.length && /^\s*\|[-| :]+\|\s*$/.test(lines[i + 1])) {
      const tableLines: string[] = [line]
      i += 2 // skip separator
      while (i < lines.length && lines[i].trimStart().startsWith("|")) {
        tableLines.push(lines[i])
        i++
      }
      out.push(renderMarkdownTable(tableLines))
      continue
    }

    out.push(renderInline(line))
    i++
  }
  return out.join("\n")
}

function renderInline(text: string): string {
  // Bold: **text** or __text__
  text = text.replace(/\*\*(.+?)\*\*/g, `${ANSI_BOLD}$1${ANSI_RESET}`)
  text = text.replace(/__(.+?)__/g, `${ANSI_BOLD}$1${ANSI_RESET}`)
  // Inline code: `code`
  text = text.replace(/`([^`]+)`/g, `${ANSI_DIM}$1${ANSI_RESET}`)
  return text
}

function splitTableRow(line: string): string[] {
  return line
    .replace(/^\s*\|/, "")
    .replace(/\|\s*$/, "")
    .split("|")
    .map((c) => c.trim())
}

function renderMarkdownTable(tableLines: string[]): string {
  if (tableLines.length === 0) return ""
  const rows = tableLines.map(splitTableRow)
  const colCount = Math.max(...rows.map((r) => r.length))
  const colWidths: number[] = Array.from({ length: colCount }, () => 0)
  for (const row of rows) {
    for (let c = 0; c < colCount; c++) {
      colWidths[c] = Math.max(colWidths[c], displayWidth(row[c] ?? ""))
    }
  }

  const renderRow = (row: string[], bold: boolean): string => {
    const cells = Array.from({ length: colCount }, (_, c) => {
      const cell = row[c] ?? ""
      const padded = padToWidth(cell, colWidths[c])
      return bold ? `${ANSI_BOLD}${padded}${ANSI_RESET}` : padded
    })
    return "| " + cells.join(" | ") + " |"
  }

  const sep = "|-" + colWidths.map((w) => "-".repeat(w)).join("-+-") + "-|"
  const result: string[] = []
  result.push(renderRow(rows[0], true))
  result.push(sep)
  for (let r = 1; r < rows.length; r++) {
    result.push(renderRow(rows[r], false))
  }
  return result.join("\n")
}

export function formatJson(data: unknown): string {
  return stringifyJson(data)
}

export function formatPretty(data: unknown): string {
  return stringifyJson(data, 2)
}

/** Replacer matching Python's json.dumps(default=str) behavior */
function jsonReplacer(_key: string, value: unknown): unknown {
  if (typeof value === "number" && !Number.isFinite(value)) return String(value)
  if (typeof value === "bigint") return String(value)
  if (value instanceof Date) return value.toISOString()
  if (value instanceof Buffer || value instanceof Uint8Array) return Buffer.from(value).toString("base64")
  return value
}

function stringifyJson(data: unknown, space?: number): string {
  return JSON.stringify(data, jsonReplacer, space)
}

export function formatTable(columns: string[], rows: unknown[][]): string {
  if (columns.length === 0) {
    return formatPretty({ columns, rows })
  }

  const colWidths: number[] = columns.map((c) => displayWidth(c))

  const strRows: string[][] = []
  for (const row of rows) {
    const sr: string[] = []
    for (let i = 0; i < columns.length; i++) {
      const s = formatFlatCell(row[i])
      sr.push(s)
      colWidths[i] = Math.max(colWidths[i], displayWidth(s))
    }
    strRows.push(sr)
  }

  const lines: string[] = []
  lines.push(columns.map((c, i) => padToWidth(c, colWidths[i])).join(" | "))
  lines.push(colWidths.map((w) => "-".repeat(w)).join("-+-"))
  for (const sr of strRows) {
    lines.push(sr.map((s, i) => padToWidth(s, colWidths[i])).join(" | "))
  }

  return lines.join("\n")
}

/**
 * Compute the terminal display width of a string, treating East Asian wide
 * and full-width characters (CJK ideographs, Hangul, kana, etc.) as 2 columns
 * and most others as 1. Control characters contribute 0.
 */
function displayWidth(s: string): number {
  let w = 0
  for (const ch of s) {
    const cp = ch.codePointAt(0)!
    if (cp < 0x20 || (cp >= 0x7F && cp < 0xA0)) continue
    w += isWideCodePoint(cp) ? 2 : 1
  }
  return w
}

function padToWidth(s: string, width: number): string {
  const w = displayWidth(s)
  return w >= width ? s : s + " ".repeat(width - w)
}

function isWideCodePoint(cp: number): boolean {
  return (
    (cp >= 0x1100 && cp <= 0x115F) || // Hangul Jamo
    (cp >= 0x2329 && cp <= 0x232A) || // angle brackets
    (cp >= 0x2E80 && cp <= 0x303E) || // CJK radicals, kangxi, etc.
    (cp >= 0x3041 && cp <= 0x33FF) || // hiragana/katakana/CJK symbols
    (cp >= 0x3400 && cp <= 0x4DBF) || // CJK Extension A
    (cp >= 0x4E00 && cp <= 0x9FFF) || // CJK Unified Ideographs
    (cp >= 0xA000 && cp <= 0xA4CF) || // Yi
    (cp >= 0xAC00 && cp <= 0xD7A3) || // Hangul Syllables
    (cp >= 0xF900 && cp <= 0xFAFF) || // CJK Compatibility Ideographs
    (cp >= 0xFE30 && cp <= 0xFE4F) || // CJK Compatibility Forms
    (cp >= 0xFF00 && cp <= 0xFF60) || // Fullwidth Forms
    (cp >= 0xFFE0 && cp <= 0xFFE6) || // Fullwidth signs
    (cp >= 0x1F300 && cp <= 0x1F9FF) || // Misc symbols & pictographs / emoji
    (cp >= 0x20000 && cp <= 0x2FFFD) || // CJK Ext B-F
    (cp >= 0x30000 && cp <= 0x3FFFD) // CJK Ext G
  )
}

export function formatTableNoHeader(columns: string[], rows: unknown[][]): string {
  if (columns.length === 0 || rows.length === 0) return ""
  const lines: string[] = []
  for (const row of rows) {
    lines.push(row.map(formatFlatCell).join("\t"))
  }
  return lines.join("\n")
}

export function formatCsv(columns: string[], rows: unknown[][]): string {
  const lines: string[] = []
  lines.push(columns.map(csvEscape).join(","))
  for (const row of rows) {
    lines.push(
      row.map(formatCsvCell).join(","),
    )
  }
  return lines.join("\n")
}

export function formatCsvNoHeader(columns: string[], rows: unknown[][]): string {
  const lines: string[] = []
  for (const row of rows) {
    lines.push(
      row.map(formatCsvCell).join(","),
    )
  }
  return lines.join("\n")
}

export function formatJsonl(items: unknown[]): string {
  return items.map((item) => stringifyJson(item)).join("\n")
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
const LOOKS_LIKE_NULL = /^null$/i
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

export function formatText(columns: string[], rows: unknown[][]): string {
  if (columns.length === 0 || rows.length === 0) return ""
  const lines: string[] = []
  for (const row of rows) {
    lines.push(row.map(formatFlatCell).join("\t"))
  }
  return lines.join("\n")
}

function formatFlatCell(value: unknown): string {
  if (value === null || value === undefined) return "NULL"
  if (typeof value === "string") return shouldQuoteFlatString(value) ? stringifyJson(value) : value
  if (typeof value === "object") return stringifyJson(value)
  return String(value)
}

function formatCsvCell(value: unknown): string {
  if (value === null || value === undefined) return "NULL"
  if (typeof value === "string") {
    if (value === "") return '""'
    if (value === "NULL") return '"NULL"'
    return csvEscape(value)
  }
  if (typeof value === "object") return csvEscape(stringifyJson(value))
  return csvEscape(String(value))
}

function shouldQuoteFlatString(value: string): boolean {
  return (
    value === "" ||
    LOOKS_LIKE_NUMBER.test(value) ||
    LOOKS_LIKE_BOOL.test(value) ||
    LOOKS_LIKE_NULL.test(value) ||
    value !== value.trim() ||
    /["\\\t\n\r]/.test(value)
  )
}
