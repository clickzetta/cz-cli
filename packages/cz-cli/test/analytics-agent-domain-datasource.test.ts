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

  test("datasource load collects repeated domain-id flags into domainIds array", async () => {
    let requestBody: unknown

    globalThis.fetch = mock(async (_input: RequestInfo | URL, init?: RequestInit) => {
      requestBody = init?.body ? JSON.parse(String(init.body)) : null
      return jsonResponse({ success: true, data: { datasetId: 301 } })
    }) as typeof fetch

    const result = await runAnalyticsCli([
      "analytics-agent",
      "datasource",
      "load",
      "11",
      "--path",
      "workspace:w/schema:s",
      "--table-name",
      "orders",
      "--display-name",
      "订单表",
      "--domain-id",
      "195",
      "--domain-id",
      "196",
    ])

    expect(result.exitCode).toBe(0)
    expect(requestBody).toEqual({
      path: "workspace:w/schema:s",
      tableName: "orders",
      displayName: "订单表",
      domainIds: [195, 196],
    })
  })

  test("datasource load help no longer exposes domain-ids or body", () => {
    const result = spawnSync(process.execPath, [
      "./src/main.ts",
      "analytics-agent",
      "datasource",
      "load",
      "--help",
    ], {
      cwd: process.cwd(),
      encoding: "utf-8",
    })

    expect(result.status).toBe(0)
    expect(result.stdout).toContain("--domain-id")
    expect(result.stdout).not.toContain("--domain-ids")
    expect(result.stdout).not.toContain("--body")
  })

  test("datasource load rejects invalid domain-id before sending request", async () => {
    globalThis.fetch = mock(async () => {
      throw new Error("fetch should not be called")
    }) as typeof fetch

    const result = await runAnalyticsCli([
      "analytics-agent",
      "datasource",
      "load",
      "11",
      "--path",
      "workspace:w/schema:s",
      "--table-name",
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

  test("datasource show-table accepts browse path positional input", async () => {
    let requestUrl = ""

    globalThis.fetch = mock(async (input: RequestInfo | URL) => {
      requestUrl = String(input)
      return jsonResponse({ success: true, data: { tableName: "orders" } })
    }) as typeof fetch

    const result = await runAnalyticsCli([
      "analytics-agent",
      "datasource",
      "show-table",
      "11",
      "workspace:ws/schema:ods/table:orders",
    ])

    expect(result.exitCode).toBe(0)
    const url = new URL(requestUrl)
    expect(url.pathname).toBe("/open/api/v1/datasources/11/tables/orders")
    expect(url.searchParams.get("path")).toBe("workspace:ws/schema:ods")
  })

  test("datasource show-table rejects missing path for hierarchical datasource", async () => {
    const requestUrls: string[] = []

    globalThis.fetch = mock(async (input: RequestInfo | URL) => {
      requestUrls.push(String(input))
      return jsonResponse({
        success: true,
        data: {
          datasourceId: 11,
          browseModel: {
            levels: ["workspace", "schema", "table"],
          },
        },
      })
    }) as typeof fetch

    const result = await runAnalyticsCli([
      "analytics-agent",
      "datasource",
      "show-table",
      "11",
      "orders",
    ])

    expect(result.exitCode).toBe(1)
    expect(requestUrls).toHaveLength(1)
    expect(requestUrls[0]).toContain("/open/api/v1/datasources/11/meta?tenantId=55")
    expect(parseError(result.output)).toEqual({
      code: "USAGE_ERROR",
      message: "show-table requires --path for hierarchical datasources, or pass a browse path like workspace:.../schema:.../table:...",
    })
  })

  test("datasource search-tables rejects missing path for hierarchical datasource", async () => {
    const requestUrls: string[] = []

    globalThis.fetch = mock(async (input: RequestInfo | URL) => {
      requestUrls.push(String(input))
      return jsonResponse({
        success: true,
        data: {
          datasourceId: 11,
          browseModel: {
            levels: ["workspace", "schema", "table"],
          },
        },
      })
    }) as typeof fetch

    const result = await runAnalyticsCli([
      "analytics-agent",
      "datasource",
      "search-tables",
      "11",
      "--keyword",
      "orders",
    ])

    expect(result.exitCode).toBe(1)
    expect(requestUrls).toHaveLength(1)
    expect(parseError(result.output)).toEqual({
      code: "USAGE_ERROR",
      message: "search-tables requires --path for hierarchical datasources to avoid wide scans",
    })
  })

  test("datasource load rejects missing path for hierarchical datasource", async () => {
    const requestUrls: string[] = []

    globalThis.fetch = mock(async (input: RequestInfo | URL) => {
      requestUrls.push(String(input))
      return jsonResponse({
        success: true,
        data: {
          datasourceId: 11,
          browseModel: {
            levels: ["workspace", "schema", "table"],
          },
        },
      })
    }) as typeof fetch

    const result = await runAnalyticsCli([
      "analytics-agent",
      "datasource",
      "load",
      "11",
      "--table-name",
      "orders",
      "--domain-id",
      "195",
    ])

    expect(result.exitCode).toBe(1)
    expect(requestUrls).toHaveLength(1)
    expect(parseError(result.output)).toEqual({
      code: "USAGE_ERROR",
      message: "load requires --path for hierarchical datasources, or pass a browse path in --table-name",
    })
  })

  test("domain table add rejects short table-name and suggests the datasource full name", async () => {
    const requestUrls: string[] = []

    globalThis.fetch = mock(async (input: RequestInfo | URL) => {
      requestUrls.push(String(input))
      return jsonResponse({
        success: true,
        data: {
          datasourceId: 4164,
          workspace: "quick_start",
          schema: "rpt",
          tableName: "rpt_transaction_lazada",
          fullName: "quick_start.rpt.rpt_transaction_lazada",
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
      "--path",
      "workspace:quick_start/schema:rpt",
      "--table-name",
      "rpt_transaction_lazada",
      "--display-name",
      "Transaction - Lazada",
    ])

    expect(result.exitCode).toBe(1)
    expect(requestUrls).toHaveLength(1)
    expect(requestUrls[0]).toContain("/open/api/v1/datasources/4164/tables/rpt_transaction_lazada")
    expect(parseError(result.output)).toEqual({
      code: "USAGE_ERROR",
      message: "domain table add requires the full table name in --table-name. You passed \"rpt_transaction_lazada\", but the datasource resolved it to \"quick_start.rpt.rpt_transaction_lazada\". Please rerun with --table-name \"quick_start.rpt.rpt_transaction_lazada\".",
    })
  })

  test("domain table add rejects duplicate table already present in domain", async () => {
    const requestUrls: string[] = []

    globalThis.fetch = mock(async (input: RequestInfo | URL) => {
      requestUrls.push(String(input))
      if (requestUrls.length === 1) {
        return jsonResponse({
          success: true,
          data: {
            datasourceId: 4164,
            workspace: "quick_start",
            schema: "rpt",
            tableName: "quick_start.rpt.rpt_transaction_lazada",
            fullName: "quick_start.rpt.rpt_transaction_lazada",
          },
        })
      }

      return jsonResponse({
        success: true,
        data: {
          domainId: 19,
          tables: [
            {
              datasetId: 987,
              datasourceId: 4164,
              workspace: "quick_start",
              schema: "rpt",
              tableName: "quick_start.rpt.rpt_transaction_lazada",
              displayName: "Transaction - Lazada",
            },
          ],
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
      "--path",
      "workspace:quick_start/schema:rpt",
      "--table-name",
      "quick_start.rpt.rpt_transaction_lazada",
    ])

    expect(result.exitCode).toBe(1)
    expect(requestUrls).toHaveLength(2)
    expect(requestUrls[1]).toContain("/open/api/v1/analytics-agent/domains/19?tenantId=55&withTables=true")
    expect(parseError(result.output)).toEqual({
      code: "USAGE_ERROR",
      message: "domain 19 already contains table \"quick_start.rpt.rpt_transaction_lazada\" (datasetId: 987). Remove the existing table first or choose a different table.",
    })
  })

  test("domain table add runs prechecks then posts when full name and domain are clean", async () => {
    const requestUrls: string[] = []
    let requestBody: unknown

    globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrls.push(String(input))
      if (requestUrls.length === 1) {
        return jsonResponse({
          success: true,
          data: {
            datasourceId: 4164,
            workspace: "quick_start",
            schema: "rpt",
            tableName: "quick_start.rpt.rpt_transaction_lazada",
            fullName: "quick_start.rpt.rpt_transaction_lazada",
          },
        })
      }
      if (requestUrls.length === 2) {
        return jsonResponse({
          success: true,
          data: {
            domainId: 19,
            tables: [],
          },
        })
      }

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
      "--path",
      "workspace:quick_start/schema:rpt",
      "--table-name",
      "quick_start.rpt.rpt_transaction_lazada",
      "--display-name",
      "Transaction - Lazada",
      "--description",
      "Lazada payout/transaction report",
    ])

    expect(result.exitCode).toBe(0)
    expect(requestUrls).toHaveLength(3)
    expect(requestUrls[2]).toContain("/open/api/v1/analytics-agent/domains/19/tables?tenantId=55")
    expect(requestBody).toEqual({
      datasourceId: 4164,
      path: "workspace:quick_start/schema:rpt",
      tableName: "quick_start.rpt.rpt_transaction_lazada",
      displayName: "Transaction - Lazada",
      description: "Lazada payout/transaction report",
    })
  })
})
