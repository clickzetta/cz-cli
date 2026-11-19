import { afterAll, beforeEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const home = mkdtempSync(join(tmpdir(), "cz-session-questions-"))
const requests: Array<{ path: string; method: string; tenant: string | null; user: string | null; body: unknown }> = []
const questions = Array.from({ length: 12 }, (_, index) => ({
  questionId: 112 - index,
  questionText: `Question ${12 - index}`,
  createTime: "2026-11-19 10:00:00",
  responses: [{ dataType: "summary", modelRes: { data: { message: `Answer ${12 - index}` } } }],
}))
const session = { sessionId: 88, domainId: 5, title: "Sales history", deleted: false, questions }
let payload: unknown = { success: true, data: session }
let status = 200
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(request) {
    const url = new URL(request.url)
    requests.push({
      path: url.pathname,
      method: request.method,
      tenant: url.searchParams.get("tenantId"),
      user: request.headers.get("userId"),
      body: await request.json(),
    })
    return Response.json(payload, { status })
  },
})
await Bun.write(join(home, ".clickzetta", "profiles.toml"), `
[profiles.test]
service = "http://127.0.0.1:${server.port}"
protocol = "http"
instance = "test"
workspace = ""
analysis_agent_endpoint = "http://127.0.0.1:${server.port}"
[profiles.test.agent]
token = "history-test-token"
tenant_id = 55
user_id = 44
instance_id = 11
`)

afterAll(() => {
  server.stop(true)
  rmSync(home, { recursive: true, force: true })
})
beforeEach(() => {
  requests.length = 0
  payload = { success: true, data: session }
  status = 200
})

async function run(args: string[] = ["--session-id", "88"]) {
  const child = Bun.spawn([process.execPath, "src/main.ts", "analytics-agent", "session", "questions", ...args, "--profile", "test"], {
    cwd: join(import.meta.dir, ".."),
    env: { ...process.env, CLICKZETTA_TEST_HOME: home, CZ_PROFILE: "", CZ_WORKSPACE: "" },
    stdout: "pipe",
    stderr: "pipe",
  })
  const [output, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
  return { code, output, stderr }
}

describe("analytics-agent session questions", () => {
  test("reads every question from an authenticated full-session request without a domain or workspace", async () => {
    // /open does not populate totalCount/hasMore correctly; count the returned
    // full list instead of treating its default totalCount=0 as an empty session.
    payload = { success: true, data: { ...session, totalCount: 0, hasMore: false } }
    const result = await run()
    expect(result.code, result.output + result.stderr).toBe(0)
    expect(requests).toEqual([{
      path: "/open/session/open", method: "POST", tenant: "55", user: "44",
      body: { sessionId: 88, tenantId: 55, userId: 44, loginToken: "history-test-token" },
    }])
    const output = JSON.parse(result.output)
    expect(output.count).toBe(12)
    expect(output.data).toMatchObject({ sessionId: 88, domainId: 5, title: "Sales history", totalCount: 12, hasMore: false })
    expect(output.data.questions).toEqual(questions.map((question) => ({
      questionId: question.questionId, questionText: question.questionText, createTime: question.createTime,
    })))
    expect(result.output).not.toContain("Answer 12")
  })

  test("includes complete answer events on request, including failed historical answers", async () => {
    const history = [{ ...questions[0], responses: [
      { dataType: "sql", modelRes: { data: { sql: "SELECT 1" } } },
      { dataType: "chart", modelRes: { data: { type: "pie" } } },
      { dataType: "error", modelRes: { data: { message: "historical failure" } } },
    ] }]
    payload = { success: true, data: { ...session, questions: history } }
    const result = await run(["--session-id", "88", "--include-answers"])
    expect(result.code, result.output).toBe(0)
    expect(JSON.parse(result.output).data.questions).toEqual(history)
  })

  test.each(["table", "csv", "text", "jsonl"])("renders questions as rows in %s format", async (format) => {
    const result = await run(["--session-id", "88", "--format", format])
    expect(result.code, result.output + result.stderr).toBe(0)
    expect(result.output).toContain("Question 12")
    expect(result.output).toContain("Question 1")
    expect(result.output).not.toContain("Sales history")
  })

  test("an existing empty session succeeds with an explicit empty list", async () => {
    payload = { success: true, data: { ...session, questions: [] } }
    const result = await run()
    expect(result.code, result.output).toBe(0)
    expect(JSON.parse(result.output)).toMatchObject({ data: { sessionId: 88, questions: [], totalCount: 0 }, count: 0 })
    expect(JSON.parse(result.output).ai_message).toContain("has no questions")
  })

  test.each([null, undefined])("does not present missing/inaccessible session data (%s) as an empty history", async (data) => {
    payload = { success: true, data }
    const result = await run()
    expect(result.code).toBe(1)
    expect(JSON.parse(result.output).error).toMatchObject({
      code: "SESSION_NOT_FOUND_OR_FORBIDDEN",
      message: "Session 88 does not exist or the current account cannot access it.",
    })
  })

  test("reports a deleted session even when no questions are supplied", async () => {
    payload = { success: true, data: { sessionId: 88, deleted: true } }
    const result = await run()
    expect(result.code).toBe(1)
    expect(JSON.parse(result.output).error.code).toBe("SESSION_DELETED")
  })

  test("preserves an explicit backend permission error", async () => {
    payload = { success: false, code: "DAA_PERMISSION_DENIED", message: "No permission to read this session" }
    const result = await run()
    expect(result.code).toBe(1)
    expect(JSON.parse(result.output).error).toEqual({ code: "DAA_PERMISSION_DENIED", message: "No permission to read this session" })
  })

  test("preserves HTTP failure details and request identity", async () => {
    status = 403
    payload = { success: false, code: "403", message: "Forbidden", requestId: "history-forbidden" }
    const result = await run()
    expect(result.code).toBe(1)
    expect(JSON.parse(result.output)).toMatchObject({
      error: { message: expect.stringContaining("HTTP 403") },
      request: { method: "POST", path: "/open/session/open", tenantId: 55, status: 403, requestId: "history-forbidden" },
    })
  })

  test.each([
    { sessionId: 89, questions: [] },
    { sessionId: 88 },
    { sessionId: 88, questions: [{ responses: [] }] },
  ])("rejects malformed history instead of silently dropping questions: %j", async (data) => {
    payload = { success: true, data }
    const result = await run()
    expect(result.code).toBe(1)
    expect(JSON.parse(result.output).error.message).toContain("Invalid session response")
  })

  test.each([[], ["--session-id", "0"], ["--session-id", "-1"], ["--session-id", "1.5"]])("rejects invalid session arguments before HTTP: %j", async (...args) => {
    const result = await run(args)
    expect(result.code, result.output).toBe(2)
    expect(JSON.parse(result.output).error.code).toBe("USAGE_ERROR")
    expect(requests).toHaveLength(0)
  })

  test("documents the command and answer option in help", async () => {
    const result = await run(["--help"])
    expect(result.code).toBe(0)
    expect(result.output).toContain("--session-id")
    expect(result.output).toContain("--include-answers")
    expect(requests).toHaveLength(0)
  })
})
