import { requestRaw, type ClientOptions } from "../client.js"
import { ClickZettaApiError } from "../types/api.js"
import { abortAfter, delay } from "../abort.js"
import { isRetryableErrorCode } from "./errors.js"
import { getJobResultRaw } from "./job-info.js"
import type { JobID } from "./types.js"

export async function cancelJob(opts: ClientOptions, jobId: JobID): Promise<unknown> {
  const response = await requestRaw<unknown>(opts, "/lh/cancelJob", {
    account: { user_id: 0 },
    job_id: { id: jobId.id, workspace: jobId.workspace, instance_id: jobId.instanceId },
    user_agent: "",
    force: false,
  })
  // Coordinator protobuf JSON uses respStatus; some gateways preserve snake_case.
  // Proto3 omits empty fields individually, so an absent status (alone or beside
  // other fields) is success; only a populated error status rejects.
  if (!response || typeof response !== "object" || Array.isArray(response)) {
    throw new ClickZettaApiError("INVALID_CANCEL_RESPONSE", "Invalid cancellation response")
  }
  const raw = response as Record<string, unknown>
  const value = raw.respStatus ?? raw.resp_status
  if (value !== undefined && (!value || typeof value !== "object" || Array.isArray(value))) {
    throw new ClickZettaApiError("INVALID_CANCEL_RESPONSE", "Invalid cancellation status")
  }
  const status = value as Record<string, unknown> | undefined
  const code = status?.errorCode ?? status?.error_code
  const message = status?.errorMsg ?? status?.error_msg
  if (code || message) throw new ClickZettaApiError(String(code || "CANCEL_FAILED"), String(message || code))
  if (raw.code !== undefined && ![0, "0", 200, "200", "SUCCESS"].includes(raw.code as string | number)) {
    throw new ClickZettaApiError(String(raw.code), String(raw.message ?? raw.msg ?? "Cancellation rejected"))
  }
  return response
}

export type CancellationResult = { confirmed: true; state: string } | { confirmed: false; reason: string }

/** Independent total budget, including credential resolution, requests and retries. */
export async function cancelJobAndWait(
  opts: ClientOptions,
  jobId: JobID,
  timeoutMs = 5000,
): Promise<CancellationResult> {
  const deadline = abortAfter(timeoutMs)
  const client = { ...opts, signal: deadline.signal, maxRetries: 0 }
  try {
    let reason = "Cancellation was not confirmed before the cleanup deadline"
    while (!client.signal.aborted) {
      // Repeat cancellation to cover a submit that becomes visible after the first cancel.
      // A missing job is not proof of termination: submission may still be in flight.
      await cancelJob(client, jobId).catch((error: unknown) => {
        reason =
          error instanceof ClickZettaApiError ? `Cancellation rejected (${error.code})` : "Cancellation request failed"
      })
      const raw = await getJobResultRaw(client, jobId).catch(() => undefined)
      if (raw && typeof raw === "object" && "status" in raw) {
        const response = raw as {
          status?: { state?: string; errorCode?: string }
          respStatus?: { errorCode?: string }
          resp_status?: { error_code?: string }
        }
        const status = response.status
        if (
          status?.state &&
          !response.respStatus?.errorCode &&
          !response.resp_status?.error_code &&
          !isRetryableErrorCode(status?.errorCode) &&
          ["SUCCEED", "FAILED", "CANCELLED"].includes(status?.state ?? "")
        ) {
          return { confirmed: true, state: status.state }
        }
      }
      await delay(250, client.signal).catch(() => {})
    }
    return { confirmed: false, reason }
  } finally {
    deadline.dispose()
  }
}
