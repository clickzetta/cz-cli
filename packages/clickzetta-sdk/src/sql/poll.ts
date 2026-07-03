import { requestRaw, type ClientOptions } from "../client.js"
import { JobStatus, type JobID, type QueryResult, type ColumnSchema } from "./types.js"
import {
  isFatalErrorCode,
  isRetryableErrorCode,
  isRetryableMessage,
  shouldResubmitWithNewJobId,
} from "./errors.js"
import { toClickZettaError, OperationalError } from "../types/errors.js"
import { decodeArrowPayload, deduplicateColumns, fetchArrowFromUrls } from "./arrow.js"
import { normaliseTimestampText, resolveResultTimezone } from "./time.js"

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
  /** utils.py:278-300 as_timezone — timezone for TIMESTAMP_LTZ conversion */
  timezone?: string
  /** Max polling iterations before giving up (default unlimited, matches Python max_tries=-1). Use jobTimeoutMs for time-based limits. */
  maxRetries?: number
  /** Called when CZLH-57015/60015 requires resubmit with new job ID. Returns the new poll result. */
  resubmitFn?: () => Promise<QueryResult>
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
  nullable?: boolean
  decimalTypeInfo?: { precision?: string; scale?: string }
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

/**
 * Decode an even-length hex string into a Uint8Array.
 * Invalid characters or odd length fall through to an empty array.
 * @internal exported for unit tests.
 */
export function hexToBytes(hex: string): Uint8Array {
  const clean = hex.trim()
  if (!clean || clean.length % 2 !== 0) return new Uint8Array()
  const out = new Uint8Array(clean.length / 2)
  for (let i = 0; i < out.length; i++) {
    const byte = Number.parseInt(clean.substr(i * 2, 2), 16)
    if (Number.isNaN(byte)) return new Uint8Array()
    out[i] = byte
  }
  return out
}

/**
 * Minimal type coercion to match Python connector behavior.
 * @param timezone Optional timezone hint (from SqlSession.timezoneHint) used
 *   to convert TIMESTAMP_LTZ values, mirroring utils.py:278-300 as_timezone.
 * @internal exported for unit tests.
 */
export function coerceValue(value: string | null, typeCategory: string, timezone?: string): unknown {
  if (value === null || value === undefined) return null
  // TEXT format uses literal "null" for null values
  if (value === "null" || value === "NULL") return null

  const upper = typeCategory.toUpperCase()

  // Numeric
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

  // Temporal types
  // DATE: TEXT format is already "YYYY-MM-DD", return as ISO string.
  if (upper === "DATE") {
    return value.trim()
  }
  // TIMESTAMP_LTZ / TIMESTAMP (alias for LTZ): normalise space → "T",
  // then apply timezone if provided (utils.py:278-300 as_timezone).
  if (upper === "TIMESTAMP_LTZ" || upper === "TIMESTAMP") {
    return normaliseTimestampText(value, upper, timezone)
  }
  // TIMESTAMP_NTZ: wall-clock, no timezone conversion (utils.py:281-282).
  if (upper === "TIMESTAMP_NTZ") {
    return normaliseTimestampText(value, upper)
  }

  // Binary
  if (upper === "BINARY" || upper === "VARBINARY") {
    return hexToBytes(value)
  }

  // JSON
  if (upper === "JSON") {
    try { return JSON.parse(value) } catch { return value }
  }

  // Complex containers (JSON-encoded strings in TEXT format)
  if (upper === "MAP" && value) {
    try { return JSON.parse(value) } catch { return value }
  }
  if ((upper.startsWith("ARRAY") || upper === "LIST") && value) {
    try { return JSON.parse(value) } catch { return value }
  }
  if ((upper === "STRUCT" || upper.startsWith("STRUCT<") || upper.startsWith("ROW(")) && value) {
    try { return JSON.parse(value) } catch { return value }
  }

  // String-like: CHAR / CHAR(n) / VARCHAR / VARCHAR(n) / STRING
  if (upper.startsWith("CHAR") || upper.startsWith("VARCHAR") || upper === "STRING") {
    return value
  }

  // Pass-through types: intervals, vector, bitmap, void.
  if (
    upper.startsWith("INTERVAL_YEAR_MONTH") ||
    upper.startsWith("INTERVAL_DAY_TIME") ||
    upper.startsWith("VECTOR") ||
    upper.startsWith("BITMAP") ||
    upper === "VOID"
  ) {
    return value
  }

  return value
}

// --- Result parsing ---

function parseResultSet(
  resultSet: LhResultSet | undefined,
  timezone?: string,
): { columns: ColumnSchema[]; rows: unknown[][]; isAsync: boolean; timeZone?: string; format: string } {
  if (!resultSet) {
    return { columns: [], rows: [], isAsync: false, format: "ARROW" }
  }

  const metadata = resultSet.metadata
  const timeZone = resolveResultTimezone(metadata?.timeZone, timezone)
  const fields = metadata?.fields ?? []
  const columns: ColumnSchema[] = fields.map((f) => {
    let type = f.type.category
    if (type === "DECIMAL" && f.type.decimalTypeInfo) {
      const p = f.type.decimalTypeInfo.precision ?? "38"
      const s = f.type.decimalTypeInfo.scale ?? "0"
      type = `DECIMAL(${p},${s})`
    }
    return { name: f.name, type, nullable: f.type.nullable ?? true }
  })

  // No data and no location — DDL result
  if (!resultSet.data && !resultSet.location) {
    return { columns: [], rows: [], isAsync: false, timeZone, format: "ARROW" }
  }

  const columnCount = columns.length
  // query_result.py:297 — default ARROW when the server omits the tag.
  const format = (metadata?.format ?? "ARROW").toUpperCase()

  // Embedded data present
  if (resultSet.data?.data && resultSet.data.data.length > 0) {
    if (format === "ARROW") {
      // query_result.py:249-258 — Arrow IPC branch.
      const { columns: arrowCols, rows } = decodeArrowPayload(resultSet.data.data, columns, timeZone)
      return { columns: arrowCols, rows, isAsync: false, timeZone, format }
    }
    // query_result.py:260-269 — TEXT branch.
    const rawRows = textToRows(resultSet.data.data, columnCount)
    const dedupedColumns = deduplicateColumns(columns)
    const rows = rawRows.map((rawRow) => {
      const row: unknown[] = []
      for (let i = 0; i < dedupedColumns.length; i++) {
        row.push(coerceValue(rawRow[i] ?? null, dedupedColumns[i].type, timeZone))
      }
      return row
    })
    return { columns: dedupedColumns, rows, isAsync: false, timeZone, format }
  }

  // Data in presigned URLs — mark as needing async fetch
  if (resultSet.location?.presignedUrls && resultSet.location.presignedUrls.length > 0) {
    return { columns, rows: [], isAsync: true, timeZone, format }
  }

  // Empty result set
  return { columns, rows: [], isAsync: false, timeZone, format }
}


/**
 * Parse a raw LH job response (from either submitJob HYBRID or getJob)
 * into a QueryResult. Handles embedded TEXT data and presigned URL fetching.
 */
export async function parseJobResponse(
  raw: LhJobResponse,
  jobId: JobID,
  timezone?: string,
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
      errorCode: raw.status?.errorCode || undefined,
      errorMessage: raw.status?.errorMessage || raw.status?.message || undefined,
    }
  }

  const { columns, rows, isAsync, timeZone, format } = parseResultSet(raw.resultSet, timezone)

  // If data is in presigned URLs, fetch it. The format on disk follows the
  // same `metadata.format` as embedded data (query_result.py:297,371,387).
  let finalCols = columns
  let finalRows = rows
  if (isAsync && raw.resultSet?.location?.presignedUrls) {
    const urls = raw.resultSet.location.presignedUrls
    if (format === "ARROW") {
      const decoded = await fetchArrowFromUrls(urls, columns, timeZone)
      finalCols = decoded.columns
      finalRows = decoded.rows
    } else {
      const rawRows = await fetchTextFromUrls(urls, columns.length)
      finalRows = rawRows.map((rawRow) => {
        const row: unknown[] = []
        for (let i = 0; i < columns.length; i++) {
          row.push(coerceValue(rawRow[i] ?? null, columns[i].type, timeZone))
        }
        return row
      })
    }
  }

  return {
    jobId: jobId.id,
    status,
    columns: finalCols,
    rows: finalRows,
    rowCount: finalRows.length,
    timeZone,
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
  const { jobTimeoutMs, timezone, maxRetries = Infinity, resubmitFn } = params

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
  const NO_PERMISSION_MAX_TRIES = 5
  let noPermissionTries = 0
  let retryCount = 0

  while (true) {
    if (maxRetries > 0 && retryCount >= maxRetries) {
      throw new OperationalError(`Job ${jobId.id} exceeded max retries (${maxRetries})`, { jobId: jobId.id })
    }

    if (jobTimeoutMs !== undefined && Date.now() - startTime > jobTimeoutMs) {
      try {
        const { cancelJob } = await import("./cancel.js")
        await cancelJob(opts, jobId)
      } catch { /* best-effort cancel */ }
      throw new OperationalError(`Job ${jobId.id} timed out after ${jobTimeoutMs}ms`, { jobId: jobId.id })
    }

    const raw = await requestRaw<LhJobResponse>(opts, "/lh/getJob", requestBody)
    const state = raw?.status?.state ?? "UNKNOWN"
    const errorCode = raw?.status?.errorCode || undefined
    const errorMessage = raw?.status?.errorMessage || raw?.status?.message || undefined

    if (isFatalErrorCode(errorCode)) {
      throw toClickZettaError({
        errorCode,
        message: errorMessage ?? `Job ${jobId.id} failed with ${errorCode}`,
        jobId: jobId.id,
      })
    }

    // CZLH-57015 (JOB_NEEDS_RERUN) / CZLH-60015 (VC_QUEUE_LIMIT) →
    // resubmit with a new job ID (Python: execute_with_retrying)
    if (shouldResubmitWithNewJobId(errorCode)) {
      if (resubmitFn) {
        retryCount++
        return resubmitFn()
      }
      // No resubmit function provided — fall through to retry polling
    }

    // Other retryable lh_codes (60007 / 60022 / 60023) → keep polling same job
    if (isRetryableErrorCode(errorCode)) {
      retryCount++
      await new Promise<void>((resolve) => setTimeout(resolve, sleepMs))
      sleepMs = nextSleepMs(sleepMs)
      continue
    }

    if (!errorCode && isRetryableMessage(errorMessage)) {
      const isNoPerm =
        !!errorMessage &&
        errorMessage.includes("NoPermission: User ") &&
        errorMessage.endsWith(" is not found")
      if (isNoPerm) {
        noPermissionTries++
        if (noPermissionTries >= NO_PERMISSION_MAX_TRIES) {
          throw toClickZettaError({
            message: errorMessage ?? `Job ${jobId.id} permission check failed`,
            jobId: jobId.id,
          })
        }
      }
      retryCount++
      await new Promise<void>((resolve) => setTimeout(resolve, sleepMs))
      sleepMs = nextSleepMs(sleepMs)
      continue
    }

    const hasEmbeddedData = (raw?.resultSet?.data?.data?.length ?? 0) > 0
    const hasLocation = raw?.resultSet?.location != null
    if (!TERMINAL_STATES.has(state) && (hasEmbeddedData || hasLocation)) {
      return parseJobResponse(raw, jobId, timezone)
    }

    if (TERMINAL_STATES.has(state)) {
      return parseJobResponse(raw, jobId, timezone)
    }

    retryCount++
    await new Promise<void>((resolve) => setTimeout(resolve, sleepMs))
    sleepMs = nextSleepMs(sleepMs)
  }
}
