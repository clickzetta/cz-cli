import { request, type ClientOptions } from "../client.js"
import type { JobID } from "./types.js"

export interface SubmitJobParams {
  sql: string
  workspace: string
  schema: string
  vcluster: string
  instanceName: string
  instanceId: number
  jobId: JobID
  hints?: Record<string, string>
  asynchronous?: boolean
  jobTimeoutMs?: number
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
    instanceName,
    instanceId,
    jobId,
    hints = {},
    asynchronous = false,
  } = params

  const hybridPollingTimeout = asynchronous ? 0 : 30

  const body = {
    jobDesc: {
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
      priority: 0,
      priorityString: "NORMAL",
      clientContext: {
        configStatements: [],
        contextJson: JSON.stringify({
          configs: {
            "cz.sql.adhoc.result.type": "embedded",
            "cz.sql.adhoc.default.format": "ARROW",
            "cz.sql.job.result.file.presigned.url.enabled": "true",
            "cz.sql.job.result.file.presigned.url.ttl": "3600",
          },
        }),
      },
    },
  }

  const resp = await request<unknown>(opts, "/lh/submitJob", body)
  return resp
}
