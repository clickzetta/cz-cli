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
    userId: 11_000_000_657,
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

describe("analytics-agent table semantics", () => {
  beforeEach(() => {
    process.exitCode = 0
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    process.stdout.write = originalStdoutWrite
    process.stderr.write = originalStderrWrite
    process.exitCode = 0
  })

  test("list calls dataset semantics endpoint", async () => {
    let requestUrl = ""
    globalThis.fetch = mock(async (input: RequestInfo | URL) => {
      requestUrl = String(input)
      return jsonResponse({
        success: true,
        data: [{
          attrId: 31,
          datasetId: 195,
          attrCode: "order_date",
          description: "订单日期",
          semanticType: "DATE_AND_TIME",
          hidden: false,
        }],
      })
    }) as typeof fetch

    const result = await runAnalyticsCli([
      "analytics-agent",
      "table",
      "semantics",
      "list",
      "195",
    ])

    expect(result.exitCode).toBe(0)
    const url = new URL(requestUrl)
    expect(url.pathname).toBe("/open/api/v1/analytics-agent/datasets/195/semantics")
    expect(url.searchParams.get("tenantId")).toBe("55")
    expect(parseData(result.output)).toEqual([{
      attrId: 31,
      datasetId: 195,
      attrCode: "order_date",
      description: "订单日期",
      semanticType: "DATE_AND_TIME",
      hidden: false,
    }])
  })

  test("columns alias hits the same semantics endpoint as semantics list", async () => {
    let requestUrl = ""
    globalThis.fetch = mock(async (input: RequestInfo | URL) => {
      requestUrl = String(input)
      return jsonResponse({
        success: true,
        data: [{
          attrId: 31,
          datasetId: 195,
          attrCode: "order_date",
          description: "订单日期",
          semanticType: "DATE_AND_TIME",
          hidden: false,
        }],
      })
    }) as typeof fetch

    const result = await runAnalyticsCli([
      "analytics-agent",
      "table",
      "columns",
      "195",
    ])

    expect(result.exitCode).toBe(0)
    const url = new URL(requestUrl)
    expect(url.pathname).toBe("/open/api/v1/analytics-agent/datasets/195/semantics")
    expect(parseData(result.output)).toEqual([{
      attrId: 31,
      datasetId: 195,
      attrCode: "order_date",
      description: "订单日期",
      semanticType: "DATE_AND_TIME",
      hidden: false,
    }])
  })

  test("get calls dataset semantics detail endpoint", async () => {
    let requestUrl = ""
    globalThis.fetch = mock(async (input: RequestInfo | URL) => {
      requestUrl = String(input)
      return jsonResponse({
        success: true,
        data: {
          attrId: 31,
          datasetId: 195,
          attrCode: "order_date",
          alias: ["订单日期"],
          description: "订单日期",
          semanticType: "DATE_AND_TIME",
          semanticTypeProperties: { dataFormat: "yyyy-MM-dd" },
          intendedTypes: ["DIM", "FILTER"],
        },
      })
    }) as typeof fetch

    const result = await runAnalyticsCli([
      "analytics-agent",
      "table",
      "semantics",
      "get",
      "195",
      "31",
    ])

    expect(result.exitCode).toBe(0)
    const url = new URL(requestUrl)
    expect(url.pathname).toBe("/open/api/v1/analytics-agent/datasets/195/semantics/31")
    expect(parseData(result.output)).toEqual({
      attrId: 31,
      datasetId: 195,
      attrCode: "order_date",
      alias: ["订单日期"],
      description: "订单日期",
      semanticType: "DATE_AND_TIME",
      semanticTypeProperties: { dataFormat: "yyyy-MM-dd" },
      intendedTypes: ["DIM", "FILTER"],
    })
  })

  test("set sends structured semantics update body", async () => {
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
          attrCode: "order_date",
          description: "订单日期",
          semanticType: "DATE_AND_TIME",
          semanticTypeProperties: { dataFormat: "yyyy-MM-dd" },
          intendedTypes: ["DIM", "FILTER"],
        },
      })
    }) as typeof fetch

    const result = await runAnalyticsCli([
      "analytics-agent",
      "table",
      "semantics",
      "set",
      "195",
      "31",
      "--alias",
      "订单日期",
      "--alias",
      "下单日期",
      "--description",
      "订单日期",
      "--semantic-type",
      "DATE_AND_TIME",
      "--intended-type",
      "DIM",
      "--intended-type",
      "FILTER",
    ])

    expect(result.exitCode).toBe(0)
    const url = new URL(requestUrl)
    expect(url.pathname).toBe("/open/api/v1/analytics-agent/datasets/195/semantics/31")
    expect(requestBody).toEqual({
      alias: ["订单日期", "下单日期"],
      description: "订单日期",
      semanticType: "DATE_AND_TIME",
      intendedTypes: ["DIM", "FILTER"],
    })
  })

  test("set rejects empty update body before sending request", async () => {
    globalThis.fetch = mock(async () => {
      throw new Error("fetch should not be called")
    }) as typeof fetch

    const result = await runAnalyticsCli([
      "analytics-agent",
      "table",
      "semantics",
      "set",
      "195",
      "31",
    ])

    expect(result.exitCode).toBe(1)
    const parsed = JSON.parse(result.output.trim())
    expect(parsed.error.code).toBe("USAGE_ERROR")
    expect(parsed.error.message).toContain("At least one semantics field is required")
  })

  test("prop parses boolean value before sending request", async () => {
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
          attrCode: "order_date",
          hidden: true,
        },
      })
    }) as typeof fetch

    const result = await runAnalyticsCli([
      "analytics-agent",
      "table",
      "semantics",
      "prop",
      "195",
      "31",
      "hidden",
      "true",
    ])

    expect(result.exitCode).toBe(0)
    const url = new URL(requestUrl)
    expect(url.pathname).toBe("/open/api/v1/analytics-agent/datasets/195/semantics/31/prop")
    expect(requestBody).toEqual({
      property: "hidden",
      value: true,
    })
  })

  test("prop parses array JSON value before sending request", async () => {
    let requestBody: unknown
    globalThis.fetch = mock(async (_input: RequestInfo | URL, init?: RequestInit) => {
      requestBody = init?.body ? JSON.parse(String(init.body)) : null
      return jsonResponse({
        success: true,
        data: {
          attrId: 31,
          datasetId: 195,
          attrCode: "order_date",
          intendedTypes: ["DIM", "FILTER"],
        },
      })
    }) as typeof fetch

    const result = await runAnalyticsCli([
      "analytics-agent",
      "table",
      "semantics",
      "prop",
      "195",
      "31",
      "intendedTypes",
      "[\"DIM\",\"FILTER\"]",
    ])

    expect(result.exitCode).toBe(0)
    expect(requestBody).toEqual({
      property: "intendedTypes",
      value: ["DIM", "FILTER"],
    })
  })

  test("prop rejects invalid dataset-id before sending request", async () => {
    globalThis.fetch = mock(async () => {
      throw new Error("fetch should not be called")
    }) as typeof fetch

    const result = await runAnalyticsCli([
      "analytics-agent",
      "table",
      "semantics",
      "prop",
      "abc",
      "31",
      "hidden",
      "true",
    ])

    expect(result.exitCode).toBe(1)
    const parsed = JSON.parse(result.output.trim()) as Record<string, any>
    expect(parsed.error.code).toBe("USAGE_ERROR")
    expect(parsed.error.message).toBe("--dataset-id must be a positive integer")
  })

  test("prop rejects invalid attr-id before sending request", async () => {
    globalThis.fetch = mock(async () => {
      throw new Error("fetch should not be called")
    }) as typeof fetch

    const result = await runAnalyticsCli([
      "analytics-agent",
      "table",
      "semantics",
      "prop",
      "195",
      "abc",
      "hidden",
      "true",
    ])

    expect(result.exitCode).toBe(1)
    const parsed = JSON.parse(result.output.trim()) as Record<string, any>
    expect(parsed.error.code).toBe("USAGE_ERROR")
    expect(parsed.error.message).toBe("--attr-id must be a positive integer")
  })

  test("update does a read-modify-write: fetches detail then posts full object with new displayName", async () => {
    const calls: Array<{ url: string; method: string; body: unknown }> = []
    globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      calls.push({ url, method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : null })
      if (url.includes("/dataset/detail")) {
        return jsonResponse({
          success: true,
          data: {
            id: "82", datasetId: "82", sourceId: "8448", mode: 1,
            displayName: "old_name", tableName: "quick_start.construction_dw.v_gpt_fact_bid",
            description: "keep me", completeSchema: [{ name: "c1" }], joins: [],
            workspace: "quick_start", namespace: "construction_dw",
          },
        })
      }
      return jsonResponse({ success: true, data: { datasetId: "82", displayName: "投标事实表" } })
    }) as typeof fetch

    const result = await runAnalyticsCli([
      "analytics-agent", "table", "update", "82", "--name", "投标事实表",
    ])

    expect(result.exitCode).toBe(0)
    const detailCall = calls.find((c) => c.url.includes("/dataset/detail"))
    const updateCall = calls.find((c) => c.url.includes("/dataset/update"))
    expect(detailCall).toBeDefined()
    expect(new URL(detailCall!.url).searchParams.get("datasetId")).toBe("82")
    expect(updateCall).toBeDefined()
    // The update body must carry the full object with only displayName changed.
    const body = updateCall!.body as Record<string, unknown>
    expect(body.displayName).toBe("投标事实表")
    expect(body.description).toBe("keep me")
    expect(body.tableName).toBe("quick_start.construction_dw.v_gpt_fact_bid")
    expect(body.completeSchema).toEqual([{ name: "c1" }])
  })

  test("update can set displayName and description together", async () => {
    let updateBody: Record<string, unknown> | null = null
    globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes("/dataset/detail")) {
        return jsonResponse({ success: true, data: { id: "82", datasetId: "82", displayName: "old", description: "olddesc", tableName: "t" } })
      }
      updateBody = init?.body ? JSON.parse(String(init.body)) : null
      return jsonResponse({ success: true, data: { datasetId: "82" } })
    }) as typeof fetch

    const result = await runAnalyticsCli([
      "analytics-agent", "table", "update", "82", "--name", "新名", "--description", "新描述",
    ])

    expect(result.exitCode).toBe(0)
    expect((updateBody as Record<string, unknown>).displayName).toBe("新名")
    expect((updateBody as Record<string, unknown>).description).toBe("新描述")
  })

  test("update with only --description leaves displayName untouched", async () => {
    let updateBody: Record<string, unknown> | null = null
    globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes("/dataset/detail")) {
        return jsonResponse({ success: true, data: { id: "82", datasetId: "82", displayName: "keepname", description: "olddesc", tableName: "t" } })
      }
      updateBody = init?.body ? JSON.parse(String(init.body)) : null
      return jsonResponse({ success: true, data: { datasetId: "82" } })
    }) as typeof fetch

    const result = await runAnalyticsCli([
      "analytics-agent", "table", "update", "82", "--description", "只改描述",
    ])

    expect(result.exitCode).toBe(0)
    expect((updateBody as Record<string, unknown>).displayName).toBe("keepname")
    expect((updateBody as Record<string, unknown>).description).toBe("只改描述")
  })

  test("update rejects when neither --name nor --description is given", async () => {
    globalThis.fetch = mock(async () => {
      throw new Error("fetch should not be called")
    }) as typeof fetch

    const result = await runAnalyticsCli([
      "analytics-agent", "table", "update", "82",
    ])

    expect(result.exitCode).toBe(1)
    const parsed = JSON.parse(result.output.trim()) as Record<string, any>
    expect(parsed.error.code).toBe("USAGE_ERROR")
  })

  test("update rejects an empty --name before any request", async () => {
    globalThis.fetch = mock(async () => {
      throw new Error("fetch should not be called")
    }) as typeof fetch

    const result = await runAnalyticsCli([
      "analytics-agent", "table", "update", "82", "--name", "   ",
    ])

    expect(result.exitCode).toBe(1)
    const parsed = JSON.parse(result.output.trim()) as Record<string, any>
    expect(parsed.error.code).toBe("USAGE_ERROR")
  })
})
