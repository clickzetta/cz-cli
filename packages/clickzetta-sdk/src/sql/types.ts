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

export function newJobId(workspace: string, instanceId: number): JobID {
  const hex = Array.from(crypto.getRandomValues(new Uint8Array(6)))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
  return { id: `tssdk-${hex}`, workspace, instanceId }
}
