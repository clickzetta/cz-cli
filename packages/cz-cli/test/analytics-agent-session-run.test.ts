import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"

mock.module("../src/connection/profile-store.js", () => ({
  readAgentEndpoint: () => "https://example.clickzetta.com",
}))

mock.module("../src/commands/studio-context.js", () => ({
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
      "--session-id",
      "7",
      "--msg",
      "hello",
    ])

    expect(result.exitCode).toBe(0)
    expect(JSON.parse(result.output.trim())).toEqual(pollPayload)
  })

  test("shows the final-summary output when --summary is set", async () => {
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
      "--session-id",
      "7",
      "--msg",
      "hello",
      "--summary",
    ])

    expect(result.exitCode).toBe(0)
    expect(result.output.trim()).toBe("final answer")
  })
})
