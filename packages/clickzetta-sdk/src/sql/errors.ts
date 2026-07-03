/**
 * Lakehouse business error codes ("lh_code") and helper predicates.
 *
 * Mirrors `clickzetta/connector/v0/client.py` (lines 82-88) and
 * the polling retry logic in `verify_result_dict_finished` /
 * `_check_result_dict` so the TS SDK reacts to the same conditions
 * as the Python connector.
 */

export const lh_code = {
  /** Job id already used for a submitted job; caller should poll, not resubmit. */
  JOB_ALREADY_EXISTS: "CZLH-60007",
  /** Submit returned before the job was fully registered; keep polling. */
  JOB_NOT_SUBMITTED: "CZLH-60023",
  /** Submit may not have registered the job yet; retry submit/poll flow. */
  JOB_NOT_EXISTS: "CZLH-60005",
  /** Transient "job status unknown" from the control plane; keep polling. */
  JOB_STATUS_UNKNOWN: "CZLH-60022",
  /** Server killed the job because it exceeded the configured timeout; fatal. */
  JOB_KILLED_BY_TIMEOUT: "CZLH-60010",
  /** Backend signals the client should retry with a fresh job id. */
  JOB_NEEDS_RERUN: "CZLH-57015",
  /** Virtual cluster queue is full; retry with a fresh job id. */
  VC_QUEUE_LIMIT: "CZLH-60015",
} as const

const RETRYABLE = new Set<string>([
  lh_code.JOB_ALREADY_EXISTS,
  lh_code.JOB_STATUS_UNKNOWN,
  lh_code.JOB_NOT_SUBMITTED,
  lh_code.JOB_NOT_EXISTS,
  lh_code.JOB_NEEDS_RERUN,
  lh_code.VC_QUEUE_LIMIT,
])

const RESUBMIT = new Set<string>([
  lh_code.JOB_NEEDS_RERUN,
  lh_code.VC_QUEUE_LIMIT,
])

const FATAL = new Set<string>([
  lh_code.JOB_KILLED_BY_TIMEOUT,
])

/** True when the lh_code signals "keep polling the same job id". */
export function isRetryableErrorCode(code?: string): boolean {
  if (!code) return false
  return RETRYABLE.has(code)
}

/** True when the lh_code signals "give up this job id and resubmit with a new one". */
export function shouldResubmitWithNewJobId(code?: string): boolean {
  if (!code) return false
  return RESUBMIT.has(code)
}

/** True when the lh_code signals an unrecoverable condition. */
export function isFatalErrorCode(code?: string): boolean {
  if (!code) return false
  return FATAL.has(code)
}

/**
 * Heuristic check on raw error messages. The Python connector's
 * `_check_result_dict` / `verify_result_dict_finished` treat these
 * strings as transient gateway / permission-propagation issues.
 */
export function isRetryableMessage(msg?: string): boolean {
  if (!msg) return false
  if (msg.includes("502 Bad Gateway")) return true
  if (msg.includes(lh_code.JOB_ALREADY_EXISTS)) return true
  if (msg.includes("NoPermission: User ") && msg.includes(" is not found")) return true
  return false
}
