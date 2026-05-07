import { requestRaw, type ClientOptions } from "../client.js"
import { JobStatus, type JobID, type QueryResult, type ColumnSchema } from "./types.js"

const TERMINAL_STATES = new Set(["SUCCEED", "FAILED", "CANCELLED"])

// Polling backoff: start 50ms, multiply by 1.5, cap at 10s,
// then randomize 3-10s once cap is reached.
function nextSleepMs(current: number): number {
  if (current >= 10_000) {
    return 3_000 + Math.random() * 7_000
  }
  return Math.min(current * 1.5, 10_000)
}

interface PollJobResultParams {
  jobTimeoutMs?: number
}

// --- Raw response types matching the actual /lh/getJob JSON ---

interface LhJobStatus {
  state: string
  errorCode?: string
  errorMessage?: string
  message?: string
}

interface LhFieldType {
  category: string
}

interface LhField {
  name: string
  type: LhFieldType
}

interface LhMetadata {
  fields?: LhField[]
  format?: string
  timeZone?: string
}

interface LhResultData {
  data?: string[]
}

interface LhLocation {
  presignedUrls?: string[]
}

interface LhResultSet {
  metadata?: LhMetadata
  data?: LhResultData
  location?: LhLocation
}

interface LhJobResponse {
  status?: LhJobStatus
  resultSet?: LhResultSet
}

// --- TEXT format parsing (mirrors Python connector logic) ---

// Delimiters matching the Python connector's LazySerDeParameters.
// Index 0 = comma is used for column splitting in TEXT format.
const DELIMITERS = [",", ":", "=", "\t"]

/**
 * Split a raw text block into rows, respecting quoted fields.
 * Newline inside quotes does not split.
 */
function splitRows(raw: string): string[] {
  if (!raw) return []
  const rows: string[] = []
  let current: string[] = []
  let inQuotes = false

  for (const ch of raw) {
    if (ch === '"') {
      inQuotes = !inQuotes
    }
    if (ch === "\n" && !inQuotes) {
      rows.push(current.join(""))
      current = []
    } else {
      current.push(ch)
    }
  }
  if (current.length > 0) {
    rows.push(current.join(""))
  }
  return rows
}

/**
 * Split a single row string into column values using the delimiter at
 * the given nesting index. Respects quoted fields.
 */
function splitSingle(row: string, delimiterIndex: number, columnCount: number): (string | null)[] {
  if (!row) return []
  const result: (string | null)[] = []
  let current: string[] = []
  let inQuotes = false
  const delimiter = DELIMITERS[delimiterIndex] ?? ","

  for (const ch of row) {
    if (ch === '"') {
      inQuotes = !inQuotes
    }
    if (ch === delimiter && !inQuotes) {
      result.push(current.join(""))
      current = []
    } else {
      current.push(ch)
    }
  }
  if (current.length > 0) {
    result.push(current.join(""))
  }

  // Pad with nulls if fewer columns than expected
  while (columnCount > 0 && result.length < columnCount) {
    result.push(null)
  }
  return result
}


/**
 * Parse base64-encoded TEXT data chunks into rows of column values.
 * Each element in dataList is a base64-encoded string containing
 * comma-separated values with newline row separators.
 */
function textToRows(dataList: string[], columnCount: number): (string | null)[][] {
  const allRows: string[] = []
  for (const encoded of dataList) {
    const decoded = atob(encoded)
    // Decode as UTF-8 via TextDecoder for proper unicode handling
    const bytes = Uint8Array.from(decoded, (c) => c.charCodeAt(0))
    const text = new TextDecoder("utf-8").decode(bytes)
    allRows.push(...splitRows(text))
  }

  const results: (string | null)[][] = []
  for (const row of allRows) {
    // Skip empty rows when there are multiple columns (matches Python behavior)
    if (columnCount > 1 && !row) continue
    results.push(splitSingle(row, 0, columnCount))
  }
  return results
}

/**
 * Fetch TEXT data from presigned URLs and parse into rows.
 */
async function fetchTextFromUrls(urls: string[], columnCount: number): Promise<(string | null)[][]> {
  const results: (string | null)[][] = []
  for (const url of urls) {
    const resp = await fetch(url)
    if (!resp.ok) {
      throw new Error(`Failed to fetch result data from presigned URL: HTTP ${resp.status}`)
    }
    const text = await resp.text()
    const rows = splitRows(text)
    for (const row of rows) {
      if (columnCount > 1 && !row) continue
      results.push(splitSingle(row, 0, columnCount))
    }
  }
  return results
}

// --- Job status mapping ---

function toJobStatus(state: string): JobStatus {
  switch (state) {
    case "SUBMITTED": return JobStatus.SUBMITTED
    case "RUNNING":
    case "QUEUEING":
    case "SETUP":
    case "RESUMING_CLUSTER":
      return JobStatus.RUNNING
    case "SUCCEEDED":
    case "SUCCEED":
      return JobStatus.SUCCEEDED
    case "FAILED": return JobStatus.FAILED
    case "CANCELLED":
    case "CANCELLING":
      return JobStatus.CANCELLED
    default: return JobStatus.UNKNOWN
  }
}


// --- Type coercion ---

/** Minimal type coercion to match Python connector behavior */
function coerceValue(value: string | null, typeCategory: string): unknown {
  if (value === null || value === undefined) return null
  // TEXT format uses literal "null" for null values
  if (value === "null" || value === "NULL") return null

  const upper = typeCategory.toUpperCase()
  if (upper === "DECIMAL" || upper.startsWith("DECIMAL(")) {
    return value // keep as string for precision
  }
  if (upper === "INT32" || upper === "INT16" || upper === "INT8" || upper === "FLOAT" || upper === "DOUBLE") {
    const n = Number(value)
    return Number.isNaN(n) ? value : n
  }
  if (upper === "INT64" || upper === "BIGINT" || upper === "LONG") {
    const n = Number(value)
    if (Number.isSafeInteger(n)) return n
    return value // keep as string if too large
  }
  if (upper === "BOOLEAN") {
    return value.toLowerCase() === "true"
  }
  if (upper === "MAP" && value) {
    try { return JSON.parse(value) } catch { return value }
  }
  if ((upper.startsWith("ARRAY") || upper === "LIST") && value) {
    try { return JSON.parse(value) } catch { return value }
  }
  if ((upper === "STRUCT" || upper.startsWith("STRUCT<") || upper.startsWith("ROW(")) && value) {
    try { return JSON.parse(value) } catch { return value }
  }
  return value
}

// --- Result parsing ---

function parseResultSet(
  resultSet: LhResultSet | undefined,
): { columns: ColumnSchema[]; rows: Record<string, unknown>[]; isAsync: boolean } {
  if (!resultSet) {
    return { columns: [], rows: [], isAsync: false }
  }

  const metadata = resultSet.metadata
  const fields = metadata?.fields ?? []
  const columns: ColumnSchema[] = fields.map((f) => ({
    name: f.name,
    type: f.type.category,
  }))

  // No data and no location — DDL result
  if (!resultSet.data && !resultSet.location) {
    return {
      columns: [{ name: "message", type: "STRING" }],
      rows: [{ message: "OPERATION SUCCEED" }],
      isAsync: false,
    }
  }

  const columnCount = columns.length

  // Embedded data present
  if (resultSet.data?.data && resultSet.data.data.length > 0) {
    const rawRows = textToRows(resultSet.data.data, columnCount)
    const rows = rawRows.map((rawRow) => {
      const record: Record<string, unknown> = {}
      for (let i = 0; i < columns.length; i++) {
        record[columns[i].name] = coerceValue(rawRow[i] ?? null, columns[i].type)
      }
      return record
    })
    return { columns, rows, isAsync: false }
  }

  // Data in presigned URLs — mark as needing async fetch
  if (resultSet.location?.presignedUrls && resultSet.location.presignedUrls.length > 0) {
    return { columns, rows: [], isAsync: true }
  }

  // Empty result set
  return { columns, rows: [], isAsync: false }
}


/**
 * Parse a raw LH job response (from either submitJob HYBRID or getJob)
 * into a QueryResult. Handles embedded TEXT data and presigned URL fetching.
 */
export async function parseJobResponse(
  raw: LhJobResponse,
  jobId: JobID,
): Promise<QueryResult> {
  const state = raw.status?.state ?? "UNKNOWN"
  const status = toJobStatus(state)

  if (status === JobStatus.FAILED) {
    return {
      jobId: jobId.id,
      status,
      columns: [],
      rows: [],
      rowCount: 0,
      affectedRows: 0,
      errorCode: raw.status?.errorCode || undefined,
      errorMessage: raw.status?.errorMessage || raw.status?.message || undefined,
    }
  }

  const { columns, rows, isAsync } = parseResultSet(raw.resultSet)

  // If data is in presigned URLs, fetch it
  let finalRows = rows
  if (isAsync && raw.resultSet?.location?.presignedUrls) {
    const urls = raw.resultSet.location.presignedUrls
    const rawRows = await fetchTextFromUrls(urls, columns.length)
    finalRows = rawRows.map((rawRow) => {
      const record: Record<string, unknown> = {}
      for (let i = 0; i < columns.length; i++) {
        record[columns[i].name] = coerceValue(rawRow[i] ?? null, columns[i].type)
      }
      return record
    })
  }

  return {
    jobId: jobId.id,
    status,
    columns,
    rows: finalRows,
    rowCount: finalRows.length,
    affectedRows: 0,
    errorCode: raw.status?.errorCode || undefined,
    errorMessage: raw.status?.errorMessage || raw.status?.message || undefined,
  }
}

/**
 * Poll /lh/getJob until the job reaches a terminal state, then parse results.
 */
export async function pollJobResult(
  opts: ClientOptions,
  jobId: JobID,
  params: PollJobResultParams = {},
): Promise<QueryResult> {
  const startTime = Date.now()
  const { jobTimeoutMs } = params

  const requestBody = {
    get_result_request: {
      account: { user_id: 0 },
      job_id: {
        id: jobId.id,
        workspace: jobId.workspace,
        instance_id: jobId.instanceId,
      },
      offset: 0,
      user_agent: "",
    },
    user_agent: "",
  }

  let sleepMs = 50

  while (true) {
    if (jobTimeoutMs !== undefined && Date.now() - startTime > jobTimeoutMs) {
      throw new Error(`Job ${jobId.id} timed out after ${jobTimeoutMs}ms`)
    }

    const raw = await requestRaw<LhJobResponse>(opts, "/lh/getJob", requestBody)
    const state = raw?.status?.state ?? "UNKNOWN"

    if (TERMINAL_STATES.has(state)) {
      return parseJobResponse(raw, jobId)
    }

    await new Promise<void>((resolve) => setTimeout(resolve, sleepMs))
    sleepMs = nextSleepMs(sleepMs)
  }
}
