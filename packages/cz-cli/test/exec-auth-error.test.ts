import { expect, test } from "bun:test"
import { ClickZettaApiError, type Credential, type TokenSource } from "@clickzetta/sdk"
import { classifyExecError, execSqlWithRetry, type ExecContext } from "../src/commands/exec.ts"

// Job IDs are a timestamp plus a base36 suffix and error messages embed them, so
// "401" shows up in messages that have nothing to do with authentication.
const jobId = "20261111140103401abc"

function context(baseUrl: string) {
  const credential: Credential = { token: "t", instanceId: 1, userId: 1 }
  const rotations: number[] = []
  const tokens: TokenSource = {
    get: async () => credential,
    rotate: async () => {
      rotations.push(Date.now())
      return credential
    },
  }
  const ctx = {
    config: { instance: "inst", workspace: "ws", schema: "public", vcluster: "vc", service: "x" },
    token: { token: "t", refreshToken: "", expireTimeMs: 0, obtainedAt: 0, instanceId: 1, userId: 1 },
    clientOpts: { baseUrl, tokens, maxRetries: 0 },
    instanceId: () => 1,
  } as unknown as ExecContext
  return { ctx, rotations }
}

function serve(status: number, body: string) {
  const requests: string[] = []
  const server = Bun.serve({
    port: 0,
    fetch(req) {
      requests.push(new URL(req.url).pathname)
      return new Response(body, { status })
    },
  })
  return { server, requests, url: `http://localhost:${server.port}` }
}

test("a job timeout whose job ID contains 401 is JOB_TIMEOUT, not AUTH_ERROR", () => {
  const err = Object.assign(new Error(`Job ${jobId} timed out after 5000ms`), { jobId })
  expect(classifyExecError(err).code).toBe("JOB_TIMEOUT")
})

test("a plain error mentioning 401 in a job ID is not an auth error", () => {
  expect(classifyExecError(new Error(`Job ${jobId}: boom`)).code).toBe("EXEC_ERROR")
})

test("a non-401 API error mentioning 401 is not an auth error", () => {
  const err = new ClickZettaApiError("HTTP_400", `HTTP 400: job ${jobId} rejected`, 400)
  expect(classifyExecError(err).code).not.toBe("AUTH_ERROR")
})

test("a real 401 API error is AUTH_ERROR", () => {
  expect(classifyExecError(new ClickZettaApiError("HTTP_401", "HTTP 401: token is invalid", 401)).code).toBe(
    "AUTH_ERROR",
  )
})

test("a non-401 failure mentioning 401 does not rotate the credential or resubmit the SQL", async () => {
  const s = serve(400, `job ${jobId} rejected`)
  try {
    const { ctx, rotations } = context(s.url)
    await expect(execSqlWithRetry(ctx, "insert into t values (1)")).rejects.toThrow(/rejected/)
    expect(rotations).toHaveLength(0)
    expect(s.requests.filter((p) => p.includes("submitJob"))).toHaveLength(1)
  } finally {
    s.server.stop(true)
  }
})

test("a genuine 401 rotates and resubmits exactly once at the exec level", async () => {
  const s = serve(401, "token is invalid")
  try {
    const { ctx, rotations } = context(s.url)
    await expect(execSqlWithRetry(ctx, "select 1")).rejects.toThrow(/401/)
    // Two execSql attempts. At maxRetries 0 the transport never rotates on its
    // own, so the only rotation is the exec layer's one before its single
    // resubmit — exactly one, never a loop.
    expect(rotations).toHaveLength(1)
    expect(s.requests.filter((p) => p.includes("submitJob"))).toHaveLength(2)
  } finally {
    s.server.stop(true)
  }
})

for (const maxRetries of [0, undefined]) {
  test(`polling 401 never replays admitted SQL (retries: ${maxRetries ?? "default"})`, async () => {
    const submissions: { id: string; sql: string }[] = []
    const polls: string[] = []
    const server = Bun.serve({
      port: 0,
      async fetch(req) {
        const body = await req.json()
        if (new URL(req.url).pathname === "/lh/submitJob") {
          submissions.push({ id: body.jobDesc.jobId.id, sql: body.jobDesc.sqlJob.query[0] })
          return Response.json({ status: { state: "RUNNING" } })
        }
        if (new URL(req.url).pathname === "/lh/getJob") {
          polls.push(body.getResultRequest.jobId.id)
          return new Response("expired", { status: 401 })
        }
        // Cancellation is acknowledged but remains unconfirmed.
        return Response.json({})
      },
    })
    try {
      const { ctx, rotations } = context(`http://localhost:${server.port}`)
      ctx.clientOpts.maxRetries = maxRetries
      const error = await execSqlWithRetry(ctx, "insert into t values (1)").catch((error: unknown) => error)
      expect(error).toBeInstanceOf(ClickZettaApiError)
      expect(classifyExecError(error).code).toBe("AUTH_ERROR")
      expect(submissions).toHaveLength(1)
      expect(submissions[0]?.sql).toContain("insert into t values (1)")
      expect(polls.length).toBeGreaterThan(0)
      expect(new Set(polls)).toEqual(new Set([submissions[0]!.id]))
      if (maxRetries === 0) expect(rotations).toHaveLength(0)
    } finally {
      server.stop(true)
    }
  })
}

test("transport rotation polls the same job with the returned credential", async () => {
  const submissions: string[] = []
  const polls: { id: string; token: string | null; cookie: string | null }[] = []
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      const body = await req.json()
      if (new URL(req.url).pathname === "/lh/submitJob") {
        submissions.push(body.jobDesc.jobId.id)
        return Response.json({ status: { state: "RUNNING" } })
      }
      polls.push({
        id: body.getResultRequest.jobId.id,
        token: req.headers.get("x-clickzetta-token"),
        cookie: req.headers.get("cookie"),
      })
      if (polls.length === 1) return new Response("expired", { status: 401 })
      return Response.json({ status: { state: "SUCCEED" } })
    },
  })
  try {
    const { ctx } = context(`http://localhost:${server.port}`)
    ctx.clientOpts.maxRetries = undefined
    const rejected: Credential[] = []
    ctx.clientOpts.tokens = {
      get: async () => ({ token: "old", headers: { Cookie: "old-cookie" }, userId: 1, instanceId: 1 }),
      rotate: async (credential) => {
        rejected.push(credential)
        // Deliberately do not persist: the transport must use the return value.
        return { token: "fresh", headers: { Cookie: "fresh-cookie" }, userId: 1, instanceId: 1 }
      },
    }
    expect((await execSqlWithRetry(ctx, "insert into t values (1)")).status).toBe("SUCCEEDED")
    expect(submissions).toHaveLength(1)
    expect(rejected).toHaveLength(1)
    expect(rejected[0]?.token).toBe("old")
    expect(polls).toEqual([
      { id: submissions[0]!, token: "old", cookie: "old-cookie" },
      { id: submissions[0]!, token: "fresh", cookie: "fresh-cookie" },
    ])
  } finally {
    server.stop(true)
  }
})

test("a rejected submission recovers through its own token source", async () => {
  const tokens: (string | null)[] = []
  const server = Bun.serve({
    port: 0,
    fetch(req) {
      tokens.push(req.headers.get("x-clickzetta-token"))
      if (tokens.length === 1) return new Response("expired", { status: 401 })
      return Response.json({ status: { state: "SUCCEED" } })
    },
  })
  try {
    const { ctx } = context(`http://localhost:${server.port}`)
    const credential = { token: "old", userId: 1, instanceId: 1 }
    ctx.clientOpts.tokens = {
      get: async () => credential,
      rotate: async (rejected) => {
        expect(rejected).toBe(credential)
        credential.token = "fresh"
        return credential
      },
    }
    expect((await execSqlWithRetry(ctx, "select 1")).status).toBe("SUCCEEDED")
    expect(tokens).toEqual(["old", "fresh"])
  } finally {
    server.stop(true)
  }
})
