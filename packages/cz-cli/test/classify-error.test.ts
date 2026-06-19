/**
 * Unit tests for classifyExecError().
 * Run: bun test test/classify-error.test.ts
 */
import { describe, test, expect } from "bun:test"
import { classifyExecError } from "../src/commands/exec.ts"
import { ClickZettaApiError } from "@clickzetta/sdk"

describe("classifyExecError", () => {
  test("401 ClickZettaApiError → AUTH_ERROR", () => {
    const err = new ClickZettaApiError("Unauthorized", "Unauthorized", 401)
    const r = classifyExecError(err)
    expect(r.code).toBe("AUTH_ERROR")
    expect(r.aiMessage).toContain("Authentication failed")
  })

  test("Error message containing '401' → AUTH_ERROR", () => {
    const err = new Error("Request failed with status 401")
    const r = classifyExecError(err)
    expect(r.code).toBe("AUTH_ERROR")
  })

  test("socket closed → CONNECTION_ERROR", () => {
    const err = new Error("The socket connection was closed unexpectedly.")
    const r = classifyExecError(err)
    expect(r.code).toBe("CONNECTION_ERROR")
    expect(r.aiMessage).toContain("Cannot connect")
  })

  test("ECONNREFUSED → CONNECTION_ERROR", () => {
    const err = new Error("connect ECONNREFUSED 127.0.0.1:443")
    const r = classifyExecError(err)
    expect(r.code).toBe("CONNECTION_ERROR")
  })

  test("fetch timeout → CONNECTION_ERROR", () => {
    const err = new Error("fetch timed out after 30000ms")
    const r = classifyExecError(err)
    expect(r.code).toBe("CONNECTION_ERROR")
  })

  test("job timed out with jobId → JOB_TIMEOUT with async guidance", () => {
    const err = Object.assign(new Error("Job CZ-abc123 timed out after 300000ms"), { jobId: "CZ-abc123" })
    const r = classifyExecError(err)
    expect(r.code).toBe("JOB_TIMEOUT")
    expect(r.jobId).toBe("CZ-abc123")
    expect(r.aiMessage).toContain("--async")
    expect(r.aiMessage).toContain("job cancel")
  })

  test("Authentication required message → NO_CREDENTIALS", () => {
    const err = new Error("Authentication required. Provide --pat or --username/--password, or run `cz-cli setup` to configure a connection profile.")
    const r = classifyExecError(err)
    expect(r.code).toBe("NO_CREDENTIALS")
    expect(r.aiMessage).toContain("cz-cli setup")
  })

  test("generic error → EXEC_ERROR with no aiMessage", () => {
    const err = new Error("Table 'foo' not found")
    const r = classifyExecError(err)
    expect(r.code).toBe("EXEC_ERROR")
    expect(r.message).toBe("Table 'foo' not found")
    expect(r.aiMessage).toBe("")
  })

  test("generic error with string code preserves code", () => {
    const err = Object.assign(new Error("Account yahexxxi has overdue payments."), { code: "CZLH-60029" })
    const r = classifyExecError(err)
    expect(r.code).toBe("CZLH-60029")
    expect(r.message).toBe("Account yahexxxi has overdue payments.")
    expect(r.aiMessage).toBe("")
  })

  test("non-Error value → EXEC_ERROR", () => {
    const r = classifyExecError("something went wrong")
    expect(r.code).toBe("EXEC_ERROR")
    expect(r.message).toBe("something went wrong")
  })
})
