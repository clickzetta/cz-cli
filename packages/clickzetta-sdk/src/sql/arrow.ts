/**
 * arrow.ts — Arrow IPC decoding path for ClickZetta result sets.
 *
 * Mirrors cz-connector-python's query_result.py:57-80 (parse_embedded_data):
 *   base64 → Uint8Array → apache-arrow RecordBatchReader → rows
 *
 * The gateway sends base64-encoded Arrow IPC streams when
 * `cz.sql.adhoc.default.format = "ARROW"` (the Python connector default).
 * Each element of `resultSet.data.data` is one IPC message.
 */

import { tableFromIPC, type Schema, type DataType, type Data, type Vector } from "apache-arrow"
import type { ColumnSchema } from "./types.js"
import { normaliseTimestampValue } from "./time.js"

/**
 * Base64 → Uint8Array. Node/Bun provide atob; we decode to bytes without
 * depending on the Buffer global so this file stays isomorphic.
 */
function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

/**
 * query_result.py:40-54 arrow_table_to_rows — convert an Arrow Table's
 * columns into row-major JS values.
 *
 * Special cases preserved from the Python version:
 *  - TIMESTAMP_LTZ/NTZ values receive timezone normalisation if the server
 *    tagged them via the schema. Here we return ISO 8601 strings (matching
 *    the TEXT path's TIMESTAMP_LTZ/NTZ output in poll.ts coerceValue), so
 *    consumers get a consistent shape across formats.
 *  - month_interval / day_time_interval fail in pyarrow (py:34-36); in TS
 *    apache-arrow reads them as bigint or record objects. We surface the
 *    raw value; callers needing a human-readable form can cast in SQL.
 */
function columnToArray(vec: Vector<DataType> | null | undefined, typeCategory: string, timezone?: string): unknown[] {
  if (!vec) return []
  const out = new Array<unknown>(vec.length)
  // For DECIMAL, extract scale from Arrow type metadata
  const scale = typeCategory.toUpperCase().startsWith("DECIMAL") ? ((vec.type as any).scale ?? 0) : 0
  for (let i = 0; i < vec.length; i++) {
    out[i] = normaliseArrowValue(vec.get(i), typeCategory, timezone, scale)
  }
  return out
}

function normaliseArrowValue(value: unknown, typeCategory: string, timezone?: string, decimalScale?: number): unknown {
  if (value == null) return null
  const upper = typeCategory.toUpperCase()

  if (upper === "TIMESTAMP_LTZ" || upper === "TIMESTAMP" || upper === "TIMESTAMP_NTZ") {
    return normaliseTimestampValue(value, upper, timezone)
  }

  // DATE: apache-arrow returns Date object (days since epoch at midnight UTC)
  if (upper === "DATE") {
    if (value instanceof Date) return value.toISOString().slice(0, 10)
    if (typeof value === "number") {
      return new Date(value).toISOString().slice(0, 10)
    }
    return String(value)
  }

  // BINARY / VARBINARY: apache-arrow returns Uint8Array already
  if (upper === "BINARY" || upper === "VARBINARY") {
    if (value instanceof Uint8Array) return value
    return value
  }

  // INT64 / BIGINT: apache-arrow returns BigInt; downgrade to Number when
  // safe, else keep as string (matches poll.ts coerceValue behaviour).
  if (upper === "INT64" || upper === "BIGINT" || upper === "LONG") {
    if (typeof value === "bigint") {
      if (value >= BigInt(Number.MIN_SAFE_INTEGER) && value <= BigInt(Number.MAX_SAFE_INTEGER)) {
        return Number(value)
      }
      return value.toString()
    }
    return value
  }

  // DECIMAL: keep string to preserve precision (same as TEXT path).
  // Arrow stores DECIMAL as scaled integer (bigint or DecimalBigNum); apply scale to restore decimal point.
  if (upper === "DECIMAL" || upper.startsWith("DECIMAL(")) {
    const scale = decimalScale ?? 0
    const raw = typeof value === "bigint" ? value.toString() : String(value)
    if (scale > 0) {
      const negative = raw.startsWith("-")
      const abs = negative ? raw.slice(1) : raw
      const padded = abs.padStart(scale + 1, "0")
      const intPart = padded.slice(0, padded.length - scale)
      const fracPart = padded.slice(padded.length - scale)
      return (negative ? "-" : "") + intPart + "." + fracPart
    }
    return raw
  }

  // MAP / LIST / STRUCT: apache-arrow returns already-parsed JS structures
  // (Map / Array / Object). Pass through.
  return value
}

/**
 * Build the column list from an Arrow Schema, merging with the metadata
 * schema when provided. Mirrors query_result.py:68-73 (dedup by rename).
 */
function schemaFromArrow(arrowSchema: Schema, fallback: ColumnSchema[]): ColumnSchema[] {
  const seen = new Map<string, number>()
  const columns: ColumnSchema[] = []
  for (let i = 0; i < arrowSchema.fields.length; i++) {
    const field = arrowSchema.fields[i]!
    let name = field.name
    if (seen.has(name)) {
      name = `${name}_${i}`
    }
    seen.set(name, i)
    const type = fallback[i]?.type ?? String(field.type)
    columns.push({ name, type, nullable: fallback[i]?.nullable })
  }
  return columns
}

/**
 * Deduplicate column names in-place. Mirrors query_result.py:67-73.
 * First occurrence keeps original name; subsequent duplicates become `name_index`.
 */
export function deduplicateColumns(columns: ColumnSchema[]): ColumnSchema[] {
  const seen = new Map<string, number>()
  const result: ColumnSchema[] = []
  for (let i = 0; i < columns.length; i++) {
    let name = columns[i]!.name
    if (seen.has(name)) {
      name = `${name}_${i}`
    }
    seen.set(name, i)
    result.push({ name, type: columns[i]!.type, nullable: columns[i]!.nullable })
  }
  return result
}

/**
 * Decode a list of base64-encoded Arrow IPC messages (one per element of
 * `resultSet.data.data`) into rows keyed by column name.
 *
 * Mirrors query_result.py:57-80 (parse_embedded_data) for the
 * pure_arrow_decoding=True branch; the pandas branch (py:77-79) is not
 * ported because Node lacks pandas.
 */
export function decodeArrowPayload(
  base64Chunks: string[],
  metadataColumns: ColumnSchema[],
  timezone?: string,
): { columns: ColumnSchema[]; rows: unknown[][] } {
  if (!base64Chunks || base64Chunks.length === 0) {
    return { columns: metadataColumns, rows: [] }
  }

  let resolvedColumns = deduplicateColumns(metadataColumns)
  const allRows: unknown[][] = []

  for (const chunk of base64Chunks) {
    const bytes = base64ToBytes(chunk)
    // apache-arrow accepts Uint8Array directly; tableFromIPC reads a full
    // RecordBatchStream and returns a Table.
    const table = tableFromIPC(bytes)
    if (resolvedColumns.length === 0) {
      resolvedColumns = schemaFromArrow(table.schema, metadataColumns)
    }

    // Collect per-column arrays using positional index (not name) to handle
    // duplicate column names correctly. Mirrors py:40-54 arrow_table_to_rows.
    const colArrays: unknown[][] = []
    for (let ci = 0; ci < resolvedColumns.length; ci++) {
      const vec = table.getChildAt(ci) as Vector<DataType> | null
      colArrays.push(columnToArray(vec, resolvedColumns[ci]!.type, timezone))
    }

    const rowCount = table.numRows
    for (let r = 0; r < rowCount; r++) {
      const row: unknown[] = []
      for (let c = 0; c < resolvedColumns.length; c++) {
        row.push(colArrays[c]![r] ?? null)
      }
      allRows.push(row)
    }
  }

  return { columns: resolvedColumns, rows: allRows }
}

/**
 * Fetch Arrow IPC payloads from presigned URLs and decode them.
 * Mirrors the TEXT fetchTextFromUrls path for the ARROW format.
 */
export async function fetchArrowFromUrls(
  urls: string[],
  metadataColumns: ColumnSchema[],
  timezone?: string,
): Promise<{ columns: ColumnSchema[]; rows: unknown[][] }> {
  let resolvedColumns = deduplicateColumns(metadataColumns)
  const allRows: unknown[][] = []

  for (const url of urls) {
    const resp = await fetch(url)
    if (!resp.ok) {
      throw new Error(`Failed to fetch Arrow payload from presigned URL: HTTP ${resp.status}`)
    }
    const buf = new Uint8Array(await resp.arrayBuffer())
    const table = tableFromIPC(buf)
    if (resolvedColumns.length === 0) {
      resolvedColumns = schemaFromArrow(table.schema, metadataColumns)
    }

    const colArrays: unknown[][] = []
    for (let ci = 0; ci < resolvedColumns.length; ci++) {
      const vec = table.getChildAt(ci) as Vector<DataType> | null
      colArrays.push(columnToArray(vec, resolvedColumns[ci]!.type, timezone))
    }
    for (let r = 0; r < table.numRows; r++) {
      const row: unknown[] = []
      for (let c = 0; c < resolvedColumns.length; c++) {
        row.push(colArrays[c]![r] ?? null)
      }
      allRows.push(row)
    }
  }

  return { columns: resolvedColumns, rows: allRows }
}

// Placeholder to satisfy unused-type lints for Data import when the
// bundler tree-shakes the helper branches.
export type { Data }
