export interface JobID {
  id: string
  workspace: string
  instanceId: number
}

export enum JobStatus {
  SUBMITTED = "SUBMITTED",
  RUNNING = "RUNNING",
  SUCCEEDED = "SUCCEEDED",
  FAILED = "FAILED",
  CANCELLED = "CANCELLED",
  UNKNOWN = "UNKNOWN",
}

export interface ColumnSchema {
  name: string
  type: string
}

export interface QueryResult {
  jobId: string
  status: JobStatus
  columns: ColumnSchema[]
  rows: Record<string, unknown>[]
  rowCount: number
  affectedRows: number
  errorCode?: string
  errorMessage?: string
}

/**
 * client.py:1347-1352 _format_job_id format:
 *   YYYYMMDDHHMMSSffffff + 5-digit random
 * Example: 20240102123456789012 + 98765 → "2024010212345678901298765"
 *
 * The gateway relies on this ID format for routing / log correlation, so we
 * mirror it exactly instead of using an unrelated ID scheme.
 */
function formatJobIdCore(): string {
  const now = new Date()
  const pad = (n: number, w = 2) => String(n).padStart(w, "0")
  const ts =
    now.getFullYear().toString() +
    pad(now.getMonth() + 1) +
    pad(now.getDate()) +
    pad(now.getHours()) +
    pad(now.getMinutes()) +
    pad(now.getSeconds()) +
    pad(now.getMilliseconds(), 3) + "000" // microseconds padded with zeros (ms * 1000)
  const rand = Math.floor(10000 + Math.random() * 90000) // 5-digit [10000,99999]
  return `${ts}${rand}`
}

export function newJobId(workspace: string, instanceId: number): JobID {
  return { id: formatJobIdCore(), workspace, instanceId }
}
