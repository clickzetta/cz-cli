/**
 * job-info.ts — job metadata queries (profile, progress, summary, plan).
 *
 * Python → TS mapping:
 *   client.py:1111-1129  get_job_profile/progress/summary/plan
 *   client.py:1131-1181  _get_job (network layer)
 *   enums.py:99-104      JobRequestType
 */

import { requestRaw, type ClientOptions } from "../client.js"
import { normalizeServiceEndpoint } from "./submit.js"
import type { JobID } from "./types.js"

// enums.py:99-104 — JobRequestType
export const JobRequestType = {
  PLAN: "getPlanRequest",
  PROFILE: "getProfileRequest",
  RESULT: "getResultRequest",
  PROGRESS: "getProgressRequest",
  SUMMARY: "getSummaryRequest",
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
  const serviceInfo = normalizeServiceEndpoint(opts.config?.service ?? opts.baseUrl)
  const body: Record<string, unknown> = {
    [type]: {
      jobId: {
        id: jobId.id,
        workspace: jobId.workspace,
        instanceId: jobId.instanceId,
      },
      userAgent: "",
      ...(serviceInfo.endpoint ? { jdbcDomain: serviceInfo.endpoint } : {}),
    },
    userAgent: "",
  }
  return requestRaw({
    ...opts,
    customHeaders: {
      ...opts.customHeaders,
      instanceId: String(jobId.instanceId),
    },
  }, "/lh/getJob", body)
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
