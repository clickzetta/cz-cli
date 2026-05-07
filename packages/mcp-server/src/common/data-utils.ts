/**
 * data-utils.ts — port of cz_mcp/common/data_utils.py
 *
 * Python → TS mapping:
 *   data_utils.py:35-42   embedding_provider constants  → module constants
 *   data_utils.py:44-57   get_embedding_hf()            → (omitted — requires ML runtime)
 *   data_utils.py:60-61   get_embedding alias           → (omitted)
 *   data_utils.py:63-165  read_data_from_url_or_file_into_dataframe() → readDataFromUrlOrFile()
 *   data_utils.py:168-196 generate_df_schema_sql()      → generateSchemaFromRows()
 *   data_utils.py:198-310 connect_to_database_and_read_data_from_table_into_dataframe()
 *                                                        → (omitted — requires sqlalchemy)
 *   data_utils.py:312-345 insert_dataframe_to_clickzetta() → (omitted — requires sqlalchemy)
 *   data_utils.py:347-352 convert_df_to_dict()          → re-exported from utilities.ts
 *
 * Divergences:
 *   - pandas/numpy/sqlalchemy have no TS equivalents; data is represented as
 *     Array<Record<string, unknown>> throughout.
 *   - readDataFromUrlOrFile() returns raw text/JSON; callers parse as needed.
 *   - Embedding functions are omitted (require ML runtime not available in Node).
 *   - DB connection helpers are omitted (require sqlalchemy).
 */

// data_utils.py:35-42 — embedding config constants (kept for reference)
export const EMBEDDING_PROVIDER = "dashscope"
export const EMBEDDING_MODEL_NAME = "text-embedding-v4"
export const EMBEDDING_DIM = 1024
export const EMBEDDING_MAX_TOKENS = 2048

export type DataRow = Record<string, unknown>

/**
 * data_utils.py:63-165 — read_data_from_url_or_file_into_dataframe()
 *
 * Reads a URL or local file and returns the raw text content.
 * JSON files are parsed into an array of records.
 * CSV files are parsed into an array of records.
 * Other formats return raw text.
 */
export async function readDataFromUrlOrFile(
  source: string,
): Promise<DataRow[] | string> {
  if (!source) {
    throw new Error("源路径为空")
  }

  const trimmed = source.trim()
  const isUrl = /^https?:\/\//.test(trimmed)
  const lower = trimmed.toLowerCase()

  console.info(`开始读取数据源: ${trimmed.slice(0, 100)}...`)

  let rawText: string

  if (isUrl) {
    const resp = await fetch(trimmed)
    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status} fetching ${trimmed}`)
    }
    rawText = await resp.text()
  } else {
    const { readFileSync } = await import("node:fs")
    rawText = readFileSync(trimmed, "utf-8")
  }

  // JSON
  if (lower.endsWith(".json") || lower.endsWith(".jsonl") || lower.endsWith(".ndjson")) {
    try {
      const parsed = JSON.parse(rawText)
      if (Array.isArray(parsed)) return parsed as DataRow[]
      return [parsed as DataRow]
    } catch {
      // Try JSON Lines
      const lines = rawText.split(/\r?\n/).filter((l) => l.trim())
      try {
        return lines.map((l) => JSON.parse(l) as DataRow)
      } catch {
        return rawText
      }
    }
  }

  // CSV / TSV
  if (lower.endsWith(".csv") || lower.endsWith(".tsv") || lower.endsWith(".txt")) {
    const sep = lower.endsWith(".tsv") ? "\t" : ","
    return parseCsv(rawText, sep)
  }

  return rawText
}

/** Minimal CSV parser — handles quoted fields */
function parseCsv(text: string, sep = ","): DataRow[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim())
  if (lines.length === 0) return []

  const headers = splitCsvLine(lines[0]!, sep)
  const rows: DataRow[] = []

  for (let i = 1; i < lines.length; i++) {
    const values = splitCsvLine(lines[i]!, sep)
    const row: DataRow = {}
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]!] = values[j] ?? null
    }
    rows.push(row)
  }

  return rows
}

function splitCsvLine(line: string, sep: string): string[] {
  const result: string[] = []
  let current = ""
  let inQuotes = false

  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"'
        i++
      } else {
        inQuotes = !inQuotes
      }
    } else if (ch === sep && !inQuotes) {
      result.push(current)
      current = ""
    } else {
      current += ch
    }
  }
  result.push(current)
  return result
}

/**
 * data_utils.py:168-196 — generate_df_schema_sql()
 *
 * Infers a SQL schema string from an array of data rows.
 * Returns a comma-separated "col TYPE" string suitable for CREATE TABLE.
 */
export function generateSchemaFromRows(rows: DataRow[]): string {
  if (rows.length === 0) return ""

  const sample = rows[0]!
  const parts: string[] = []

  for (const [colName, value] of Object.entries(sample)) {
    const cleanName = colName.replace(/[\s-]/g, "_")
    let sqlType: string

    if (typeof value === "boolean") {
      sqlType = "BOOLEAN"
    } else if (typeof value === "number") {
      sqlType = Number.isInteger(value) ? "BIGINT" : "DOUBLE"
    } else if (value instanceof Date) {
      sqlType = "TIMESTAMP"
    } else {
      sqlType = "VARCHAR(255)"
    }

    parts.push(`${cleanName} ${sqlType}`)
  }

  return parts.join(", ")
}

// data_utils.py:347-352 — re-export convert_df_to_dict from utilities
export { convertDfToDict } from "./utilities.js"
