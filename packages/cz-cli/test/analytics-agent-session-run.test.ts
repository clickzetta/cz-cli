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

const originalFetch = globalThis.fetch
const originalStdoutWrite = process.stdout.write.bind(process.stdout)
const originalStderrWrite = process.stderr.write.bind(process.stderr)

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

describe("analytics-agent session run", () => {
  beforeEach(() => {
    process.exitCode = 0
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    process.stdout.write = originalStdoutWrite
    process.stderr.write = originalStderrWrite
    process.exitCode = 0
  })

  test("outputs the raw safe_question_poll payload by default", async () => {
    const pollPayload = {
      success: true,
      data: {
        questionId: 123,
        responses: [
          {
            resGroupId: 1,
            dataType: "thinking",
            modelRes: { data: { message: "step 1" } },
          },
          {
            resGroupId: 1,
            dataType: "summary",
            modelRes: { data: { message: "final answer" } },
          },
          {
            resGroupId: 1,
            dataType: "finish",
            modelRes: { data: { message: "done" } },
          },
        ],
      },
    }

    globalThis.fetch = mock(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes("/open/text2insight/query")) {
        return jsonResponse({ data: { questionId: 123 } })
      }
      if (url.includes("/open/safe_question_poll")) {
        return jsonResponse(pollPayload)
      }
      throw new Error(`unexpected url: ${url}`)
    }) as typeof fetch

    const result = await runAnalyticsCli([
      "analytics-agent",
      "session",
      "run",
      "--domain-id",
      "195",
      "--session-id",
      "7",
      "--msg",
      "hello",
    ])

    expect(result.exitCode).toBe(0)
    expect(JSON.parse(result.output.trim())).toEqual(pollPayload)
  })

  test("shows plain-text final summary when --summary and --format text are set", async () => {
    globalThis.fetch = mock(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes("/open/text2insight/query")) {
        return jsonResponse({ data: { questionId: 123 } })
      }
      if (url.includes("/open/safe_question_poll")) {
        return jsonResponse({
          success: true,
          data: {
            questionId: 123,
            responses: [
              {
                resGroupId: 1,
                dataType: "summary",
                modelRes: { data: { message: "final answer" } },
              },
              {
                resGroupId: 1,
                dataType: "finish",
                modelRes: { data: { message: "done" } },
              },
            ],
          },
        })
      }
      throw new Error(`unexpected url: ${url}`)
    }) as typeof fetch

    const result = await runAnalyticsCli([
      "analytics-agent",
      "session",
      "run",
      "--domain-id",
      "195",
      "--session-id",
      "7",
      "--msg",
      "hello",
      "--summary",
      "--format",
      "text",
    ])

    expect(result.exitCode).toBe(0)
    expect(result.output.trim()).toBe("final answer")
  })

  test("shows structured json when --summary and --format json are both set", async () => {
    globalThis.fetch = mock(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes("/open/text2insight/query")) {
        return jsonResponse({ data: { questionId: 123 } })
      }
      if (url.includes("/open/safe_question_poll")) {
        return jsonResponse({
          success: true,
          data: {
            questionId: 123,
            responses: [
              {
                resGroupId: 1,
                dataType: "summary",
                modelRes: { data: { message: "final answer" } },
              },
              {
                resGroupId: 1,
                dataType: "finish",
                modelRes: { data: { message: "done" } },
              },
            ],
          },
        })
      }
      throw new Error(`unexpected url: ${url}`)
    }) as typeof fetch

    const result = await runAnalyticsCli([
      "analytics-agent",
      "session",
      "run",
      "--domain-id",
      "195",
      "--session-id",
      "7",
      "--msg",
      "hello",
      "--summary",
      "--format",
      "json",
    ])

    expect(result.exitCode).toBe(0)
    const parsed = JSON.parse(result.output.trim()) as Record<string, unknown>
    expect(parsed.data).toBe("final answer")
  })

  test("rejects session-id only run before sending request", async () => {
    globalThis.fetch = mock(async () => {
      throw new Error("fetch should not be called")
    }) as typeof fetch

    const result = await runAnalyticsCli([
      "analytics-agent",
      "session",
      "run",
      "--session-id",
      "7",
      "--msg",
      "hello",
    ])

    expect(result.exitCode).toBe(2)
    const parsed = JSON.parse(result.output.trim()) as Record<string, any>
    expect(parsed.error.code).toBe("USAGE_ERROR")
    expect(parsed.error.message).toContain("--domain-id is required")
  })

  test("auto-creates session with domain-id and reuses returned sessionId", async () => {
    const calls: Array<{ url: string; body: Record<string, unknown> }> = []

    globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {}
      calls.push({ url, body })
      if (url.includes("/open/session/safe_new")) {
        return jsonResponse({ success: true, data: "88" })
      }
      if (url.includes("/open/text2insight/query")) {
        return jsonResponse({ data: { questionId: 123 } })
      }
      if (url.includes("/open/safe_question_poll")) {
        return jsonResponse({
          success: true,
          data: {
            questionId: 123,
            responses: [
              { resGroupId: 1, dataType: "finish", modelRes: { data: { message: "done" } } },
            ],
          },
        })
      }
      throw new Error(`unexpected url: ${url}`)
    }) as typeof fetch

    const result = await runAnalyticsCli([
      "analytics-agent",
      "session",
      "run",
      "--domain-id",
      "195",
      "--msg",
      "hello",
    ])

    expect(result.exitCode).toBe(0)
    expect(calls[0]?.url).toContain("/open/session/safe_new")
    expect(calls[0]?.body).toMatchObject({ domainId: 195 })
    expect(calls[1]?.url).toContain("/open/text2insight/query")
    expect(calls[1]?.body).toMatchObject({ domainId: 195, sessionId: 88, msg: "hello" })
  })
})
