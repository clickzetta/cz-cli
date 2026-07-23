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

describe("analytics-agent metric", () => {
  beforeEach(() => {
    process.exitCode = 0
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    process.stdout.write = originalStdoutWrite
    process.stderr.write = originalStderrWrite
    process.exitCode = 0
  })

  test("list maps flat filter fields into request body", async () => {
    let requestUrl = ""
    let requestBody: unknown

    globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestBody = init?.body ? JSON.parse(String(init.body)) : null
      return jsonResponse({ success: true, data: [] })
    }) as typeof fetch

    const result = await runAnalyticsCli([
      "analytics-agent",
      "metric",
      "list",
      "--domain-id",
      "195",
      "--datasource-id",
      "11",
      "--table-name",
      "orders",
      "--page-num",
      "2",
      "--page-size",
      "10",
    ])

    expect(result.exitCode).toBe(0)
    expect(requestUrl).toContain("/open/api/v1/analytics-agent/metrics/list?tenantId=55")
    expect(requestBody).toEqual({
      domainIds: [195],
      datasourceId: 11,
      tableName: "orders",
      pageNum: 2,
      pageSize: 10,
    })
  })

  test("create collects repeated alias flags into alias array", async () => {
    let requestBody: unknown

    globalThis.fetch = mock(async (_input: RequestInfo | URL, init?: RequestInit) => {
      requestBody = init?.body ? JSON.parse(String(init.body)) : null
      return jsonResponse({ success: true, data: { id: 301, alias: ["支付金额", "成交金额"] } })
    }) as typeof fetch

    const result = await runAnalyticsCli([
      "analytics-agent",
      "metric",
      "create",
      "--domain-id",
      "195",
      "--datasource-id",
      "11",
      "--table-name",
      "orders",
      "--name",
      "pay_amount",
      "--expression",
      "sum(amount)",
      "--alias",
      "支付金额",
      "--alias",
      "成交金额",
      "--description",
      "支付金额口径",
    ])

    expect(result.exitCode).toBe(0)
    expect(requestBody).toEqual({
      datasourceId: 11,
      tableName: "orders",
      names: ["pay_amount"],
      aggExpr: "sum(amount)",
      alias: ["支付金额", "成交金额"],
      description: "支付金额口径",
      domainIds: [195],
    })
  })

  test("validate collects repeated alias flags into alias array", async () => {
    let requestBody: unknown

    globalThis.fetch = mock(async (_input: RequestInfo | URL, init?: RequestInit) => {
      requestBody = init?.body ? JSON.parse(String(init.body)) : null
      return jsonResponse({ success: true, data: { valid: true } })
    }) as typeof fetch

    const result = await runAnalyticsCli([
      "analytics-agent",
      "metric",
      "validate",
      "--domain-id",
      "195",
      "--datasource-id",
      "11",
      "--table-name",
      "orders",
      "--name",
      "pay_amount",
      "--expression",
      "sum(amount)",
      "--alias",
      "支付金额",
      "--alias",
      "成交金额",
    ])

    expect(result.exitCode).toBe(0)
    expect(requestBody).toEqual({
      datasourceId: 11,
      tableName: "orders",
      names: ["pay_amount"],
      aggExpr: "sum(amount)",
      alias: ["支付金额", "成交金额"],
      domainIds: [195],
    })
  })

  test("create rejects legacy alias JSON array string before sending request", async () => {
    globalThis.fetch = mock(async () => {
      throw new Error("fetch should not be called")
    }) as typeof fetch

    const result = await runAnalyticsCli([
      "analytics-agent",
      "metric",
      "create",
      "--domain-id",
      "195",
      "--datasource-id",
      "11",
      "--table-name",
      "orders",
      "--name",
      "pay_amount",
      "--expression",
      "sum(amount)",
      "--alias",
      "[\"支付金额\",\"成交金额\"]",
    ])

    expect(result.exitCode).toBe(1)
    const parsed = JSON.parse(result.output.trim()) as Record<string, any>
    expect(parsed.error.code).toBe("USAGE_ERROR")
    expect(parsed.error.message).toContain("repeat --alias")
  })

  test("create rejects invalid domain-id before sending request", async () => {
    globalThis.fetch = mock(async () => {
      throw new Error("fetch should not be called")
    }) as typeof fetch

    const result = await runAnalyticsCli([
      "analytics-agent",
      "metric",
      "create",
      "--domain-id",
      "abc",
      "--datasource-id",
      "11",
      "--table-name",
      "orders",
      "--name",
      "pay_amount",
      "--expression",
      "sum(amount)",
    ])

    expect(result.exitCode).toBe(1)
    const parsed = JSON.parse(result.output.trim()) as Record<string, any>
    expect(parsed.error.code).toBe("USAGE_ERROR")
    expect(parsed.error.message).toContain("--domain-id")
    expect(parsed.error.message).toContain("positive integer")
  })

  test("create help no longer exposes body option", async () => {
    const result = spawnSync(process.execPath, [
      "./src/main.ts",
      "analytics-agent",
      "metric",
      "create",
      "--help",
    ], {
      cwd: process.cwd(),
      encoding: "utf-8",
    })

    expect(result.status).toBe(0)
    expect(result.stdout).toContain("--alias")
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
          message: "metric not found: 301",
        })
      }
      if (requestUrls.length === 2) {
        return jsonResponse({
          success: true,
          data: {
            id: 301,
            datasourceId: 11,
            tableName: "orders",
            names: ["pay_amount"],
            aggExpr: "sum(amount)",
            alias: ["支付金额"],
            description: "支付金额口径",
            domainIds: [195],
            ext: { unit: "元" },
          },
        })
      }
      return jsonResponse({
        success: true,
        data: 301,
      })
    }) as typeof fetch

    const result = await runAnalyticsCli([
      "analytics-agent",
      "metric",
      "disable",
      "301",
    ])

    expect(result.exitCode).toBe(0)
    expect(requestUrls[0]).toContain("/open/api/v1/analytics-agent/metrics/disable?tenantId=55")
    expect(requestUrls[1]).toContain("/open/api/v1/analytics-agent/metrics/detail?tenantId=55")
    expect(requestUrls[2]).toContain("/open/api/v1/analytics-agent/metrics/update?tenantId=55")
    expect(requestBodies[2]).toEqual({
      id: 301,
      datasourceId: 11,
      tableName: "orders",
      names: ["pay_amount"],
      aggExpr: "sum(amount)",
      alias: ["支付金额"],
      description: "支付金额口径",
      domainIds: [195],
      ext: { unit: "元" },
      status: "DISABLE",
    })
    expect(parseData(result.output)).toBe(301)
  })

  test("batch enable lists domain, skips already-enabled, enables the rest", async () => {
    const requestUrls: string[] = []
    globalThis.fetch = mock(async (input: RequestInfo | URL) => {
      const url = String(input)
      requestUrls.push(url)
      if (url.includes("/metrics/list")) {
        return jsonResponse({
          success: true,
          data: [
            { id: 197, names: ["平均预算总额"], status: "ENABLE" },
            { id: 196, names: ["企业总数"], status: "DISABLE" },
            { id: 195, names: ["中标率"], status: "DISABLE" },
          ],
        })
      }
      return jsonResponse({ success: true, data: null })
    }) as typeof fetch

    const result = await runAnalyticsCli([
      "analytics-agent",
      "metric",
      "enable",
      "--all",
      "--domain-id",
      "27",
    ])

    expect(result.exitCode).toBe(0)
    const enableCalls = requestUrls.filter((u) => u.includes("/metrics/enable"))
    expect(enableCalls.length).toBe(2)
    const data = parseData(result.output) as Record<string, unknown>
    expect(data.total).toBe(3)
    expect(data.succeeded).toBe(2)
    expect(data.skipped).toBe(1)
    expect(data.failed).toBe(0)
  })

  test("batch enable paginates the list so it covers items past the first page", async () => {
    let listCalls = 0
    globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes("/metrics/list")) {
        listCalls++
        const body = init?.body ? JSON.parse(String(init.body)) : {}
        // Page 1 is full (200 rows) -> forces a second page; page 2 has 5 rows.
        if (body.pageNum === 1) {
          const page = Array.from({ length: 200 }, (_, i) => ({ id: i + 1, names: [`m${i + 1}`], status: "DISABLE" }))
          return jsonResponse({ success: true, data: page })
        }
        const page = Array.from({ length: 5 }, (_, i) => ({ id: 200 + i + 1, names: [`m${200 + i + 1}`], status: "DISABLE" }))
        return jsonResponse({ success: true, data: page })
      }
      return jsonResponse({ success: true, data: null })
    }) as typeof fetch

    const result = await runAnalyticsCli([
      "analytics-agent",
      "metric",
      "enable",
      "--all",
      "--domain-id",
      "27",
    ])

    expect(result.exitCode).toBe(0)
    expect(listCalls).toBe(2)
    const data = parseData(result.output) as Record<string, unknown>
    expect(data.total).toBe(205)
    expect(data.succeeded).toBe(205)
  })

  test("batch enable stops (no infinite loop) when the backend ignores pageNum", async () => {
    // Simulate a broken backend that returns the SAME full page regardless of
    // pageNum. Dedup-by-id + no-new-items guard must terminate after 2 calls.
    let listCalls = 0
    globalThis.fetch = mock(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes("/metrics/list")) {
        listCalls++
        const page = Array.from({ length: 200 }, (_, i) => ({ id: i + 1, names: [`m${i + 1}`], status: "DISABLE" }))
        return jsonResponse({ success: true, data: page })
      }
      return jsonResponse({ success: true, data: null })
    }) as typeof fetch

    const result = await runAnalyticsCli([
      "analytics-agent",
      "metric",
      "enable",
      "--all",
      "--domain-id",
      "27",
    ])

    expect(result.exitCode).toBe(0)
    // Page 1 adds 200 new ids; page 2 is identical -> 0 new -> stop.
    expect(listCalls).toBe(2)
    const data = parseData(result.output) as Record<string, unknown>
    expect(data.total).toBe(200)
  })

  test("batch enable sets non-zero exit code when an item fails", async () => {
    globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes("/metrics/list")) {
        return jsonResponse({
          success: true,
          data: [
            { id: 196, names: ["企业总数"], status: "DISABLE" },
            { id: 195, names: ["中标率"], status: "DISABLE" },
          ],
        })
      }
      const body = init?.body ? JSON.parse(String(init.body)) : {}
      if (body.id === 195) {
        return jsonResponse({ success: false, code: "CZLH-42000", message: "invalid metric" })
      }
      return jsonResponse({ success: true, data: null })
    }) as typeof fetch

    const result = await runAnalyticsCli([
      "analytics-agent",
      "metric",
      "enable",
      "--all",
      "--domain-id",
      "27",
    ])

    expect(result.exitCode).toBe(1)
    const data = parseData(result.output) as Record<string, unknown>
    expect(data.succeeded).toBe(1)
    expect(data.failed).toBe(1)
  })

  test("batch disable reuses the detail+update fallback per item on not-found", async () => {
    const requestUrls: string[] = []
    globalThis.fetch = mock(async (input: RequestInfo | URL) => {
      const url = String(input)
      requestUrls.push(url)
      if (url.includes("/metrics/list")) {
        return jsonResponse({
          success: true,
          data: [{ id: 196, names: ["企业总数"], status: "ENABLE" }],
        })
      }
      if (url.includes("/metrics/disable")) {
        return jsonResponse({ success: false, code: "CZD-404", message: "metric not found: 196" })
      }
      if (url.includes("/metrics/detail")) {
        return jsonResponse({
          success: true,
          data: {
            id: 196,
            datasourceId: 11,
            tableName: "orders",
            names: ["企业总数"],
            aggExpr: "count(*)",
            domainIds: [27],
          },
        })
      }
      return jsonResponse({ success: true, data: 196 })
    }) as typeof fetch

    const result = await runAnalyticsCli([
      "analytics-agent",
      "metric",
      "disable",
      "--all",
      "--domain-id",
      "27",
    ])

    expect(result.exitCode).toBe(0)
    expect(requestUrls.some((u) => u.includes("/metrics/detail"))).toBe(true)
    expect(requestUrls.some((u) => u.includes("/metrics/update"))).toBe(true)
    const data = parseData(result.output) as Record<string, unknown>
    expect(data.succeeded).toBe(1)
    expect(data.failed).toBe(0)
  })

  test("enable rejects passing both an id and --all", async () => {
    globalThis.fetch = mock(async () => {
      throw new Error("fetch should not be called")
    }) as typeof fetch

    const result = await runAnalyticsCli([
      "analytics-agent",
      "metric",
      "enable",
      "197",
      "--all",
    ])

    expect(result.exitCode).toBe(1)
    const parsed = JSON.parse(result.output.trim())
    expect(parsed.error.code).toBe("USAGE_ERROR")
  })

  test("enable --all without --domain-id is a usage error", async () => {
    globalThis.fetch = mock(async () => {
      throw new Error("fetch should not be called")
    }) as typeof fetch

    const result = await runAnalyticsCli([
      "analytics-agent",
      "metric",
      "enable",
      "--all",
    ])

    expect(result.exitCode).toBe(1)
    const parsed = JSON.parse(result.output.trim())
    expect(parsed.error.code).toBe("USAGE_ERROR")
    expect(parsed.error.message).toContain("--domain-id")
  })

  test("enable with no id and no --all is a usage error", async () => {
    globalThis.fetch = mock(async () => {
      throw new Error("fetch should not be called")
    }) as typeof fetch

    const result = await runAnalyticsCli([
      "analytics-agent",
      "metric",
      "enable",
    ])

    expect(result.exitCode).toBe(1)
    const parsed = JSON.parse(result.output.trim())
    expect(parsed.error.code).toBe("USAGE_ERROR")
  })
})
