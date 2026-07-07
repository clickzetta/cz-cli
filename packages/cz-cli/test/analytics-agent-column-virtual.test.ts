import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"

let mockProfileAgentContext: Record<string, unknown> | undefined

mock.module("../src/connection/profile-store.js", () => ({
  readAgentEndpoint: () => "https://example.clickzetta.com",
}))

mock.module("../src/commands/studio-context.js", () => ({
  getProfileAgentContext: () => mockProfileAgentContext,
  getStudioContext: async () => ({
    token: "studio-token",
    instanceId: 11,
    workspaceId: 22,
    projectId: 33,
    userId: 11_000_000_657,
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

function parseData(output: string): unknown {
  return JSON.parse(output.trim()).data
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

describe("analytics-agent column virtual", () => {
  beforeEach(() => {
    process.exitCode = 0
    mockProfileAgentContext = undefined
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    process.stdout.write = originalStdoutWrite
    process.stderr.write = originalStderrWrite
    process.exitCode = 0
    mockProfileAgentContext = undefined
  })

  test("compile sends dataset path and expression body", async () => {
    let requestUrl = ""
    let requestBody: unknown
    globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestBody = init?.body ? JSON.parse(String(init.body)) : null
      return jsonResponse({
        success: true,
        data: {
          datasetId: 195,
          name: "profit_rate",
          type: "double",
          expression: "amount / qty",
          sampleValues: [1.2, 1.5],
        },
      })
    }) as typeof fetch

    const result = await runAnalyticsCli([
      "analytics-agent",
      "column",
      "virtual",
      "compile",
      "--dataset-id",
      "195",
      "--name",
      "profit_rate",
      "--type",
      "double",
      "--expression",
      "amount / qty",
    ])

    expect(result.exitCode).toBe(0)
    const url = new URL(requestUrl)
    expect(url.pathname).toBe("/open/api/v1/analytics-agent/datasets/195/virtual-columns/compile")
    expect(url.searchParams.get("tenantId")).toBe("55")
    expect(requestBody).toEqual({
      name: "profit_rate",
      type: "double",
      expression: "amount / qty",
    })
    expect(parseData(result.output)).toEqual({
      datasetId: 195,
      name: "profit_rate",
      type: "double",
      expression: "amount / qty",
      sampleValues: [1.2, 1.5],
    })
  })

  test("compile accepts logic-rule without expression", async () => {
    let requestUrl = ""
    let requestBody: unknown
    globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestBody = init?.body ? JSON.parse(String(init.body)) : null
      return jsonResponse({
        success: true,
        data: {
          datasetId: 195,
          name: "profit_rate",
          type: "double",
          expression: "amount / qty",
          sampleValues: [1.2, 1.5],
        },
      })
    }) as typeof fetch

    const result = await runAnalyticsCli([
      "analytics-agent",
      "column",
      "virtual",
      "compile",
      "--dataset-id",
      "195",
      "--name",
      "profit_rate",
      "--type",
      "double",
      "--logic-rule",
      "{\"expression\":\"amount / qty\"}",
    ])

    expect(result.exitCode).toBe(0)
    const url = new URL(requestUrl)
    expect(url.pathname).toBe("/open/api/v1/analytics-agent/datasets/195/virtual-columns/compile")
    expect(requestBody).toEqual({
      name: "profit_rate",
      type: "double",
      logicRule: "{\"expression\":\"amount / qty\"}",
    })
  })

  test("compile prefers profile agent context when present", async () => {
    mockProfileAgentContext = {
      token: "open-token",
      instanceId: 0,
      workspaceId: 0,
      projectId: 0,
      userId: 1,
      tenantId: 1504,
      instanceName: "inst",
      workspaceName: "",
      env: "local",
      baseUrl: "https://example.clickzetta.com",
      customHeaders: {},
      userName: "profile-agent",
    }
    let requestUrl = ""
    let authHeader = ""
    globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      authHeader = String((init?.headers as Record<string, string>)?.Authorization ?? "")
      return jsonResponse({
        success: true,
        data: {
          datasetId: 195,
          name: "profit_rate",
          type: "double",
          expression: "amount / qty",
          sampleValues: [],
        },
      })
    }) as typeof fetch

    const result = await runAnalyticsCli([
      "analytics-agent",
      "column",
      "virtual",
      "compile",
      "--dataset-id",
      "195",
      "--name",
      "profit_rate",
      "--type",
      "double",
      "--expression",
      "amount / qty",
    ])

    expect(result.exitCode).toBe(0)
    const url = new URL(requestUrl)
    expect(url.searchParams.get("tenantId")).toBe("1504")
    expect(authHeader).toBe("open-token")
  })

  test("set sends dataset path and returns created summary", async () => {
    let requestUrl = ""
    let requestBody: unknown
    globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestBody = init?.body ? JSON.parse(String(init.body)) : null
      return jsonResponse({
        success: true,
        data: {
          attrId: 31,
          datasetId: 195,
          name: "profit_rate",
          type: "double",
          expression: "amount / qty",
        },
      })
    }) as typeof fetch

    const result = await runAnalyticsCli([
      "analytics-agent",
      "column",
      "virtual",
      "set",
      "--dataset-id",
      "195",
      "--name",
      "profit_rate",
      "--type",
      "double",
      "--expression",
      "amount / qty",
    ])

    expect(result.exitCode).toBe(0)
    const url = new URL(requestUrl)
    expect(url.pathname).toBe("/open/api/v1/analytics-agent/datasets/195/virtual-columns")
    expect(url.searchParams.get("tenantId")).toBe("55")
    expect(requestBody).toEqual({
      name: "profit_rate",
      type: "double",
      expression: "amount / qty",
    })
    expect(parseData(result.output)).toEqual({
      attrId: 31,
      datasetId: 195,
      name: "profit_rate",
      type: "double",
      expression: "amount / qty",
    })
  })

  test("list uses dataset path and trims output fields", async () => {
    let requestUrl = ""
    globalThis.fetch = mock(async (input: RequestInfo | URL) => {
      requestUrl = String(input)
      return jsonResponse({
        success: true,
        data: [{
          attrId: 31,
          datasetId: 195,
          name: "profit_rate",
          type: "double",
          expression: "amount / qty",
          logicRule: "{\"expression\":\"amount / qty\"}",
        }],
      })
    }) as typeof fetch

    const result = await runAnalyticsCli([
      "analytics-agent",
      "column",
      "virtual",
      "list",
      "195",
    ])

    expect(result.exitCode).toBe(0)
    const url = new URL(requestUrl)
    expect(url.pathname).toBe("/open/api/v1/analytics-agent/datasets/195/virtual-columns")
    expect(url.searchParams.get("tenantId")).toBe("55")
    expect(parseData(result.output)).toEqual([{
      attrId: 31,
      datasetId: 195,
      name: "profit_rate",
      type: "double",
      expression: "amount / qty",
    }])
  })

  test("delete uses dataset and attr path", async () => {
    let requestUrl = ""
    globalThis.fetch = mock(async (input: RequestInfo | URL) => {
      requestUrl = String(input)
      return jsonResponse({ code: "204", message: "操作成功", data: null, success: false })
    }) as typeof fetch

    const result = await runAnalyticsCli([
      "analytics-agent",
      "column",
      "virtual",
      "delete",
      "--dataset-id",
      "195",
      "--attr-id",
      "31",
    ])

    expect(result.exitCode).toBe(0)
    const url = new URL(requestUrl)
    expect(url.pathname).toBe("/open/api/v1/analytics-agent/datasets/195/virtual-columns/31")
    expect(url.searchParams.get("tenantId")).toBe("55")
    expect(parseData(result.output)).toEqual({})
  })

  test("compile rejects missing expression and logic-rule before sending request", async () => {
    globalThis.fetch = mock(async () => {
      throw new Error("fetch should not be called")
    }) as typeof fetch

    const result = await runAnalyticsCli([
      "analytics-agent",
      "column",
      "virtual",
      "compile",
      "--dataset-id",
      "195",
      "--name",
      "profit_rate",
      "--type",
      "double",
    ])

    expect(result.exitCode).toBe(1)
    const parsed = JSON.parse(result.output.trim())
    expect(parsed.error.code).toBe("USAGE_ERROR")
    expect(parsed.error.message).toContain("Either --expression or --logic-rule is required")
  })

  test("compile rejects invalid body JSON before sending request", async () => {
    globalThis.fetch = mock(async () => {
      throw new Error("fetch should not be called")
    }) as typeof fetch

    const result = await runAnalyticsCli([
      "analytics-agent",
      "column",
      "virtual",
      "compile",
      "--dataset-id",
      "195",
      "--name",
      "profit_rate",
      "--type",
      "double",
      "--body",
      "{bad json}",
    ])

    expect(result.exitCode).toBe(1)
    const parsed = JSON.parse(result.output.trim())
    expect(parsed.error.code).toBe("USAGE_ERROR")
    expect(parsed.error.message).toContain("Invalid --body")
  })

  test("set rejects invalid body JSON before sending request", async () => {
    globalThis.fetch = mock(async () => {
      throw new Error("fetch should not be called")
    }) as typeof fetch

    const result = await runAnalyticsCli([
      "analytics-agent",
      "column",
      "virtual",
      "set",
      "--dataset-id",
      "195",
      "--name",
      "profit_rate",
      "--type",
      "double",
      "--body",
      "{bad json}",
    ])

    expect(result.exitCode).toBe(1)
    const parsed = JSON.parse(result.output.trim())
    expect(parsed.error.code).toBe("USAGE_ERROR")
    expect(parsed.error.message).toContain("Invalid --body")
  })
})
