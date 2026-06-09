import { describe, expect, test } from "bun:test"
import {
  isFatalErrorCode,
  isRetryableErrorCode,
  isRetryableMessage,
  lh_code,
  shouldResubmitWithNewJobId,
} from "../src/sql/errors.js"

describe("lh_code predicates", () => {
  test("isRetryableErrorCode matches the documented retry set", () => {
    expect(isRetryableErrorCode(lh_code.JOB_ALREADY_EXISTS)).toBe(true)
    expect(isRetryableErrorCode(lh_code.JOB_STATUS_UNKNOWN)).toBe(true)
    expect(isRetryableErrorCode(lh_code.JOB_NOT_SUBMITTED)).toBe(true)
    expect(isRetryableErrorCode(lh_code.JOB_NOT_EXISTS)).toBe(true)
    expect(isRetryableErrorCode(lh_code.JOB_NEEDS_RERUN)).toBe(true)
    expect(isRetryableErrorCode(lh_code.VC_QUEUE_LIMIT)).toBe(true)
  })

  test("isRetryableErrorCode rejects fatal / unknown codes", () => {
    expect(isRetryableErrorCode(lh_code.JOB_KILLED_BY_TIMEOUT)).toBe(false)
    expect(isRetryableErrorCode("CZLH-99999")).toBe(false)
    expect(isRetryableErrorCode(undefined)).toBe(false)
    expect(isRetryableErrorCode("")).toBe(false)
  })

  test("shouldResubmitWithNewJobId is limited to 57015 / 60015", () => {
    expect(shouldResubmitWithNewJobId(lh_code.JOB_NEEDS_RERUN)).toBe(true)
    expect(shouldResubmitWithNewJobId(lh_code.VC_QUEUE_LIMIT)).toBe(true)
    expect(shouldResubmitWithNewJobId(lh_code.JOB_ALREADY_EXISTS)).toBe(false)
    expect(shouldResubmitWithNewJobId(lh_code.JOB_STATUS_UNKNOWN)).toBe(false)
    expect(shouldResubmitWithNewJobId(lh_code.JOB_NOT_SUBMITTED)).toBe(false)
    expect(shouldResubmitWithNewJobId(undefined)).toBe(false)
  })

  test("isFatalErrorCode matches 60010", () => {
    expect(isFatalErrorCode(lh_code.JOB_NOT_EXISTS)).toBe(false)
    expect(isFatalErrorCode(lh_code.JOB_KILLED_BY_TIMEOUT)).toBe(true)
    expect(isFatalErrorCode(lh_code.JOB_ALREADY_EXISTS)).toBe(false)
    expect(isFatalErrorCode(lh_code.JOB_NEEDS_RERUN)).toBe(false)
    expect(isFatalErrorCode(undefined)).toBe(false)
  })

  test("isRetryableMessage recognises gateway / permission races", () => {
    expect(isRetryableMessage("nginx: 502 Bad Gateway")).toBe(true)
    expect(
      isRetryableMessage("upstream said CZLH-60007 already there"),
    ).toBe(true)
    expect(
      isRetryableMessage(
        "NoPermission: User foo@bar.com is not found in workspace ws",
      ),
    ).toBe(true)
  })

  test("isRetryableMessage rejects unrelated strings", () => {
    expect(isRetryableMessage("syntax error near 'foo'")).toBe(false)
    expect(isRetryableMessage("NoPermission: User foo@bar.com")).toBe(false)
    expect(isRetryableMessage("bar is not found")).toBe(false)
    expect(isRetryableMessage(undefined)).toBe(false)
    expect(isRetryableMessage("")).toBe(false)
  })
})
