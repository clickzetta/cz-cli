import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"

mock.module("../src/connection/profile-store.js", () => ({
  readAgentEndpoint: () => "https://example.clickzetta.com",
}))

mock.module("../src/commands/studio-context.js", () => ({
  getProfileAgentContext: () => undefined,
  getStudioContext: async () => ({
    token: "studio-token",
    instanceId: 11,
    workspaceId: 22,
    projectId: 33,
    userId: 44,
    tenantId: 55,
    instanceName: "inst",
    workspaceName: "ws",
    env: "uat",
    baseUrl: "https://example.clickzetta.com",
    customHeaders: {},
    userName: "tester",
  }),
}))

mock.module("../src/logger.js", () => ({
  logOperation: () => {},
}))

const { createCli } = await import("../src/cli.ts")
const { registerAnalyticsAgentCommand } = await import("../src/commands/analytics-agent.ts")

const originalStdoutWrite = process.stdout.write.bind(process.stdout)
const originalStderrWrite = process.stderr.write.bind(process.stderr)
const originalFetch = globalThis.fetch

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "content-type": "application/json" },
  })
}

async function runAnalyticsCli(args: string[]): Promise<{ exitCode: number; output: string }> {
  const chunks: string[] = []
  const savedExitCode = process.exitCode

  process.stdout.write = ((chunk: string | Uint8Array) => {
    chunks.push(typeof chunk === "string" ? chunk : chunk.toString())
    return true
  }) as typeof process.stdout.write

  process.stderr.write = ((chunk: string | Uint8Array) => {
    chunks.push(typeof chunk === "string" ? chunk : chunk.toString())
    return true
  }) as typeof process.stderr.write

  process.exitCode = 0
  try {
    const cli = createCli(args)
    registerAnalyticsAgentCommand(cli)
    await cli.demandCommand(1, "").help().parseAsync()
  } catch {
    if (!process.exitCode) process.exitCode = 1
  } finally {
    process.stdout.write = originalStdoutWrite
    process.stderr.write = originalStderrWrite
  }

  const exitCode = process.exitCode ?? 0
  process.exitCode = savedExitCode ?? 0
  return { exitCode, output: chunks.join("") }
}

function parsedError(output: string): Record<string, string> {
  return (JSON.parse(output.trim()) as { error: Record<string, string> }).error
}

describe("analytics-agent id validation", () => {
  beforeEach(() => {
    process.exitCode = 0
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    process.stdout.write = originalStdoutWrite
    process.stderr.write = originalStderrWrite
    process.exitCode = 0
  })

  test("session run rejects invalid session-id instead of auto-creating a session", async () => {
    globalThis.fetch = mock(async () => {
      throw new Error("fetch should not be called")
    }) as typeof fetch

    const result = await runAnalyticsCli([
      "analytics-agent",
      "session",
      "run",
      "--session-id",
      "abc",
      "--domain-id",
      "5",
      "--msg",
      "hello",
    ])

    expect(result.exitCode).toBe(2)
    expect(parsedError(result.output).code).toBe("USAGE_ERROR")
    expect(parsedError(result.output).message).toContain("--session-id")
  })

  test("session run with a valid session-id does not require domain-id", async () => {
    let runRequestBody: Record<string, unknown> | undefined

    globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes("/open/text2insight/query")) {
        runRequestBody = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined
        return jsonResponse({ success: true, data: { questionId: 99 } })
      }
      if (url.includes("/open/safe_question_poll")) {
        return jsonResponse({ success: true, data: { responses: [{ dataType: "finish", modelRes: { data: { message: "done" } } }] } })
      }
      return jsonResponse({ success: true, data: {} })
    }) as typeof fetch

    const result = await runAnalyticsCli([
      "analytics-agent",
      "session",
      "run",
      "--session-id",
      "7",
      "--msg",
      "hello",
      "--summary",
    ])

    expect(result.exitCode).toBe(0)
    expect(runRequestBody).toMatchObject({ sessionId: 7, msg: "hello" })
    expect(runRequestBody).not.toHaveProperty("domainId")
  })

  test("metric detail rejects invalid metric-id before sending request", async () => {
    globalThis.fetch = mock(async () => {
      throw new Error("fetch should not be called")
    }) as typeof fetch

    const result = await runAnalyticsCli(["analytics-agent", "metric", "detail", "abc"])

    expect(result.exitCode).toBe(2)
    expect(parsedError(result.output).message).toContain("--metric-id")
  })

  test("domain detail rejects non-positive domain-id before building /NaN path", async () => {
    globalThis.fetch = mock(async () => {
      throw new Error("fetch should not be called")
    }) as typeof fetch

    const result = await runAnalyticsCli(["analytics-agent", "domain", "detail", "0"])

    expect(result.exitCode).toBe(2)
    expect(parsedError(result.output).message).toContain("--domain-id")
  })

  test("knowledge file upload rejects invalid space-id before reading local file", async () => {
    globalThis.fetch = mock(async () => {
      throw new Error("fetch should not be called")
    }) as typeof fetch

    const result = await runAnalyticsCli([
      "analytics-agent",
      "knowledge",
      "file",
      "upload",
      "-1",
      "./does-not-exist.txt",
    ])

    expect(result.exitCode).toBe(2)
    expect(parsedError(result.output).message).toContain("--space-id")
  })

  test("knowledge folder create allows parent-id 0 for root", async () => {
    let requestBody: Record<string, unknown> | undefined

    globalThis.fetch = mock(async (_input: RequestInfo | URL, init?: RequestInit) => {
      requestBody = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined
      return jsonResponse({ success: true, data: { id: 10 } })
    }) as typeof fetch

    const result = await runAnalyticsCli([
      "analytics-agent",
      "knowledge",
      "folder",
      "create",
      "1",
      "--parent-id",
      "0",
      "--name",
      "root-child",
    ])

    expect(result.exitCode).toBe(0)
    expect(requestBody).toMatchObject({ parentId: 0, name: "root-child" })
  })

  test("datasource load validates --domain-ids as positive integers", async () => {
    let requestBody: Record<string, unknown> | undefined

    globalThis.fetch = mock(async (_input: RequestInfo | URL, init?: RequestInit) => {
      requestBody = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined
      return jsonResponse({ success: true, data: { datasetId: 12 } })
    }) as typeof fetch

    const result = await runAnalyticsCli([
      "analytics-agent",
      "datasource",
      "load",
      "3",
      "--domain-ids",
      "[5,6]",
    ])

    expect(result.exitCode).toBe(0)
    expect(requestBody).toMatchObject({ domainIds: [5, 6] })
  })

  test("datasource load rejects invalid --domain-ids before sending request", async () => {
    globalThis.fetch = mock(async () => {
      throw new Error("fetch should not be called")
    }) as typeof fetch

    const result = await runAnalyticsCli([
      "analytics-agent",
      "datasource",
      "load",
      "3",
      "--domain-ids",
      "[5,0]",
    ])

    expect(result.exitCode).toBe(2)
    expect(parsedError(result.output).message).toContain("--domain-ids")
  })

  test("domain joins apply rejects non-positive dataset ids in --join", async () => {
    globalThis.fetch = mock(async () => {
      throw new Error("fetch should not be called")
    }) as typeof fetch

    const result = await runAnalyticsCli([
      "analytics-agent",
      "domain",
      "joins",
      "apply",
      "--domain-id",
      "1",
      "--join",
      "0:orders.user_id=2:users.id@n:1",
    ])

    expect(result.exitCode).toBe(1)
    expect(result.output).toContain("datasetId must be a positive integer")
  })
})
