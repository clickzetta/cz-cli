import { describe, expect, test } from "bun:test"

const Trace = await import("../src/util/traceparent")

describe("traceparent utility", () => {
  test("creates a valid root traceparent", () => {
    const traceparent = Trace.createTraceparent()
    expect(traceparent).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-0[01]$/)
  })

  test("creates a child traceparent preserving trace id and flags", () => {
    const traceparent = Trace.createTraceparent("00-1234567890abcdef1234567890abcdef-1111111111111111-01")
    expect(traceparent).toMatch(/^00-1234567890abcdef1234567890abcdef-[0-9a-f]{16}-01$/)
    expect(traceparent).not.toContain("-1111111111111111-")
  })

  test("rejects invalid traceparent strings", () => {
    expect(Trace.parseTraceparent("bad-value")).toBeUndefined()
    expect(Trace.parseTraceparent("00-xyz-1111111111111111-01")).toBeUndefined()
  })
})
