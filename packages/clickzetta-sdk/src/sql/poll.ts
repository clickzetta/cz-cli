import { request, type ClientOptions } from "../client.js"
import { JobStatus, type JobID, type QueryResult, type ColumnSchema } from "./types.js"

const TERMINAL_STATES = new Set(["SUCCEEDED", "FAILED", "CANCELLED"])

// Polling sleep: start 50ms, multiply by 1.5 each time, cap at 10s,
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

interface RawJobStatus {
  state: string
  errorCode?: string
  errorMessage?: string
}

interface RawColumnType {
  type: string
}

interface RawColumn {
  name: string
  type: RawColumnType | string
}

interface RawJobResponse {
  status?: RawJobStatus
  schema?: RawColumn[]
  data?: unknown[][]
  location?: unknown
}

function toJobStatus(state: string): JobStatus {
  switch (state) {
    case "SUBMITTED": return JobStatus.SUBMITTED
    case "RUNNING": return JobStatus.RUNNING
    case "SUCCEEDED": return JobStatus.SUCCEEDED
    case "FAILED": return JobStatus.FAILED
    case "CANCELLED": return JobStatus.CANCELLED
    default: return JobStatus.UNKNOWN
  }
}

function parseColumns(schema: RawColumn[]): ColumnSchema[] {
  return schema.map((col) => ({
    name: col.name,
    type: typeof col.type === "object" ? col.type.type : col.type,
  }))
}

function parseRows(
  columns: ColumnSchema[],
  data: unknown[][],
): Record<string, unknown>[] {
  return data.map((row) => {
    const record: Record<string, unknown> = {}
    for (let i = 0; i < columns.length; i++) {
      record[columns[i].name] = row[i]
    }
    return record
  })
}

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

    const resp = await request<RawJobResponse>(opts, "/lh/getJob", requestBody)
    const raw = resp.data as RawJobResponse

    const state = raw?.status?.state ?? "UNKNOWN"

    if (TERMINAL_STATES.has(state)) {
      const status = toJobStatus(state)
      const columns = raw.schema ? parseColumns(raw.schema) : []
      const rows = raw.data ? parseRows(columns, raw.data) : []

      return {
        jobId: jobId.id,
        status,
        columns,
        rows,
        rowCount: rows.length,
        affectedRows: 0,
        errorCode: raw.status?.errorCode || undefined,
        errorMessage: raw.status?.errorMessage || undefined,
      }
    }

    await new Promise<void>((resolve) => setTimeout(resolve, sleepMs))
    sleepMs = nextSleepMs(sleepMs)
  }
}
