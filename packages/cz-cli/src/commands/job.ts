import type { Argv } from "yargs"
import { commandGroup } from "../command-group.js"
import { mkdir, stat, writeFile } from "node:fs/promises"
import { dirname } from "node:path"
import {
  requestRaw, pollJobResult, cancelJob,
  type ClientOptions, type JobID, type StudioConfig,
  JobStatus,
} from "@clickzetta/sdk"
import type { GlobalArgs } from "../cli.js"
import { success, successRows, error } from "../output/index.js"
import { maskRows } from "../output/masking.js"
import { logOperation } from "../logger.js"
import { getExecContext } from "./exec.js"
import { getStudioContext } from "./studio-context.js"
import { buildJobProfileRows } from "./job-profile.js"

const DEFAULT_FIELD_MAX = 3000
const DEFAULT_ROW_LIMIT = 100
const DEFAULT_RAW_CHAR_LIMIT = 4000

interface TruncateResult {
  rows: unknown[][]
  truncated: { col: string; originalLength: number }[]
}

function truncateLargeFields(rows: unknown[][], columns: string[], maxLen: number, forTable: boolean): TruncateResult {
  const truncated: { col: string; originalLength: number }[] = []
  const seen = new Set<string>()
  for (const row of rows) {
    for (let i = 0; i < row.length; i++) {
      const val = row[i]
      if (typeof val !== "string" || val.length <= maxLen) continue
      const col = columns[i] ?? String(i)
      if (forTable) {
        const suffix = `...(${val.length} chars)`
        row[i] = val.slice(0, maxLen - suffix.length) + suffix
      } else {
        row[i] = val.slice(0, maxLen)
      }
      if (!seen.has(col)) {
        seen.add(col)
        truncated.push({ col, originalLength: val.length })
      }
    }
  }
  return { rows, truncated }
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

async function writeTextFile(filePath: string, data: string): Promise<{ path: string; bytes: number }> {
  await mkdir(dirname(filePath), { recursive: true })
  await writeFile(filePath, data, "utf-8")
  return { path: filePath, bytes: (await stat(filePath)).size }
}

function truncateText(value: string, maxLen: number) {
  if (value.length <= maxLen) return { text: value, truncated: false }
  return {
    text: value.slice(0, maxLen) + `...(truncated, ${value.length} chars)`,
    truncated: true,
  }
}

function debugJobProfile(enabled: boolean | undefined, message: string, data?: Record<string, unknown>) {
  if (!enabled) return
  process.stderr.write(`[debug] job profile: ${message}${data ? ` ${JSON.stringify(data)}` : ""}\n`)
}

function apiError(payload: unknown): { code: string; message: string; requestId?: string } | null {
  const root = payload && typeof payload === "object" && !Array.isArray(payload) ? payload as Record<string, unknown> : {}
  const status = root.respStatus && typeof root.respStatus === "object" && !Array.isArray(root.respStatus)
    ? root.respStatus as Record<string, unknown>
    : {}
  const code = status.errorCode ?? root.errorCode
  if (code === undefined || code === null || String(code).trim() === "") {
    return root.data !== payload ? apiError(root.data) : null
  }
  return {
    code: String(code),
    message: String(status.errorMsg ?? root.errorMsg ?? root.message ?? "Unknown API error"),
    requestId: status.requestId !== undefined ? String(status.requestId) : root.requestId !== undefined ? String(root.requestId) : undefined,
  }
}

function payloadKeys(payload: unknown): string[] {
  return Object.keys(payload && typeof payload === "object" && !Array.isArray(payload) ? payload as Record<string, unknown> : {}).slice(0, 20)
}

async function requestStudioJobJson(
  sc: StudioConfig,
  path: string,
  params: Record<string, string | number | boolean>,
  debug?: boolean,
): Promise<unknown> {
  // new URL(path, base) discards base's path when path starts with "/", so concatenate manually
  const base = sc.baseUrl.endsWith("/") ? sc.baseUrl.slice(0, -1) : sc.baseUrl
  const url = new URL(base + path)
  Object.entries(params).forEach((entry) => url.searchParams.set(entry[0], String(entry[1])))
  const headers = {
    "Content-Type": "application/json",
    "Accept": "application/json, text/plain, */*",
    "X-Clickzetta-Token": sc.token,
    "userId": String(sc.userId),
    "instanceId": String(sc.instanceId),
    "accountId": String(sc.tenantId),
    "tenantId": String(sc.tenantId),
    "instanceName": sc.instanceName,
    "workspaceName": sc.workspaceName,
    "workspaceId": String(sc.workspaceId),
    "projectId": String(sc.projectId),
    ...sc.customHeaders,
  }
  debugJobProfile(debug, "GET", {
    url: url.toString(),
    headers: {
      instanceId: headers.instanceId,
      instanceName: headers.instanceName,
      workspaceName: headers.workspaceName,
      workspaceId: headers.workspaceId,
      projectId: headers.projectId,
      userId: headers.userId,
      tenantId: headers.tenantId,
    },
  })
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(30_000) })
  const text = await response.text()
  debugJobProfile(debug, "response", {
    path,
    status: response.status,
    ok: response.ok,
    bytes: Buffer.byteLength(text, "utf-8"),
  })
  if (!response.ok) {
    debugJobProfile(debug, "http_error", {
      path,
      status: response.status,
      statusText: response.statusText,
      bodyPreview: text.slice(0, 500),
    })
    throw new Error(`HTTP ${response.status} ${response.statusText}: ${text.slice(0, 500)}`)
  }
  const payload = JSON.parse(text) as unknown
  debugJobProfile(debug, "payload", {
    path,
    topLevelKeys: payloadKeys(payload),
    counts: responseCounts(payload),
  })
  const err = apiError(payload)
  if (err) {
    debugJobProfile(debug, "api_error", {
      path,
      code: err.code,
      message: err.message,
      requestId: err.requestId,
    })
    throw new Error(`[${err.code}] ${err.message}${err.requestId ? ` (requestId=${err.requestId})` : ""}`)
  }
  return payload
}

function responseCounts(payload: unknown) {
  const root = payload && typeof payload === "object" && !Array.isArray(payload) ? payload as Record<string, unknown> : {}
  const data = root.data && typeof root.data === "object" && !Array.isArray(root.data) ? root.data as Record<string, unknown> : root
  const plan = data.jobPlan && typeof data.jobPlan === "object" && !Array.isArray(data.jobPlan) ? data.jobPlan as Record<string, unknown> : data
  return {
    dataKeys: Object.keys(data).slice(0, 20),
    stages: Array.isArray(plan.stages) ? plan.stages.length : Array.isArray(data.stages) ? data.stages.length : 0,
    operators: Array.isArray(data.operatorSummaries) ? data.operatorSummaries.length : Array.isArray(data.operators) ? data.operators.length : 0,
  }
}

function jobProfileParams(sc: StudioConfig, jobId: string) {
  return {
    jobId,
    workspaceName: sc.workspaceName,
    instanceId: sc.instanceId,
  }
}

async function fetchJobProfileOnly(
  sc: StudioConfig,
  jobId: string,
  debug?: boolean,
): Promise<unknown> {
  return requestStudioJobJson(
    sc,
    "/clickzetta-lakeconsole/api/v1/vcluster/job/getJobProfile",
    { ...jobProfileParams(sc, jobId), brief: true },
    debug,
  )
}

export function registerJobCommand(cli: Argv<GlobalArgs>): void {
  cli.command("job", "Job performance tools", (yargs) => {
    yargs
      .command(
        "status <job-id>",
        "Check status/summary of a SQL job",
        (y) => y.positional("job-id", { type: "string", demandOption: true, describe: "Job ID" }),
        async (argv) => {
          const format = argv.format
          try {
            const ctx = await getExecContext(argv)
            const jobId: JobID = {
              id: argv["job-id"] as string,
              workspace: ctx.config.workspace,
              instanceId: ctx.token.instanceId,
            }
            const raw = await getJobStatus(ctx.clientOpts, jobId)
            const state = raw.status?.state ?? "UNKNOWN"
            logOperation("job status", { ok: true })
            success({
              job_id: argv["job-id"],
              state,
              error_code: raw.status?.errorCode || undefined,
              error_message: raw.status?.errorMessage || undefined,
            }, {
              format,
              aiMessage: state !== "RUNNING"
                ? `Job ${argv["job-id"]} has finished (state: ${state}). To see the execution plan: cz-cli job profile ${argv["job-id"]}`
                : `Job ${argv["job-id"]} is still RUNNING (this is a point-in-time snapshot). To block until it finishes and fetch the result in one step, use: cz-cli job result ${argv["job-id"]} (waits up to --timeout seconds, default 300). Or take another snapshot anytime with: cz-cli job status ${argv["job-id"]}`,
            })
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
            .option("truncate", { type: "boolean", default: true, describe: "Truncate field values longer than 3000 chars. Use --no-truncate to disable." })
            .option("timeout", { type: "number", default: 300, describe: "Max seconds to wait for job completion. Returns an error if exceeded." }),
        async (argv) => {
          const format = argv.format
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
              return
            }
            if (r.columns.length === 0) {
              logOperation("job result", { ok: true, timeMs: Date.now() - t0 })
              success({ job_id: argv["job-id"], message: "Job completed with no result set." }, { format, timeMs: Date.now() - t0 })
              return
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
            if (argv.truncate !== false) {
              const forTable = argv.format === "table"
              const tr = truncateLargeFields(rows, columns, DEFAULT_FIELD_MAX, forTable)
              rows = tr.rows
              if (tr.truncated.length > 0) {
                const detail = tr.truncated.map((t) => `'${t.col}' (${t.originalLength} chars)`).join(", ")
                const truncMsg = `Field(s) truncated to ${DEFAULT_FIELD_MAX} chars: ${detail}. To get full values, re-run with --no-truncate and redirect to a file, e.g.: cz-cli job result --no-truncate ${argv["job-id"]} > output.json`
                aiMessage = aiMessage ? `${aiMessage} | ${truncMsg}` : truncMsg
              }
            }
            logOperation("job result", { ok: true, rows: rows.length, timeMs: Date.now() - t0 })
            successRows(columns, rows, { format, timeMs: Date.now() - t0, aiMessage })
          } catch (err) {
            logOperation("job result", { ok: false, errorCode: "JOB_RESULT_ERROR" })
            error("JOB_RESULT_ERROR", err instanceof Error ? err.message : String(err), { format })
          }
        },
      )
      .command(
        "profile <job-id>",
        "Show flattened job profile basics",
        (y) =>
          y
            .positional("job-id", { type: "string", demandOption: true, describe: "ClickZetta Job ID (e.g. CZ-xxx)" })
            .option("raw", { type: "boolean", default: false, describe: "Show raw profile content." })
            .option("limit", { type: "boolean", default: true, describe: "Limit raw profile output. Use --no-limit to show the full payload." })
            .option("path", { type: "string", describe: "Write the full raw profile payload to a file." }),
        async (argv) => {
          const format = argv.format
          try {
            const sc = await getStudioContext(argv)
            const jobId = argv["job-id"] as string
            debugJobProfile(argv.debug, "context", {
              jobId,
              baseUrl: sc.baseUrl,
              instanceId: sc.instanceId,
              instanceName: sc.instanceName,
              workspaceName: sc.workspaceName,
              workspaceId: sc.workspaceId,
              projectId: sc.projectId,
              userId: sc.userId,
              tenantId: sc.tenantId,
            })
            const jobProfile = await fetchJobProfileOnly(sc, jobId, argv.debug)
            if (argv.raw) {
              const raw = JSON.stringify(jobProfile, null, 2)
              const truncated = argv.limit === false ? { text: raw, truncated: false } : truncateText(raw, DEFAULT_RAW_CHAR_LIMIT)
              const file = typeof argv.path === "string" && argv.path.trim() !== ""
                ? await writeTextFile(argv.path, raw + "\n")
                : null
              logOperation("job profile", { ok: true })
              success({
                job_id: jobId,
                workspace_name: sc.workspaceName,
                instance_id: sc.instanceId,
                raw: truncated.text,
                truncated: truncated.truncated,
                shown_chars: truncated.text.length,
                total_chars: raw.length,
                limit_chars: argv.limit === false ? null : DEFAULT_RAW_CHAR_LIMIT,
                ...(file ? { path: file.path } : {}),
              }, {
                format,
                aiMessage: truncated.truncated
                  ? `Raw profile truncated to ${DEFAULT_RAW_CHAR_LIMIT} chars from ${raw.length} chars. Use --no-limit to print the full payload, e.g. cz-cli job profile ${jobId} --raw --no-limit > job_profile.raw.json`
                  : undefined,
              })
              return
            }
            logOperation("job profile", { ok: true })
            success(buildJobProfileRows({
              jobId,
              workspaceName: sc.workspaceName,
              instanceId: sc.instanceId,
              currentUserName: sc.userName,
              jobProfile,
            }), { format })
          } catch (err) {
            logOperation("job profile", { ok: false, errorCode: "JOB_PROFILE_ERROR" })
            error("JOB_PROFILE_ERROR", err instanceof Error ? err.message : String(err), { format, debug: argv.debug })
          }
        },
      )
      .command(
        "cancel <job-id>",
        "Cancel a running job",
        (y) => y.positional("job-id", { type: "string", demandOption: true, describe: "Job ID to cancel" }),
        async (argv) => {
          const format = argv.format
          try {
            const ctx = await getExecContext(argv)
            const jobId: JobID = {
              id: argv["job-id"] as string,
              workspace: ctx.config.workspace,
              instanceId: ctx.token.instanceId,
            }
            await cancelJob(ctx.clientOpts, jobId)
            logOperation("job cancel", { ok: true })
            success({ job_id: argv["job-id"], cancelled: true }, {
              format,
              aiMessage: `Cancellation requested for job ${argv["job-id"]}. Verify it stopped with: cz-cli job status ${argv["job-id"]}`,
            })
          } catch (err) {
            logOperation("job cancel", { ok: false, errorCode: "JOB_CANCEL_ERROR" })
            error("JOB_CANCEL_ERROR", err instanceof Error ? err.message : String(err), { format })
          }
        },
      )
      .command(
        "list",
        "Show recent jobs (wraps SHOW JOBS)",
        (y) =>
          y
            .option("limit", { type: "number", default: 20, describe: "Max jobs to return" })
            .option("status", { type: "string", describe: "Filter by status: RUNNING, SUCCEED, FAILED, CANCELLED" }),
        async (argv) => {
          const format = argv.format
          try {
            const { execSqlWithRetry, isQueryResult } = await import("./exec.js")
            const ctx = await getExecContext(argv)
            const limit = typeof argv.limit === "number" ? argv.limit : 0
            const sql = limit > 0 ? `SHOW JOBS LIMIT ${limit}` : "SHOW JOBS"
            const r = await execSqlWithRetry(ctx, sql, { timeoutMs: 30_000 })
            if (!isQueryResult(r)) { error("JOB_LIST_ERROR", "Unexpected async response", { format }); return }
            if (r.status === JobStatus.FAILED) {
              error(r.errorCode ?? "JOB_LIST_ERROR", r.errorMessage ?? "SHOW JOBS failed", { format })
              return
            }
            let rows = r.rows
            const columns = r.columns.map((c) => c.name)
            if (argv.status) {
              const statusIdx = columns.indexOf("status")
              if (statusIdx >= 0) rows = rows.filter((row) => String(row[statusIdx]).toUpperCase() === argv.status!.toUpperCase())
            }
            logOperation("job list", { ok: true, rows: rows.length })
            successRows(columns, rows, {
              format,
              aiMessage: limit > 0 && rows.length >= limit
                ? `Showing ${limit} jobs. For more results increase --limit or use --no-limit. For complex filtering or large-scale analysis (>10,000 jobs), query INFORMATION_SCHEMA.JOBS directly: cz-cli sql "SELECT * FROM INFORMATION_SCHEMA.JOBS WHERE ..."`
                : undefined,
            })
          } catch (err) {
            logOperation("job list", { ok: false, errorCode: "JOB_LIST_ERROR" })
            error("JOB_LIST_ERROR", err instanceof Error ? err.message : String(err), { format })
          }
        },
      )
    return commandGroup(yargs, "job")
  })
}
