import type { Argv } from "yargs"
import { commandGroup } from "../command-group.js"
import {
  requestRaw, pollJobResult,
  type ClientOptions, type JobID, type QueryResult,
  JobStatus,
} from "@clickzetta/sdk"
import type { GlobalArgs } from "../cli.js"
import { success, successRows, error } from "../output/index.js"
import { maskRows } from "../output/masking.js"
import { logOperation } from "../logger.js"
import { getExecContext, isQueryResult } from "./exec.js"

const DEFAULT_FIELD_MAX = 3000
const DEFAULT_ROW_LIMIT = 100

function truncateLargeFields(rows: unknown[][], maxLen: number): unknown[][] {
  for (const row of rows) {
    for (let i = 0; i < row.length; i++) {
      const val = row[i]
      if (typeof val === "string" && val.length > maxLen) {
        row[i] = val.slice(0, maxLen) + `...(truncated, ${val.length} chars)`
      }
    }
  }
  return rows
}

interface RawJobStatus {
  state: string
  errorCode?: string
  errorMessage?: string
}

interface RawJobResponse {
  status?: RawJobStatus
  schema?: unknown[]
  data?: unknown[][]
}

async function getJobStatus(opts: ClientOptions, jobId: JobID): Promise<RawJobResponse> {
  const body = {
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
  return requestRaw<RawJobResponse>(opts, "/lh/getJob", body)
}

export function registerJobCommand(cli: Argv<GlobalArgs>): void {
  cli.command("job", "Job performance tools", (yargs) => {
    yargs
      .command(
        "status <job-id>",
        "Check status/summary of a SQL job",
        (y) => y.positional("job-id", { type: "string", demandOption: true, describe: "Job ID" }),
        async (argv) => {
          const format = argv.output
          try {
            const ctx = await getExecContext(argv)
            const jobId: JobID = {
              id: argv["job-id"] as string,
              workspace: ctx.config.workspace,
              instanceId: ctx.token.instanceId,
            }
            const raw = await getJobStatus(ctx.clientOpts, jobId)
            logOperation("job status", { ok: true })
            success({
              job_id: argv["job-id"],
              state: raw.status?.state ?? "UNKNOWN",
              error_code: raw.status?.errorCode || undefined,
              error_message: raw.status?.errorMessage || undefined,
            }, { format })
          } catch (err) {
            logOperation("job status", { ok: false, errorCode: "JOB_STATUS_ERROR" })
            error("JOB_STATUS_ERROR", err instanceof Error ? err.message : String(err), { format })
          }
        },
      )
      .command(
        "result <job-id>",
        "Fetch result set of a SQL job (waits if still running)",
        (y) =>
          y
            .positional("job-id", { type: "string", demandOption: true, describe: "Job ID" })
            .option("limit", { type: "boolean", default: true, describe: "Limit results to 100 rows. Use --no-limit to fetch all rows." })
            .option("timeout", { type: "number", default: 300, describe: "Max seconds to wait for job completion. Returns an error if exceeded." }),
        async (argv) => {
          const format = argv.output
          try {
            const ctx = await getExecContext(argv)
            const jobId: JobID = {
              id: argv["job-id"] as string,
              workspace: ctx.config.workspace,
              instanceId: ctx.token.instanceId,
            }
            const t0 = Date.now()
            const timeoutMs = (argv.timeout as number) * 1000
            const r = await pollJobResult(ctx.clientOpts, jobId, { jobTimeoutMs: timeoutMs })
            if (r.status === JobStatus.FAILED) {
              logOperation("job result", { ok: false, errorCode: r.errorCode })
              error(r.errorCode ?? "JOB_RESULT_ERROR", r.errorMessage ?? "Job failed", { format })
            }
            if (r.columns.length === 0) {
              logOperation("job result", { ok: true, timeMs: Date.now() - t0 })
              success({ job_id: argv["job-id"], message: "Job completed with no result set." }, { format, timeMs: Date.now() - t0 })
            }
            const rowLimit = !argv.limit ? Infinity : DEFAULT_ROW_LIMIT
            let rows = r.rows
            let aiMessage: string | undefined
            if (rows.length > rowLimit) {
              rows = rows.slice(0, rowLimit)
              aiMessage = `Results truncated to ${rowLimit} rows. Use --no-limit to fetch all: cz-cli job result --no-limit ${argv["job-id"]}`
            }
            const columns = r.columns.map((c) => c.name)
            rows = maskRows(columns, rows)
            rows = truncateLargeFields(rows, DEFAULT_FIELD_MAX)
            logOperation("job result", { ok: true, rows: rows.length, timeMs: Date.now() - t0 })
            successRows(columns, rows, { format, timeMs: Date.now() - t0, aiMessage })
          } catch (err) {
            logOperation("job result", { ok: false, errorCode: "JOB_RESULT_ERROR" })
            error("JOB_RESULT_ERROR", err instanceof Error ? err.message : String(err), { format })
          }
        },
      )
    return commandGroup(yargs, "job")
  })
}
