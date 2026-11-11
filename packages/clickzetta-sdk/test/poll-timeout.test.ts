import { expect, test } from "bun:test"
import { anonymous } from "../src/index"
import { pollJobResult } from "../src/sql/poll"

async function timeoutRun(cancelOnTimeout?: boolean) {
  const cancelled: string[] = []
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const body = await request.json()
      if (request.url.endsWith("/lh/cancelJob")) {
        cancelled.push(body.job_id.id)
        return Response.json({ code: "SUCCESS", data: {} })
      }
      return Response.json({ status: { state: "RUNNING" } })
    },
  })
  try {
    const error = await pollJobResult(
      { baseUrl: server.url.href, tokens: anonymous() },
      { id: "job-1", workspace: "ws", instanceId: 1 },
      { jobTimeoutMs: 100, cancelOnTimeout },
    ).catch((e: Error) => e)
    return { error, cancelled }
  } finally {
    await server.stop(true)
  }
}

test("wait timeout leaves the job running by default", async () => {
  const { error, cancelled } = await timeoutRun()
  expect((error as Error).message).toContain("Job job-1 timed out")
  expect(cancelled).toEqual([])
})

test("wait timeout cancels the job when the caller owns it", async () => {
  const { error, cancelled } = await timeoutRun(true)
  expect((error as Error).message).toContain("Job job-1 timed out")
  expect(cancelled).toEqual(["job-1"])
})
