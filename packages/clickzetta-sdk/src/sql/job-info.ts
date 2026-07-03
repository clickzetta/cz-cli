/**
 * job-info.ts — job metadata queries (profile, progress, summary, plan).
 *
 * Python → TS mapping:
 *   client.py:1111-1129  get_job_profile/progress/summary/plan
 *   client.py:1131-1181  _get_job (network layer)
 *   enums.py:99-104      JobRequestType
 */

import { requestRaw, type ClientOptions } from "../client.js"
import type { JobID } from "./types.js"

// enums.py:99-104 — JobRequestType
export const JobRequestType = {
  PLAN: "get_plan_request",
  PROFILE: "get_profile_request",
  RESULT: "get_result_request",
  PROGRESS: "get_progress_request",
  SUMMARY: "get_summary_request",
} as const

export type JobRequestTypeValue = (typeof JobRequestType)[keyof typeof JobRequestType]

/**
 * client.py:1131-1181 _get_job — send a typed job-info request to /lh/getJob.
 * The request body key changes based on `type`; the response is returned raw.
 */
export async function getJobRaw(
  opts: ClientOptions,
  jobId: JobID,
  type: JobRequestTypeValue,
): Promise<unknown> {
  const body: Record<string, unknown> = {
    [type]: {
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
  return requestRaw(opts, "/lh/getJob", body)
}

/** client.py:1111-1113 get_job_profile */
export async function getJobProfile(opts: ClientOptions, jobId: JobID): Promise<unknown> {
  return getJobRaw(opts, jobId, JobRequestType.PROFILE)
}

/** client.py:1115-1117 get_job_result (raw dict, not parsed QueryResult) */
export async function getJobResultRaw(opts: ClientOptions, jobId: JobID): Promise<unknown> {
  return getJobRaw(opts, jobId, JobRequestType.RESULT)
}

/** client.py:1119-1121 get_job_progress */
export async function getJobProgress(opts: ClientOptions, jobId: JobID): Promise<unknown> {
  return getJobRaw(opts, jobId, JobRequestType.PROGRESS)
}

/** client.py:1123-1125 get_job_summary */
export async function getJobSummary(opts: ClientOptions, jobId: JobID): Promise<unknown> {
  return getJobRaw(opts, jobId, JobRequestType.SUMMARY)
}

/** client.py:1127-1129 get_job_plan */
export async function getJobPlan(opts: ClientOptions, jobId: JobID): Promise<unknown> {
  return getJobRaw(opts, jobId, JobRequestType.PLAN)
}
