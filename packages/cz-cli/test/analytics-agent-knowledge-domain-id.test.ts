import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import { writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

// Keep every other profile-store export real: analytics-agent now reaches
// connection/config.ts, which imports more of this module, and a partial mock
// would break its import with a missing-export SyntaxError.
const realProfileStore = await import("../src/connection/profile-store.js")
mock.module("../src/connection/profile-store.js", () => ({
  ...realProfileStore,
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

const originalStdoutWrite = process.stdout.write.bind(process.stdout)
const originalStderrWrite = process.stderr.write.bind(process.stderr)
const originalFetch = globalThis.fetch

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

describe("analytics-agent knowledge domain-ids conversion", () => {
  beforeEach(() => {
    process.exitCode = 0
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    process.stdout.write = originalStdoutWrite
    process.stderr.write = originalStderrWrite
    process.exitCode = 0
  })

  test("knowledge create maps --domain-ids into domainIds", async () => {
    let requestBody: Record<string, unknown> | undefined

    globalThis.fetch = mock(async (_input: RequestInfo | URL, init?: RequestInit) => {
      requestBody = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined
      return jsonResponse({ success: true, data: "123" })
    }) as typeof fetch

    const result = await runAnalyticsCli([
      "analytics-agent",
      "knowledge",
      "create",
      "--domain-ids",
      "[5]",
      "--content",
      "hello",
      "--body",
      JSON.stringify({
        aliases: ["body-alias"],
        domainIds: [9],
      }),
    ])

    expect(result.exitCode).toBe(0)
    expect(requestBody).toMatchObject({
      aliases: ["body-alias"],
      content: "hello",
      domainIds: [5],
    })
  })

  test("knowledge create maps multiple --domain-ids into domainIds", async () => {
    let requestBody: Record<string, unknown> | undefined

    globalThis.fetch = mock(async (_input: RequestInfo | URL, init?: RequestInit) => {
      requestBody = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined
      return jsonResponse({ success: true, data: "123" })
    }) as typeof fetch

    const result = await runAnalyticsCli([
      "analytics-agent",
      "knowledge",
      "create",
      "--domain-ids",
      "[5,6]",
      "--content",
      "hello",
      "--body",
      JSON.stringify({ domainIds: [9] }),
    ])

    expect(result.exitCode).toBe(0)
    expect(requestBody).toMatchObject({
      content: "hello",
      domainIds: [5, 6],
    })
  })

  test("knowledge update maps --domain-ids into domainIds", async () => {
    let requestBody: Record<string, unknown> | undefined

    globalThis.fetch = mock(async (_input: RequestInfo | URL, init?: RequestInit) => {
      requestBody = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined
      return jsonResponse({ success: true, data: "123" })
    }) as typeof fetch

    const result = await runAnalyticsCli([
      "analytics-agent",
      "knowledge",
      "update",
      "42",
      "--domain-ids",
      "[5]",
      "--body",
      JSON.stringify({
        content: "body-content",
        domainIds: [9],
      }),
    ])

    expect(result.exitCode).toBe(0)
    expect(requestBody).toMatchObject({
      content: "body-content",
      domainIds: [5],
    })
  })

  test("knowledge create rejects missing --domain-ids", async () => {
    globalThis.fetch = mock(async () => {
      throw new Error("fetch should not be called")
    }) as typeof fetch

    const result = await runAnalyticsCli([
      "analytics-agent",
      "knowledge",
      "create",
      "--content",
      "hello",
    ])

    expect(result.exitCode).toBe(2)
    const parsed = JSON.parse(result.output.trim()) as Record<string, { code: string; message: string }>
    expect(parsed.error.code).toBe("USAGE_ERROR")
    expect(parsed.error.message).toContain("domain-ids")
  })

  test("knowledge create rejects invalid --domain-ids before sending request", async () => {
    globalThis.fetch = mock(async () => {
      throw new Error("fetch should not be called")
    }) as typeof fetch

    const result = await runAnalyticsCli([
      "analytics-agent",
      "knowledge",
      "create",
      "--domain-ids",
      "abc",
      "--content",
      "hello",
    ])

    expect(result.exitCode).toBe(2)
    const parsed = JSON.parse(result.output.trim()) as Record<string, { code: string; message: string }>
    expect(parsed.error.code).toBe("USAGE_ERROR")
    expect(parsed.error.message).toContain("--domain-ids")
  })

  test("metric create maps --domain-ids into domainIds", async () => {
    let requestBody: Record<string, unknown> | undefined

    globalThis.fetch = mock(async (_input: RequestInfo | URL, init?: RequestInit) => {
      requestBody = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined
      return jsonResponse({ success: true, data: "123" })
    }) as typeof fetch

    const result = await runAnalyticsCli([
      "analytics-agent",
      "metric",
      "create",
      "--domain-ids",
      "[5,6]",
      "--datasource-id",
      "8",
      "--table-name",
      "orders",
      "--name",
      "total",
      "--expression",
      "count(1)",
      "--body",
      JSON.stringify({ domainIds: [9] }),
    ])

    expect(result.exitCode).toBe(0)
    expect(requestBody).toMatchObject({
      datasourceId: 8,
      tableName: "orders",
      names: ["total"],
      aggExpr: "count(1)",
      domainIds: [5, 6],
    })
  })

  test("metric create rejects invalid --domain-ids before sending request", async () => {
    globalThis.fetch = mock(async () => {
      throw new Error("fetch should not be called")
    }) as typeof fetch

    const result = await runAnalyticsCli([
      "analytics-agent",
      "metric",
      "create",
      "--domain-ids",
      "0",
      "--datasource-id",
      "8",
      "--table-name",
      "orders",
      "--name",
      "total",
      "--expression",
      "count(1)",
    ])

    expect(result.exitCode).toBe(2)
    const parsed = JSON.parse(result.output.trim()) as Record<string, { code: string; message: string }>
    expect(parsed.error.code).toBe("USAGE_ERROR")
    expect(parsed.error.message).toContain("--domain-ids")
  })

  test("answer-builder list maps --domain-ids into domainIds", async () => {
    let requestBody: Record<string, unknown> | undefined

    globalThis.fetch = mock(async (_input: RequestInfo | URL, init?: RequestInit) => {
      requestBody = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined
      return jsonResponse({ success: true, data: [] })
    }) as typeof fetch

    const result = await runAnalyticsCli([
      "analytics-agent",
      "answer-builder",
      "list",
      "--domain-ids",
      "[5,6]",
      "--body",
      JSON.stringify({ domainIds: [9] }),
    ])

    expect(result.exitCode).toBe(0)
    expect(requestBody).toMatchObject({
      domainIds: [5, 6],
    })
  })

  test("answer-builder list rejects invalid --domain-ids before sending request", async () => {
    globalThis.fetch = mock(async () => {
      throw new Error("fetch should not be called")
    }) as typeof fetch

    const result = await runAnalyticsCli([
      "analytics-agent",
      "answer-builder",
      "list",
      "--domain-ids",
      "abc",
    ])

    expect(result.exitCode).toBe(2)
    const parsed = JSON.parse(result.output.trim()) as Record<string, { code: string; message: string }>
    expect(parsed.error.code).toBe("USAGE_ERROR")
    expect(parsed.error.message).toContain("--domain-ids")
  })

  test("knowledge file upload maps --domain-ids into upload domainIds", async () => {
    let uploadRequestBody: Record<string, unknown> | undefined
    const localFile = join(tmpdir(), `cz-cli-knowledge-${Date.now()}.txt`)
    writeFileSync(localFile, "hello")

    globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes("/nodes/by-path")) {
        return jsonResponse({ success: true, data: { found: false } })
      }
      if (url.includes("/nodes/upload-url")) {
        uploadRequestBody = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined
        return jsonResponse({ success: true, data: { uploadUrl: "https://upload.example/file", nodeId: 77 } })
      }
      if (url === "https://upload.example/file") {
        return new Response("", { status: 200 })
      }
      if (url.includes("/upload-complete")) {
        return jsonResponse({ success: true, data: { asyncTaskId: 88 } })
      }
      return jsonResponse({ success: true, data: {} })
    }) as typeof fetch

    const result = await runAnalyticsCli([
      "analytics-agent",
      "knowledge",
      "file",
      "upload",
      "1",
      localFile,
      "--domain-ids",
      "[5,6]",
    ])

    expect(result.exitCode).toBe(0)
    expect(uploadRequestBody).toMatchObject({
      domainIds: [5, 6],
    })
  })

  test("knowledge file upload rejects invalid --domain-ids before sending request", async () => {
    const localFile = join(tmpdir(), `cz-cli-knowledge-${Date.now()}-dangling.txt`)
    writeFileSync(localFile, "hello")
    globalThis.fetch = mock(async () => {
      throw new Error("fetch should not be called")
    }) as typeof fetch

    const result = await runAnalyticsCli([
      "analytics-agent",
      "knowledge",
      "file",
      "upload",
      "1",
      localFile,
      "--domain-ids",
      "abc",
    ])

    expect(result.exitCode).toBe(2)
    const parsed = JSON.parse(result.output.trim()) as Record<string, { code: string; message: string }>
    expect(parsed.error.code).toBe("USAGE_ERROR")
    expect(parsed.error.message).toContain("--domain-ids")
  })

  test("knowledge folder sort maps --nodeIds JSON array into nodeIds", async () => {
    let requestBody: Record<string, unknown> | undefined

    globalThis.fetch = mock(async (_input: RequestInfo | URL, init?: RequestInit) => {
      requestBody = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined
      return jsonResponse({ success: true, data: {} })
    }) as typeof fetch

    const result = await runAnalyticsCli([
      "analytics-agent",
      "knowledge",
      "folder",
      "sort",
      "1",
      "--parent-id",
      "0",
      "--nodeIds",
      "[1,2]",
    ])

    expect(result.exitCode).toBe(0)
    expect(requestBody).toMatchObject({
      parentId: 0,
      nodeIds: [1, 2],
    })
  })

  test("knowledge folder sort rejects repeated --node-id", async () => {
    globalThis.fetch = mock(async () => {
      throw new Error("fetch should not be called")
    }) as typeof fetch

    const result = await runAnalyticsCli([
      "analytics-agent",
      "knowledge",
      "folder",
      "sort",
      "1",
      "--parent-id",
      "0",
      "--node-id",
      "1",
      "--node-id",
      "2",
    ])

    expect(result.exitCode).not.toBe(0)
    expect(result.output).toContain("nodeIds")
  })

  test("knowledge folder rename uses explicit name", async () => {
    let requestBody: Record<string, unknown> | undefined

    globalThis.fetch = mock(async (_input: RequestInfo | URL, init?: RequestInit) => {
      requestBody = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined
      return jsonResponse({ success: true, data: {} })
    }) as typeof fetch

    const result = await runAnalyticsCli([
      "analytics-agent",
      "knowledge",
      "folder",
      "rename",
      "1",
      "2",
      "--name",
      "new-folder",
    ])

    expect(result.exitCode).toBe(0)
    expect(requestBody).toMatchObject({ name: "new-folder" })
  })
})
