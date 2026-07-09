import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import { spawnSync } from "node:child_process"

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
  getProfileAgentContext: () => undefined,
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

describe("analytics-agent answer-builder", () => {
  beforeEach(() => {
    process.exitCode = 0
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    process.stdout.write = originalStdoutWrite
    process.stderr.write = originalStderrWrite
    process.exitCode = 0
  })

  test("create maps flat fields into request body", async () => {
    let requestUrl = ""
    let requestBody: unknown

    globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestBody = init?.body ? JSON.parse(String(init.body)) : null
      return jsonResponse({ success: true, data: { id: 401 } })
    }) as typeof fetch

    const result = await runAnalyticsCli([
      "analytics-agent",
      "answer-builder",
      "create",
      "--analysis-name",
      "销量分析",
      "--analysis-desc",
      "口径说明",
      "--datasource-id",
      "11",
      "--domain-id",
      "195",
      "--content",
      "{\"type\":\"metric\"}",
    ])

    expect(result.exitCode).toBe(0)
    expect(requestUrl).toContain("/open/api/v1/analytics-agent/answer-builders/create?tenantId=55")
    expect(requestBody).toEqual({
      analysisName: "销量分析",
      analysisDesc: "口径说明",
      datasourceId: 11,
      domainIds: [195],
      content: "{\"type\":\"metric\"}",
    })
  })

  test("list maps flat filter fields into request body", async () => {
    let requestBody: unknown

    globalThis.fetch = mock(async (_input: RequestInfo | URL, init?: RequestInit) => {
      requestBody = init?.body ? JSON.parse(String(init.body)) : null
      return jsonResponse({ success: true, data: [] })
    }) as typeof fetch

    const result = await runAnalyticsCli([
      "analytics-agent",
      "answer-builder",
      "list",
      "--domain-id",
      "195",
      "--datasource-id",
      "11",
      "--page-num",
      "2",
      "--page-size",
      "10",
    ])

    expect(result.exitCode).toBe(0)
    expect(requestBody).toEqual({
      domainIds: [195],
      datasourceId: 11,
      pageNum: 2,
      pageSize: 10,
    })
  })

  test("validate maps flat fields into request body", async () => {
    let requestBody: unknown

    globalThis.fetch = mock(async (_input: RequestInfo | URL, init?: RequestInit) => {
      requestBody = init?.body ? JSON.parse(String(init.body)) : null
      return jsonResponse({ success: true, data: { valid: true } })
    }) as typeof fetch

    const result = await runAnalyticsCli([
      "analytics-agent",
      "answer-builder",
      "validate",
      "--analysis-name",
      "销量分析",
      "--analysis-desc",
      "口径说明",
      "--datasource-id",
      "11",
      "--domain-id",
      "195",
      "--content",
      "{\"type\":\"metric\"}",
    ])

    expect(result.exitCode).toBe(0)
    expect(requestBody).toEqual({
      analysisName: "销量分析",
      analysisDesc: "口径说明",
      datasourceId: 11,
      domainIds: [195],
      content: "{\"type\":\"metric\"}",
    })
  })

  test("create help no longer exposes body option", async () => {
    const result = spawnSync(process.execPath, [
      "./src/main.ts",
      "analytics-agent",
      "answer-builder",
      "create",
      "--help",
    ], {
      cwd: process.cwd(),
      encoding: "utf-8",
    })

    expect(result.status).toBe(0)
    expect(result.stdout).toContain("--analysis-name")
    expect(result.stdout).not.toContain("--body")
  })

  test("disable falls back to detail plus update when direct status route says not found", async () => {
    const requestUrls: string[] = []
    const requestBodies: unknown[] = []

    globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrls.push(String(input))
      requestBodies.push(init?.body ? JSON.parse(String(init.body)) : null)

      if (requestUrls.length === 1) {
        return jsonResponse({
          success: false,
          code: "CZD-404",
          message: "answer builder not found: 401",
        })
      }
      if (requestUrls.length === 2) {
        return jsonResponse({
          success: true,
          data: {
            id: 401,
            analysisName: "销量分析",
            analysisDesc: "口径说明",
            datasourceId: 11,
            domainIds: [195],
            content: "{\"type\":\"metric\"}",
            extObj: { source: "fallback" },
          },
        })
      }
      return jsonResponse({
        success: true,
        data: 401,
      })
    }) as typeof fetch

    const result = await runAnalyticsCli([
      "analytics-agent",
      "answer-builder",
      "disable",
      "401",
    ])

    expect(result.exitCode).toBe(0)
    expect(requestUrls[0]).toContain("/open/api/v1/analytics-agent/answer-builders/disable?tenantId=55")
    expect(requestUrls[1]).toContain("/open/api/v1/analytics-agent/answer-builders/detail?tenantId=55")
    expect(requestUrls[2]).toContain("/open/api/v1/analytics-agent/answer-builders/update?tenantId=55")
    expect(requestBodies[2]).toEqual({
      id: 401,
      analysisName: "销量分析",
      analysisDesc: "口径说明",
      datasourceId: 11,
      domainIds: [195],
      content: "{\"type\":\"metric\"}",
      extObj: { source: "fallback" },
      status: "DISABLE",
    })
    expect(parseData(result.output)).toBe(401)
  })
})
