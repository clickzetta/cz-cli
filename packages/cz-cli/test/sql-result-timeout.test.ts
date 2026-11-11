import { expect, test } from "bun:test"
import { anonymous } from "@clickzetta/sdk"
import { execSql } from "../src/commands/exec.js"

// Real HTTP: submitJob answers HYBRID SUCCEED with TEXT results at a presigned URL.
function serve(result: () => Response) {
  const cancelled: string[] = []
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const url = new URL(request.url)
      if (url.pathname === "/result") return result()
      const body = await request.json()
      if (url.pathname === "/lh/cancelJob") {
        cancelled.push(body.job_id.id)
        return Response.json({ code: "SUCCESS", data: {} })
      }
      return Response.json({
        status: { state: "SUCCEED" },
        resultSet: {
          metadata: { format: "TEXT", fields: [{ name: "a", type: { category: "STRING" } }] },
          location: { presignedUrls: [`${server.url.origin}/result`] },
        },
      })
    },
  })
  const ctx = {
    config: { workspace: "ws", schema: "public", vcluster: "vc", instance: "inst" },
    clientOpts: { baseUrl: server.url.origin, tokens: anonymous() },
    instanceId: () => 1,
  } as unknown as Parameters<typeof execSql>[0]
  return { server, ctx, cancelled }
}

test("SQL timeout aborts a stalled HYBRID result download", async () => {
  const { server, ctx } = serve(
    () => new Response(new ReadableStream({ start: (c) => void c.enqueue(new TextEncoder().encode("x")) })),
  )
  try {
    const started = Date.now()
    await expect(execSql(ctx, "select 1", { timeoutMs: 200 })).rejects.toThrow(/timed out/)
    expect(Date.now() - started).toBeLessThan(2000)
  } finally {
    await server.stop(true)
  }
})

test("HYBRID result download succeeds with and without a timeout", async () => {
  const { server, ctx } = serve(() => new Response("hello\n"))
  try {
    for (const timeoutMs of [undefined, 5000]) {
      const result = await execSql(ctx, "select 1", { timeoutMs })
      expect((result as { rows: unknown[][] }).rows).toEqual([["hello"]])
    }
  } finally {
    await server.stop(true)
  }
})
