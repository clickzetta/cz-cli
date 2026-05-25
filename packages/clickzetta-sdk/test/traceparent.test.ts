import { afterEach, describe, expect, mock, test } from "bun:test"

const fetchCalls: Array<{ url: string; init?: RequestInit }> = []

globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
  fetchCalls.push({ url: String(input), init })
  return new Response(JSON.stringify({ code: 0, data: { ok: true } }), {
    status: 200,
    headers: { "content-type": "application/json" },
  })
}) as typeof fetch

const { requestRaw } = await import("../src/client.js")
const { studioRequest } = await import("../src/studio/client.js")
const { submitJob } = await import("../src/sql/submit.js")

afterEach(() => {
  delete process.env.CLICKZETTA_TRACEPARENT
})

function headerValue(init: RequestInit | undefined, key: string) {
  const headers = new Headers(init?.headers)
  return headers.get(key)
}

describe("traceparent propagation", () => {
  test("requestRaw adds W3C traceparent when no parent context exists", async () => {
    fetchCalls.length = 0
    delete process.env.CLICKZETTA_TRACEPARENT

    await requestRaw(
      {
        baseUrl: "https://example.invalid",
      },
      "/lh/getJob",
      { id: 1 },
    )

    const call = fetchCalls.at(-1)
    expect(call).toBeDefined()
    expect(headerValue(call?.init, "traceparent")).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-0[01]$/)
  })

  test("requestRaw derives a child traceparent from CLICKZETTA_TRACEPARENT", async () => {
    fetchCalls.length = 0
    process.env.CLICKZETTA_TRACEPARENT = "00-11111111111111111111111111111111-2222222222222222-01"

    await requestRaw(
      {
        baseUrl: "https://example.invalid",
      },
      "/lh/getJob",
      { id: 2 },
    )

    const call = fetchCalls.at(-1)
    const traceparent = headerValue(call?.init, "traceparent")
    expect(traceparent).toMatch(/^00-11111111111111111111111111111111-[0-9a-f]{16}-01$/)
    expect(traceparent).not.toContain("-2222222222222222-")
  })

  test("studioRequest also propagates traceparent alongside studio headers", async () => {
    fetchCalls.length = 0
    process.env.CLICKZETTA_TRACEPARENT = "00-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbb-00"

    await studioRequest(
      {
        baseUrl: "https://studio.invalid",
        token: "tok",
        workspaceId: 1,
        projectId: 2,
        instanceName: "inst",
        userId: 1,
        tenantId: 2,
        instanceId: 3,
        workspaceName: "ws",
        env: "dev",
      },
      "/ide-admin/v1/test",
      { ping: true },
    )

    const call = fetchCalls.at(-1)
    expect(headerValue(call?.init, "instanceName")).toBe("inst")
    expect(headerValue(call?.init, "traceparent")).toMatch(/^00-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-[0-9a-f]{16}-00$/)
  })

  test("submitJob reuses the provided traceparent for request headers", async () => {
    fetchCalls.length = 0
    delete process.env.CLICKZETTA_TRACEPARENT

    await submitJob(
      {
        baseUrl: "https://example.invalid",
      },
      {
        sql: "select 1;",
        workspace: "ws",
        schema: "public",
        vcluster: "vw",
        instanceName: "inst",
        instanceId: 1,
        jobId: { id: "job-1", workspace: "ws", instanceId: 1 },
        hints: { query_tag: "00-1234567890abcdef1234567890abcdef-1111111111111111-01" },
        traceparent: "00-1234567890abcdef1234567890abcdef-1111111111111111-01",
      },
    )

    const call = fetchCalls.at(-1)
    expect(headerValue(call?.init, "traceparent")).toBe("00-1234567890abcdef1234567890abcdef-1111111111111111-01")
  })
})
