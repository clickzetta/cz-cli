import { request, type ClientOptions } from "../client.js"
import type { JobID } from "./types.js"

export async function cancelJob(
  opts: ClientOptions,
  jobId: JobID,
): Promise<unknown> {
  const body = {
    account: { user_id: 0 },
    job_id: {
      id: jobId.id,
      workspace: jobId.workspace,
      instance_id: jobId.instanceId,
    },
    user_agent: "",
    force: false,
  }

  const resp = await request<unknown>(opts, "/lh/cancelJob", body)
  return resp
}
