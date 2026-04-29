import { resolveConnectionConfig, type CliArgs } from "../connection/config.js"
import {
  getToken,
  toServiceUrl,
  newJobId,
  submitJob,
  pollJobResult,
  type ClientOptions,
  type ConnectionConfig,
  type AuthToken,
  type QueryResult,
  JobStatus,
} from "@clickzetta/sdk"

export interface ExecContext {
  config: ConnectionConfig
  token: AuthToken
  clientOpts: ClientOptions
}

export async function getExecContext(args: Partial<CliArgs>): Promise<ExecContext> {
  const config = resolveConnectionConfig(args)
  const token = await getToken(config)
  const clientOpts: ClientOptions = {
    baseUrl: toServiceUrl(config.service, config.protocol),
    token: token.token,
    customHeaders: config.customHeaders,
  }
  return { config, token, clientOpts }
}

export interface ExecResult {
  jobId: string
  status: "RUNNING"
}

export async function execSql(
  ctx: ExecContext,
  sql: string,
  opts?: {
    hints?: Record<string, string>
    asynchronous?: boolean
    timeoutMs?: number
  },
): Promise<QueryResult | ExecResult> {
  const jobId = newJobId(ctx.config.workspace, ctx.token.instanceId)
  await submitJob(ctx.clientOpts, {
    sql,
    workspace: ctx.config.workspace,
    schema: ctx.config.schema,
    vcluster: ctx.config.vcluster,
    instanceName: ctx.config.instance,
    instanceId: ctx.token.instanceId,
    jobId,
    hints: opts?.hints,
    asynchronous: opts?.asynchronous,
  })
  if (opts?.asynchronous) {
    return { jobId: jobId.id, status: "RUNNING" as const }
  }
  return pollJobResult(ctx.clientOpts, jobId, { jobTimeoutMs: opts?.timeoutMs })
}

export function isQueryResult(r: QueryResult | ExecResult): r is QueryResult {
  return "columns" in r
}

export function throwOnFailure(result: QueryResult, sql: string): void {
  if (result.status === JobStatus.FAILED) {
    throw new SqlError(
      result.errorCode ?? "SQL_ERROR",
      result.errorMessage ?? "Query failed",
      sql,
    )
  }
}

export class SqlError extends Error {
  constructor(
    public code: string,
    message: string,
    public sql: string,
  ) {
    super(message)
    this.name = "SqlError"
  }
}
