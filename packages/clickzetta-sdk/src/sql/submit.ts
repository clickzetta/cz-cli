import { requestRaw, type ClientOptions } from "../client.js"
import type { JobID } from "./types.js"

export interface SubmitJobParams {
  sql: string
  workspace: string
  schema: string
  vcluster: string
  instanceName: string
  instanceId: number
  jobId: JobID
  /**
   * SQL hints forwarded as `sqlJob.sqlConfig.hint`. The Python connector
   * passes the merged `connect_context.configs` dict here
   * (client.py:645 `SQLJobConfig(0, "0", "0", self.connect_context.configs)`),
   * so callers should pass the final session configs map.
   */
  hints?: Record<string, string>
  asynchronous?: boolean
  /**
   * Maps to `JobDesc.jobTimeoutMs` (enums.py:350-351). Only emitted when > 0.
   * Unit: milliseconds.
   */
  jobTimeoutMs?: number
  /**
   * Maps to `JobDesc.hybridPollingTimeout` (enums.py:341). When omitted,
   * defaults to 0 for asynchronous submits and 30 for synchronous.
   * The SqlSession layer applies the DEFAULT_MAXIMUM_TIMEOUT=60 clamp
   * before calling submitJob (client.py:641-644).
   */
  pollingTimeout?: number
  /**
   * Maps to `JobDesc.priority` (enums.py:344). Defaults to 0. priorityString
   * is always "NORMAL" (client.py:674).
   */
  priority?: number
  /**
   * Maps to `clientContext.configStatements` (enums.py:173). SET/USE
   * statements the session accumulated via `process_use_cmd`
   * (client.py:541, 556). Defaults to [].
   */
  configStatements?: string[]
  /**
   * Overrides the `clientContext.contextJson` payload. When present, the
   * value is serialized with JSON.stringify. When omitted, a minimal
   * legacy payload with just `configs` is emitted for backwards
   * compatibility with callers that don't run through SqlSession.
   */
  contextJson?: Record<string, unknown>
}

export async function submitJob(
  opts: ClientOptions,
  params: SubmitJobParams,
): Promise<unknown> {
  const {
    sql,
    workspace,
    schema,
    vcluster,
    instanceName: _instanceName,
    instanceId,
    jobId,
    hints = {},
    asynchronous = false,
    jobTimeoutMs,
    pollingTimeout,
    priority = 0,
    configStatements = [],
    contextJson,
  } = params

  const hybridPollingTimeout =
    pollingTimeout !== undefined ? pollingTimeout : asynchronous ? 0 : 30

  const jobDesc: Record<string, unknown> = {
    virtualCluster: vcluster,
    type: "SQL_JOB",
    jobId: {
      id: jobId.id,
      workspace: jobId.workspace,
      instance_id: instanceId,
    },
    jobName: "SQL_JOB",
    requestMode: "HYBRID",
    hybridPollingTimeout,
    jobConfig: {},
    sqlJob: {
      query: [sql],
      defaultNamespace: [workspace, schema],
      sqlConfig: {
        timeout: 0,
        adhocSizeLimit: "0",
        adhocRowLimit: "0",
        hint: hints,
      },
    },
    priority,
    priorityString: "NORMAL",
    clientContext: {
      configStatements,
      contextJson: contextJson
        ? JSON.stringify(contextJson)
        : JSON.stringify({
            workspace,
            schema,
            vc: vcluster,
            configs: {
              "cz.sql.adhoc.result.type": "embedded",
              "cz.sql.adhoc.default.format": "ARROW",
              "cz.sql.job.result.file.presigned.url.enabled": "true",
              "cz.sql.job.result.file.presigned.url.ttl": "3600",
            },
          }),
    },
  }

  // enums.py:348-349 — when hint has "query_tag", surface it on JobDesc.
  if (Object.prototype.hasOwnProperty.call(hints, "query_tag")) {
    jobDesc.query_tag = hints.query_tag
  }
  // enums.py:350-351 — only emit jobTimeoutMs when > 0.
  if (jobTimeoutMs !== undefined && jobTimeoutMs > 0) {
    jobDesc.jobTimeoutMs = jobTimeoutMs
  }

  const body = { jobDesc }

  const resp = await requestRaw(opts, "/lh/submitJob", body)
  return resp
}
