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

describe("analytics-agent domain join", () => {
  beforeEach(() => {
    process.exitCode = 0
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    process.stdout.write = originalStdoutWrite
    process.stderr.write = originalStderrWrite
    process.exitCode = 0
  })

  test("list calls the join list endpoint with filters", async () => {
    let requestUrl = ""
    globalThis.fetch = mock(async (input: RequestInfo | URL) => {
      requestUrl = String(input)
      return jsonResponse({
        success: true,
        data: [{
          joinId: 301,
          domainId: 195,
          datasetId: 1773,
          attrCode: "customer_id",
          joinDatasetId: 1774,
          joinAttrCode: "id",
          relation: "n:1",
        }],
      })
    }) as typeof fetch

    const result = await runAnalyticsCli([
      "analytics-agent",
      "domain",
      "join",
      "list",
      "195",
      "--dataset-id",
      "1773",
      "--join-dataset-id",
      "1774",
      "--keyword",
      "customer",
    ])

    expect(result.exitCode).toBe(0)
    const url = new URL(requestUrl)
    expect(url.pathname).toBe("/open/api/v1/analytics-agent/domains/195/joins")
    expect(url.searchParams.get("tenantId")).toBe("55")
    expect(url.searchParams.get("datasetId")).toBe("1773")
    expect(url.searchParams.get("joinDatasetId")).toBe("1774")
    expect(url.searchParams.get("keyword")).toBe("customer")
    expect(parseData(result.output)).toEqual([{
      joinId: 301,
      domainId: 195,
      datasetId: 1773,
      attrCode: "customer_id",
      joinDatasetId: 1774,
      joinAttrCode: "id",
      relation: "n:1",
    }])
  })

  test("get calls the join detail endpoint", async () => {
    let requestUrl = ""
    globalThis.fetch = mock(async (input: RequestInfo | URL) => {
      requestUrl = String(input)
      return jsonResponse({ success: true, data: { joinId: 301, domainId: 195, relation: "1:1" } })
    }) as typeof fetch

    const result = await runAnalyticsCli(["analytics-agent", "domain", "join", "get", "195", "301"])

    expect(result.exitCode).toBe(0)
    const url = new URL(requestUrl)
    expect(url.pathname).toBe("/open/api/v1/analytics-agent/domains/195/joins/301")
    expect(url.searchParams.get("tenantId")).toBe("55")
    expect(parseData(result.output)).toEqual({ joinId: 301, domainId: 195, relation: "1:1" })
  })

  test("create sends only manual join fields", async () => {
    let requestUrl = ""
    let requestBody: unknown
    globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestBody = init?.body ? JSON.parse(String(init.body)) : null
      return jsonResponse({ success: true, data: { joinId: 301, domainId: 195 } })
    }) as typeof fetch

    const result = await runAnalyticsCli([
      "analytics-agent",
      "domain",
      "join",
      "create",
      "195",
      "--dataset-id",
      "1773",
      "--attr-code",
      "customer_id",
      "--join-dataset-id",
      "1774",
      "--join-attr-code",
      "id",
      "--relation",
      "n:1",
    ])

    expect(result.exitCode).toBe(0)
    const url = new URL(requestUrl)
    expect(url.pathname).toBe("/open/api/v1/analytics-agent/domains/195/joins")
    expect(url.searchParams.get("tenantId")).toBe("55")
    expect(requestBody).toEqual({
      datasetId: 1773,
      attrCode: "customer_id",
      joinDatasetId: 1774,
      joinAttrCode: "id",
      relation: "n:1",
    })
    expect(parseData(result.output)).toEqual({ joinId: 301, domainId: 195 })
  })

  test("create notes when the backend auto-normalizes the relation direction", async () => {
    globalThis.fetch = mock(async () => {
      // Requested n:1 but backend stores 1:n after cardinality analysis.
      return jsonResponse({ success: true, data: { joinId: 301, domainId: 195, relation: "1:n" } })
    }) as typeof fetch

    const result = await runAnalyticsCli([
      "analytics-agent", "domain", "join", "create", "195",
      "--dataset-id", "1773", "--attr-code", "customer_id",
      "--join-dataset-id", "1774", "--join-attr-code", "id",
      "--relation", "n:1",
    ])

    expect(result.exitCode).toBe(0)
    expect(result.output).toContain("auto-normalized")
    expect(result.output).toContain("n:1")
    expect(result.output).toContain("1:n")
  })

  test("create does not note when the stored relation matches the request", async () => {
    globalThis.fetch = mock(async () => {
      return jsonResponse({ success: true, data: { joinId: 301, domainId: 195, relation: "n:1" } })
    }) as typeof fetch

    const result = await runAnalyticsCli([
      "analytics-agent", "domain", "join", "create", "195",
      "--dataset-id", "1773", "--attr-code", "customer_id",
      "--join-dataset-id", "1774", "--join-attr-code", "id",
      "--relation", "n:1",
    ])

    expect(result.exitCode).toBe(0)
    expect(result.output).not.toContain("auto-normalized")
  })

  test("update sends manual join fields to the join detail endpoint", async () => {
    let requestUrl = ""
    let requestBody: unknown
    globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestBody = init?.body ? JSON.parse(String(init.body)) : null
      return jsonResponse({ success: true, data: { joinId: 301, domainId: 195, relation: "MANY_TO_ONE" } })
    }) as typeof fetch

    const result = await runAnalyticsCli([
      "analytics-agent",
      "domain",
      "join",
      "update",
      "195",
      "301",
      "--dataset-id",
      "1773",
      "--attr-code",
      "buyer_id",
      "--join-dataset-id",
      "1774",
      "--join-attr-code",
      "id",
      "--relation",
      "MANY_TO_ONE",
    ])

    expect(result.exitCode).toBe(0)
    const url = new URL(requestUrl)
    expect(url.pathname).toBe("/open/api/v1/analytics-agent/domains/195/joins/301")
    expect(url.searchParams.get("tenantId")).toBe("55")
    expect(requestBody).toEqual({
      datasetId: 1773,
      attrCode: "buyer_id",
      joinDatasetId: 1774,
      joinAttrCode: "id",
      relation: "MANY_TO_ONE",
    })
    expect(parseData(result.output)).toEqual({ joinId: 301, domainId: 195, relation: "MANY_TO_ONE" })
  })

  test("delete calls the join delete endpoint", async () => {
    let requestUrl = ""
    globalThis.fetch = mock(async (input: RequestInfo | URL) => {
      requestUrl = String(input)
      return jsonResponse({ success: true, data: { domainId: 195, joinId: 301, deleted: true } })
    }) as typeof fetch

    const result = await runAnalyticsCli(["analytics-agent", "domain", "join", "delete", "195", "301"])

    expect(result.exitCode).toBe(0)
    const url = new URL(requestUrl)
    expect(url.pathname).toBe("/open/api/v1/analytics-agent/domains/195/joins/301")
    expect(url.searchParams.get("tenantId")).toBe("55")
    expect(parseData(result.output)).toEqual({ domainId: 195, joinId: 301, deleted: true })
  })

  test("create rejects missing required manual fields before sending request", async () => {
    globalThis.fetch = mock(async () => {
      throw new Error("fetch should not be called")
    }) as typeof fetch

    const result = await runAnalyticsCli([
      "analytics-agent",
      "domain",
      "join",
      "create",
      "195",
      "--dataset-id",
      "1773",
    ])

    expect(result.exitCode).toBe(1)
    const parsed = JSON.parse(result.output.trim())
    expect(parsed.error.code).toBe("USAGE_ERROR")
    expect(parsed.error.message).toContain("--attr-code is required")
  })

  test("delete rejects invalid IDs before sending request", async () => {
    globalThis.fetch = mock(async () => {
      throw new Error("fetch should not be called")
    }) as typeof fetch

    const result = await runAnalyticsCli(["analytics-agent", "domain", "join", "delete", "0", "301"])

    expect(result.exitCode).toBe(1)
    const parsed = JSON.parse(result.output.trim())
    expect(parsed.error.code).toBe("USAGE_ERROR")
    expect(parsed.error.message).toContain("domain-id must be a positive integer")
  })
})
