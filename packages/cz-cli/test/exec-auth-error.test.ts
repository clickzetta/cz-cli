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
  expect(classifyExecError(new ClickZettaApiError("HTTP_401", "HTTP 401: token is invalid", 401)).code).toBe("AUTH_ERROR")
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
    // Transport rotates once per request (2 requests: original + its retry is
    // capped by maxRetries 0), exec adds one rotation and one resubmit.
    expect(s.requests.filter((p) => p.includes("submitJob")).length).toBe(2)
    expect(rotations.length).toBeGreaterThanOrEqual(1)
  } finally {
    s.server.stop(true)
  }
})
