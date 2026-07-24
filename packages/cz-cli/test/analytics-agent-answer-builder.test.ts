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

  test("create injects --sql into content.sql so quotes need no escaping", async () => {
    let requestBody: Record<string, unknown> | null = null
    globalThis.fetch = mock(async (_input: RequestInfo | URL, init?: RequestInit) => {
      requestBody = init?.body ? JSON.parse(String(init.body)) : null
      return jsonResponse({ success: true, data: { id: 401 } })
    }) as typeof fetch

    const result = await runAnalyticsCli([
      "analytics-agent", "answer-builder", "create",
      "--analysis-name", "中标率",
      "--datasource-id", "11",
      "--domain-id", "195",
      "--content", "{\"chartParams\":[],\"outputColumns\":[]}",
      "--sql", "SELECT COUNT(*) FROM t WHERE bid_result='中标'",
    ])

    expect(result.exitCode).toBe(0)
    const content = JSON.parse(String((requestBody as Record<string, unknown>).content))
    expect(content.sql).toBe("SELECT COUNT(*) FROM t WHERE bid_result='中标'")
    expect(content.chartParams).toEqual([])
    expect(content.outputColumns).toEqual([])
  })

  test("create with --sql but no --content builds a content object with just sql", async () => {
    let requestBody: Record<string, unknown> | null = null
    globalThis.fetch = mock(async (_input: RequestInfo | URL, init?: RequestInit) => {
      requestBody = init?.body ? JSON.parse(String(init.body)) : null
      return jsonResponse({ success: true, data: { id: 401 } })
    }) as typeof fetch

    const result = await runAnalyticsCli([
      "analytics-agent", "answer-builder", "create",
      "--analysis-name", "x", "--datasource-id", "11", "--domain-id", "195",
      "--sql", "SELECT 1",
    ])

    expect(result.exitCode).toBe(0)
    const content = JSON.parse(String((requestBody as Record<string, unknown>).content))
    expect(content).toEqual({ sql: "SELECT 1" })
  })

  test("create with neither --content nor --sql is a local usage error", async () => {
    globalThis.fetch = mock(async () => {
      throw new Error("fetch should not be called")
    }) as typeof fetch

    const result = await runAnalyticsCli([
      "analytics-agent", "answer-builder", "create",
      "--analysis-name", "x", "--datasource-id", "11", "--domain-id", "195",
    ])

    expect(result.exitCode).toBe(1)
    const parsed = JSON.parse(result.output.trim())
    expect(parsed.error.code).toBe("USAGE_ERROR")
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

  test("list surfaces backend pagination (total/page_count/has_more) and warns when truncated", async () => {
    globalThis.fetch = mock(async () => {
      // Backend envelope: 10 rows on page 1 of 2, total 14.
      return jsonResponse({
        success: true,
        code: "200",
        data: Array.from({ length: 10 }, (_, i) => ({ id: i + 1, analysisName: `ab${i + 1}` })),
        total: "14",
        pageNum: 1,
        pageSize: 10,
        pageCount: 2,
      })
    }) as typeof fetch

    const result = await runAnalyticsCli([
      "analytics-agent", "answer-builder", "list", "--domain-id", "43",
    ])

    expect(result.exitCode).toBe(0)
    const out = JSON.parse(result.output.trim()) as Record<string, any>
    expect(out.count).toBe(10)
    expect(out.total).toBe(14)
    expect(out.page_count).toBe(2)
    expect(out.has_more).toBe(true)
    // ai_message must warn there are more pages
    expect(out.ai_message).toContain("Showing 10 of 14")
  })

  test("list does not set has_more when all rows fit on one page", async () => {
    globalThis.fetch = mock(async () => {
      return jsonResponse({
        success: true, code: "200",
        data: Array.from({ length: 3 }, (_, i) => ({ id: i + 1 })),
        total: "3", pageNum: 1, pageSize: 10, pageCount: 1,
      })
    }) as typeof fetch

    const result = await runAnalyticsCli([
      "analytics-agent", "answer-builder", "list", "--domain-id", "43",
    ])

    expect(result.exitCode).toBe(0)
    const out = JSON.parse(result.output.trim()) as Record<string, any>
    expect(out.total).toBe(3)
    expect(out.has_more).toBe(false)
    expect(out.ai_message).toBeUndefined()
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

  test("batch disable lists domain, skips already-disabled, disables the rest", async () => {
    const requestUrls: string[] = []
    globalThis.fetch = mock(async (input: RequestInfo | URL) => {
      const url = String(input)
      requestUrls.push(url)
      if (url.includes("/answer-builders/list")) {
        return jsonResponse({
          success: true,
          data: [
            { id: 9, analysisName: "中标率概览", status: "ENABLE" },
            { id: 8, analysisName: "企业投标能力分析", status: "DISABLE" },
          ],
        })
      }
      return jsonResponse({ success: true, data: null })
    }) as typeof fetch

    const result = await runAnalyticsCli([
      "analytics-agent",
      "answer-builder",
      "disable",
      "--all",
      "--domain-id",
      "27",
    ])

    expect(result.exitCode).toBe(0)
    const disableCalls = requestUrls.filter((u) => u.includes("/answer-builders/disable"))
    expect(disableCalls.length).toBe(1)
    const data = parseData(result.output) as Record<string, unknown>
    expect(data.total).toBe(2)
    expect(data.succeeded).toBe(1)
    expect(data.skipped).toBe(1)
    expect(data.failed).toBe(0)
  })

  test("enable rejects both an id and --all", async () => {
    globalThis.fetch = mock(async () => {
      throw new Error("fetch should not be called")
    }) as typeof fetch

    const result = await runAnalyticsCli([
      "analytics-agent",
      "answer-builder",
      "enable",
      "9",
      "--all",
    ])

    expect(result.exitCode).toBe(1)
    const parsed = JSON.parse(result.output.trim())
    expect(parsed.error.code).toBe("USAGE_ERROR")
  })
})
