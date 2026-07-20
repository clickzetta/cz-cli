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

function parseError(output: string): { code: string; message: string } {
  return JSON.parse(output.trim()).error
}

describe("analytics-agent domain and datasource parameter simplification", () => {
  beforeEach(() => {
    process.exitCode = 0
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    process.stdout.write = originalStdoutWrite
    process.stderr.write = originalStderrWrite
    process.exitCode = 0
  })

  test("domain create collects repeated sample-question flags into sampleQuestions array", async () => {
    let requestBody: unknown

    globalThis.fetch = mock(async (_input: RequestInfo | URL, init?: RequestInit) => {
      requestBody = init?.body ? JSON.parse(String(init.body)) : null
      return jsonResponse({ success: true, data: { id: 195 } })
    }) as typeof fetch

    const result = await runAnalyticsCli([
      "analytics-agent",
      "domain",
      "create",
      "--name",
      "销售域",
      "--datasource-id",
      "11",
      "--sample-question",
      "本周销售额多少",
      "--sample-question",
      "华北地区销售额多少",
    ])

    expect(result.exitCode).toBe(0)
    expect(requestBody).toEqual({
      name: "销售域",
      datasourceId: 11,
      sampleQuestions: ["本周销售额多少", "华北地区销售额多少"],
    })
  })

  test("domain create help no longer exposes sample-questions or body", () => {
    const result = spawnSync(process.execPath, [
      "./src/main.ts",
      "analytics-agent",
      "domain",
      "create",
      "--help",
    ], {
      cwd: process.cwd(),
      encoding: "utf-8",
    })

    expect(result.status).toBe(0)
    expect(result.stdout).toContain("--sample-question")
    expect(result.stdout).not.toContain("--sample-questions")
    expect(result.stdout).not.toContain("--body")
  })

  test("domain create rejects legacy sample-question JSON array string before sending request", async () => {
    globalThis.fetch = mock(async () => {
      throw new Error("fetch should not be called")
    }) as typeof fetch

    const result = await runAnalyticsCli([
      "analytics-agent",
      "domain",
      "create",
      "--name",
      "销售域",
      "--datasource-id",
      "11",
      "--sample-question",
      "[\"问题1\",\"问题2\"]",
    ])

    expect(result.exitCode).toBe(1)
    expect(parseError(result.output)).toEqual({
      code: "USAGE_ERROR",
      message: "--sample-question no longer accepts JSON array strings; repeat --sample-question instead",
    })
  })

  test("domain delete treats code 200 no-data success as success", async () => {
    let requestUrl = ""

    globalThis.fetch = mock(async (input: RequestInfo | URL) => {
      requestUrl = String(input)
      return jsonResponse({
        code: 200,
        message: "操作成功",
        success: false,
        data: null,
      })
    }) as typeof fetch

    const result = await runAnalyticsCli([
      "analytics-agent",
      "domain",
      "delete",
      "195",
    ])

    expect(result.exitCode).toBe(0)
    expect(requestUrl).toContain("/open/api/v1/analytics-agent/domains/195?tenantId=55")
  })

  test("datasource list defaults withDetail to false", async () => {
    let requestUrl = ""

    globalThis.fetch = mock(async (input: RequestInfo | URL) => {
      requestUrl = String(input)
      return jsonResponse({ success: true, data: [] })
    }) as typeof fetch

    const result = await runAnalyticsCli([
      "analytics-agent",
      "datasource",
      "list",
    ])

    expect(result.exitCode).toBe(0)
    const url = new URL(requestUrl)
    expect(url.pathname).toBe("/open/api/v1/datasources")
    expect(url.searchParams.get("tenantId")).toBe("55")
    expect(url.searchParams.get("withDetail")).toBe("false")
  })

  test("datasource browse composes path from workspace and schema", async () => {
    let requestUrl = ""

    globalThis.fetch = mock(async (input: RequestInfo | URL) => {
      requestUrl = String(input)
      return jsonResponse({ success: true, data: [] })
    }) as typeof fetch

    const result = await runAnalyticsCli([
      "analytics-agent",
      "datasource",
      "browse",
      "288",
      "--workspace",
      "ai_workspace",
      "--schema",
      "hll_dws",
    ])

    expect(result.exitCode).toBe(0)
    const url = new URL(requestUrl)
    expect(url.pathname).toBe("/open/api/v1/datasources/288/browse")
    expect(url.searchParams.get("path")).toBe("workspace:ai_workspace/schema:hll_dws")
  })

  test("datasource table search uses positional keyword and scoped path", async () => {
    let requestUrl = ""

    globalThis.fetch = mock(async (input: RequestInfo | URL) => {
      requestUrl = String(input)
      return jsonResponse({ success: true, data: [] })
    }) as typeof fetch

    const result = await runAnalyticsCli([
      "analytics-agent",
      "datasource",
      "table",
      "search",
      "288",
      "driver",
      "--workspace",
      "ai_workspace",
      "--schema",
      "hll_dws",
    ])

    expect(result.exitCode).toBe(0)
    const url = new URL(requestUrl)
    expect(url.pathname).toBe("/open/api/v1/datasources/288/tables/search")
    expect(url.searchParams.get("keyword")).toBe("driver")
    expect(url.searchParams.get("path")).toBe("workspace:ai_workspace/schema:hll_dws")
  })

  test("datasource table show requests columns and disables preview by default", async () => {
    let requestUrl = ""

    globalThis.fetch = mock(async (input: RequestInfo | URL) => {
      requestUrl = String(input)
      return jsonResponse({ success: true, data: { tableName: "orders" } })
    }) as typeof fetch

    const result = await runAnalyticsCli([
      "analytics-agent",
      "datasource",
      "table",
      "show",
      "288",
      "--workspace",
      "ai_workspace",
      "--schema",
      "hll_dws",
      "--table",
      "dws_info_driver_daily_1d_tm",
    ])

    expect(result.exitCode).toBe(0)
    const url = new URL(requestUrl)
    expect(url.pathname).toBe("/open/api/v1/datasources/288/tables/dws_info_driver_daily_1d_tm")
    expect(url.searchParams.get("path")).toBe("workspace:ai_workspace/schema:hll_dws")
    expect(url.searchParams.get("includeColumns")).toBe("true")
    expect(url.searchParams.get("includePreview")).toBe("false")
  })

  test("datasource table show enables preview when requested", async () => {
    let requestUrl = ""

    globalThis.fetch = mock(async (input: RequestInfo | URL) => {
      requestUrl = String(input)
      return jsonResponse({ success: true, data: { tableName: "orders" } })
    }) as typeof fetch

    const result = await runAnalyticsCli([
      "analytics-agent",
      "datasource",
      "table",
      "show",
      "288",
      "--workspace",
      "ai_workspace",
      "--schema",
      "hll_dws",
      "--table",
      "dws_info_driver_daily_1d_tm",
      "--preview",
    ])

    expect(result.exitCode).toBe(0)
    expect(new URL(requestUrl).searchParams.get("includePreview")).toBe("true")
  })

  test("datasource table load collects repeated domain-id flags into domainIds array", async () => {
    let requestBody: unknown

    globalThis.fetch = mock(async (_input: RequestInfo | URL, init?: RequestInit) => {
      requestBody = init?.body ? JSON.parse(String(init.body)) : null
      return jsonResponse({ success: true, data: { datasetId: 301 } })
    }) as typeof fetch

    const result = await runAnalyticsCli([
      "analytics-agent",
      "datasource",
      "table",
      "load",
      "288",
      "--workspace",
      "w",
      "--schema",
      "s",
      "--table",
      "orders",
      "--domain-id",
      "195",
      "--domain-id",
      "196",
    ])

    expect(result.exitCode).toBe(0)
    expect(requestBody).toEqual({
      path: "workspace:w/schema:s",
      tableName: "orders",
      domainIds: [195, 196],
    })
  })

  test("datasource table load help does not expose old body or table-name flags", () => {
    const result = spawnSync(process.execPath, [
      "./src/main.ts",
      "analytics-agent",
      "datasource",
      "table",
      "load",
      "--help",
    ], {
      cwd: process.cwd(),
      encoding: "utf-8",
    })

    expect(result.status).toBe(0)
    expect(result.stdout).toContain("--table")
    expect(result.stdout).toContain("--domain-id")
    expect(result.stdout).not.toContain("--domain-ids")
    expect(result.stdout).not.toContain("--table-name")
    expect(result.stdout).not.toContain("--body")
  })

  test("datasource table load rejects invalid domain-id before sending request", async () => {
    globalThis.fetch = mock(async () => {
      throw new Error("fetch should not be called")
    }) as typeof fetch

    const result = await runAnalyticsCli([
      "analytics-agent",
      "datasource",
      "table",
      "load",
      "11",
      "--table",
      "orders",
      "--domain-id",
      "abc",
    ])

    expect(result.exitCode).toBe(1)
    expect(parseError(result.output)).toEqual({
      code: "USAGE_ERROR",
      message: "--domain-id must contain only positive integers",
    })
  })

  test("old datasource table commands are not exposed", () => {
    const result = spawnSync(process.execPath, [
      "./src/main.ts",
      "analytics-agent",
      "datasource",
      "--help",
    ], {
      cwd: process.cwd(),
      encoding: "utf-8",
    })

    expect(result.status).toBe(0)
    expect(result.stdout).toContain("list")
    expect(result.stdout).toContain("browse")
    expect(result.stdout).toContain("table")
    expect(result.stdout).not.toContain("search-tables")
    expect(result.stdout).not.toContain("show-table")
    expect(result.stdout).not.toContain("load <datasource-id>")
    expect(result.stdout).not.toContain("create")
    expect(result.stdout).not.toContain("update")
    expect(result.stdout).not.toContain("delete")
    expect(result.stdout).not.toContain("types")
    expect(result.stdout).not.toContain("meta")
  })

  test("domain table add directly posts datasource table binding", async () => {
    const requestUrls: string[] = []
    let requestBody: unknown

    globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrls.push(String(input))
      requestBody = init?.body ? JSON.parse(String(init.body)) : null
      return jsonResponse({
        success: true,
        data: {
          datasetId: 321,
          tableName: "quick_start.rpt.rpt_transaction_lazada",
        },
      })
    }) as typeof fetch

    const result = await runAnalyticsCli([
      "analytics-agent",
      "domain",
      "table",
      "add",
      "19",
      "--datasource-id",
      "4164",
      "--workspace",
      "quick_start",
      "--schema",
      "rpt",
      "--table",
      "rpt_transaction_lazada",
    ])

    expect(result.exitCode).toBe(0)
    expect(requestUrls).toHaveLength(1)
    expect(requestUrls[0]).toContain("/open/api/v1/analytics-agent/domains/19/tables?tenantId=55")
    expect(requestBody).toEqual({
      datasourceId: 4164,
      workspace: "quick_start",
      schema: "rpt",
      tableName: "rpt_transaction_lazada",
    })
  })

  test("domain table add help does not expose old path or table-name flags", () => {
    const result = spawnSync(process.execPath, [
      "./src/main.ts",
      "analytics-agent",
      "domain",
      "table",
      "add",
      "--help",
    ], {
      cwd: process.cwd(),
      encoding: "utf-8",
    })

    expect(result.status).toBe(0)
    expect(result.stdout).toContain("--table")
    expect(result.stdout).not.toContain("--table-name")
    expect(result.stdout).not.toContain("--path")
    expect(result.stdout).not.toContain("--body")
    expect(result.stdout).not.toContain("--display-name")
    expect(result.stdout).not.toContain("--description")
  })

  test("domain table add rejects missing table before sending request", async () => {
    globalThis.fetch = mock(async () => {
      throw new Error("fetch should not be called")
    }) as typeof fetch

    const result = await runAnalyticsCli([
      "analytics-agent",
      "domain",
      "table",
      "add",
      "19",
      "--datasource-id",
      "4164",
      "--workspace",
      "manual",
      "--schema",
      "ods",
    ])

    expect(result.exitCode).toBe(2)
    expect(parseError(result.output).code).toBe("USAGE_ERROR")
  })
})
