import { expect, test } from "bun:test"
import { anonymous, cancelJob, cancelJobAndWait, requestRaw, submitJob } from "../../src/index.js"

const job = { id: "owned-job", workspace: "workspace", instanceId: 1 }

for (const body of [
  { respStatus: { errorCode: "DENIED", errorMsg: "permission denied" } },
  { resp_status: { error_code: "DENIED", error_msg: "permission denied" } },
  { code: "DENIED", message: "permission denied" },
  null,
]) {
  test(`rejects cancellation business errors: ${JSON.stringify(body)}`, async () => {
    const server = Bun.serve({ port: 0, fetch: () => Response.json(body) })
    try {
      await expect(cancelJob({ baseUrl: server.url.origin, tokens: anonymous() }, job)).rejects.toThrow()
    } finally {
      await server.stop(true)
    }
  })
}

test("retries cancellation until a late submission becomes terminal", async () => {
  let attempts = 0
  const server = Bun.serve({
    port: 0,
    fetch(request) {
      if (request.url.endsWith("cancelJob")) {
        attempts++
        return Response.json(attempts === 1 ? { respStatus: { errorCode: "CZLH-60005" } } : {})
      }
      return Response.json({
        status:
          attempts < 3 ? { state: "FAILED", errorCode: "CZLH-60005" } : { state: "CANCELLED", errorCode: "CZLH-60006" },
      })
    },
  })
  try {
    const result = await cancelJobAndWait(
      { baseUrl: server.url.origin, tokens: anonymous(), signal: AbortSignal.abort() },
      job,
      1000,
    )
    expect(result).toEqual({ confirmed: true, state: "CANCELLED" })
    expect(attempts).toBe(3)
  } finally {
    await server.stop(true)
  }
})

test("HTTP success is not proof of queue release", async () => {
  const server = Bun.serve({ port: 0, fetch: () => Response.json({ status: { state: "RUNNING" } }) })
  try {
    const result = await cancelJobAndWait({ baseUrl: server.url.origin, tokens: anonymous() }, job, 120)
    expect(result.confirmed).toBe(false)
  } finally {
    await server.stop(true)
  }
})

test("cleanup deadline covers credential resolution", async () => {
  const start = Date.now()
  const result = await cancelJobAndWait(
    {
      baseUrl: "http://unused.invalid",
      tokens: {
        get: () => new Promise(() => {}),
        rotate: async () => undefined,
      },
    },
    job,
    50,
  )
  expect(result.confirmed).toBe(false)
  expect(Date.now() - start).toBeLessThan(1000)
})

test("abort prevents HTTP retry after a pending request", async () => {
  let requests = 0
  const server = Bun.serve({
    port: 0,
    fetch() {
      requests++
      return new Promise<Response>(() => {})
    },
  })
  try {
    await expect(
      requestRaw({ baseUrl: server.url.origin, tokens: anonymous(), signal: AbortSignal.timeout(50) }, "/pending"),
    ).rejects.toThrow()
    await Bun.sleep(100)
    expect(requests).toBe(1)
  } finally {
    await server.stop(true)
  }
})

test("abort prevents business-level submit retries", async () => {
  let requests = 0
  const server = Bun.serve({
    port: 0,
    fetch() {
      requests++
      return Response.json({ respStatus: { errorCode: "CZLH-60023" } })
    },
  })
  try {
    await expect(
      submitJob(
        { baseUrl: server.url.origin, tokens: anonymous(), signal: AbortSignal.timeout(50) },
        {
          sql: "select 1",
          workspace: "workspace",
          schema: "public",
          vcluster: "vc",
          instanceName: "instance",
          instanceId: 1,
          jobId: job,
          maxRetries: 3,
        },
      ),
    ).rejects.toThrow()
    expect(requests).toBe(1)
  } finally {
    await server.stop(true)
  }
})
