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
function columnToArray(vec: Vector<DataType> | null | undefined, typeCategory: string): unknown[] {
  if (!vec) return []
  const out = new Array<unknown>(vec.length)
  for (let i = 0; i < vec.length; i++) {
    out[i] = normaliseArrowValue(vec.get(i), typeCategory)
  }
  return out
}

function normaliseArrowValue(value: unknown, typeCategory: string): unknown {
  if (value == null) return null
  const upper = typeCategory.toUpperCase()

  // Timestamps: apache-arrow returns number (ms epoch) or bigint (ns epoch)
  // for Timestamp types. Convert to ISO 8601 to match the TEXT path.
  if (upper === "TIMESTAMP_LTZ" || upper === "TIMESTAMP" || upper === "TIMESTAMP_NTZ") {
    if (typeof value === "number") return new Date(value).toISOString()
    if (typeof value === "bigint") {
      // ns → ms (lossy for sub-ms precision; Python's as_timezone does the same)
      return new Date(Number(value / 1_000_000n)).toISOString()
    }
    if (value instanceof Date) return value.toISOString()
    return String(value)
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
  if (upper === "DECIMAL" || upper.startsWith("DECIMAL(")) {
    if (typeof value === "bigint") return value.toString()
    return String(value)
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
    columns.push({ name, type })
  }
  return columns
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
): { columns: ColumnSchema[]; rows: Record<string, unknown>[] } {
  if (!base64Chunks || base64Chunks.length === 0) {
    return { columns: metadataColumns, rows: [] }
  }

  let resolvedColumns = metadataColumns
  const allRows: Record<string, unknown>[] = []

  for (const chunk of base64Chunks) {
    const bytes = base64ToBytes(chunk)
    // apache-arrow accepts Uint8Array directly; tableFromIPC reads a full
    // RecordBatchStream and returns a Table.
    const table = tableFromIPC(bytes)
    if (resolvedColumns.length === 0) {
      resolvedColumns = schemaFromArrow(table.schema, metadataColumns)
    }

    // Collect per-column arrays (same as safe_to_py_list in py:30-37).
    const colArrays: unknown[][] = []
    for (let ci = 0; ci < resolvedColumns.length; ci++) {
      const name = table.schema.fields[ci]?.name ?? resolvedColumns[ci]!.name
      const vec = table.getChild(name) as Vector<DataType> | null
      colArrays.push(columnToArray(vec, resolvedColumns[ci]!.type))
    }

    const rowCount = table.numRows
    for (let r = 0; r < rowCount; r++) {
      const record: Record<string, unknown> = {}
      for (let c = 0; c < resolvedColumns.length; c++) {
        record[resolvedColumns[c]!.name] = colArrays[c]![r] ?? null
      }
      allRows.push(record)
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
): Promise<{ columns: ColumnSchema[]; rows: Record<string, unknown>[] }> {
  let resolvedColumns = metadataColumns
  const allRows: Record<string, unknown>[] = []

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
      const name = table.schema.fields[ci]?.name ?? resolvedColumns[ci]!.name
      const vec = table.getChild(name) as Vector<DataType> | null
      colArrays.push(columnToArray(vec, resolvedColumns[ci]!.type))
    }
    for (let r = 0; r < table.numRows; r++) {
      const record: Record<string, unknown> = {}
      for (let c = 0; c < resolvedColumns.length; c++) {
        record[resolvedColumns[c]!.name] = colArrays[c]![r] ?? null
      }
      allRows.push(record)
    }
  }

  return { columns: resolvedColumns, rows: allRows }
}

// Placeholder to satisfy unused-type lints for Data import when the
// bundler tree-shakes the helper branches.
export type { Data }
