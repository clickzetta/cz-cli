import { afterAll, afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import { spawnSync } from "node:child_process"

// Bun's mock.module registrations are process-global and outlive this file.
// Other cz-cli suites (task-condition-flow, task-merge, task-lineage, ...) are
// network-boundary tests that run the REAL modules and stub only globalThis.fetch,
// so a leftover mock here silently feeds them this file's fixture data instead —
// same failure mode integration-sync-vc.test.ts's afterAll guard documents. Import
// the real modules up front so afterAll can restore them.
const actualProfileStore = await import("../src/connection/profile-store.ts")
const actualStudioContext = await import("../src/commands/studio-context.ts")
const actualLogger = await import("../src/logger.ts")

mock.module("../src/connection/profile-store.js", () => ({
  readAgentEndpoint: () => "https://example.clickzetta.com",
}))

mock.module("../src/commands/studio-context.js", () => ({
  getProfileAgentContext: () => undefined,
  getStudioContext: async () => ({
    // Contexts carry a TokenSource now: the transport asks it per request, so
    // a fixture supplies a source rather than a token string.
    tokens: { get: async () => ({ token: "studio-token", instanceId: 11, userId: 44 }), rotate: async () => undefined },
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

// The test script also runs with --isolate (see package.json / cz-test.yml),
// which already stops a leak like this from reaching another file. This restore
// stays anyway: it is the fix for the ONE suite that actually leaked, and it is
// unconditional insurance if --isolate is ever dropped for its cost (a fresh
// global per file is slower). Two overlapping fixes for one cause, kept on
// purpose rather than by oversight.
afterAll(() => {
  mock.module("../src/connection/profile-store.js", () => actualProfileStore)
  mock.module("../src/commands/studio-context.js", () => actualStudioContext)
  mock.module("../src/logger.js", () => actualLogger)
})

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

describe("analytics-agent session delete command", () => {
  beforeEach(() => {
    process.exitCode = 0
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    process.stdout.write = originalStdoutWrite
    process.stderr.write = originalStderrWrite
    process.exitCode = 0
  })

  test("maps session id into authenticated request body", async () => {
    let requestBody: unknown

    globalThis.fetch = mock(async (_input: RequestInfo | URL, init?: RequestInit) => {
      requestBody = init?.body ? JSON.parse(String(init.body)) : null
      return jsonResponse({ success: true, data: null })
    }) as typeof fetch

    const result = await runAnalyticsCli([
      "analytics-agent",
      "session",
      "delete",
      "--session-id",
      "88",
    ])

    expect(result.exitCode).toBe(0)
    expect(requestBody).toEqual({
      sessionId: 88,
      tenantId: 55,
      userId: 44,
      loginToken: "studio-token",
    })
    expect(result.output).toContain("Session deleted (id=88).")
  })

  test("rejects missing session-id before sending request", async () => {
    globalThis.fetch = mock(async () => {
      throw new Error("fetch should not be called")
    }) as typeof fetch

    const result = await runAnalyticsCli([
      "analytics-agent",
      "session",
      "delete",
    ])

    expect(result.exitCode).toBe(2)
    const parsed = JSON.parse(result.output.trim()) as Record<string, { code: string; message: string }>
    expect(parsed.error.code).toBe("USAGE_ERROR")
    expect(parsed.error.message).toBe("Missing required argument: session-id")
  })

  test("session create output warns that follow-up questions must be serial", async () => {
    let requestBody: Record<string, unknown> | undefined

    globalThis.fetch = mock(async (_input: RequestInfo | URL, init?: RequestInit) => {
      requestBody = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined
      return jsonResponse({ success: true, data: "123" })
    }) as typeof fetch

    const result = await runAnalyticsCli([
      "analytics-agent",
      "session",
      "create",
      "--domain-id",
      "195",
      "--title",
      "销售诊断",
    ])

    expect(result.exitCode).toBe(0)
    expect(requestBody).toMatchObject({
      domainId: 195,
      title: "销售诊断",
    })
    expect(result.output).toContain("Session created (id=123)")
    expect(result.output).toContain("同一个 session 内的问答必须串行")
    expect(result.output).toContain("Another question is currently being processed")
  })

  test("session create without title uses the question as title", async () => {
    let requestBody: Record<string, unknown> | undefined

    globalThis.fetch = mock(async (_input: RequestInfo | URL, init?: RequestInit) => {
      requestBody = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined
      return jsonResponse({ success: true, data: "123" })
    }) as typeof fetch

    const result = await runAnalyticsCli([
      "analytics-agent",
      "session",
      "create",
      "--domain-id",
      "195",
      "--msg",
      " 李四一共花了多少钱 ",
    ])

    expect(result.exitCode).toBe(0)
    expect(requestBody).toMatchObject({
      domainId: 195,
      title: "李四一共花了多少钱",
    })
  })

  test("session create with blank title uses the question as title", async () => {
    let requestBody: Record<string, unknown> | undefined

    globalThis.fetch = mock(async (_input: RequestInfo | URL, init?: RequestInit) => {
      requestBody = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined
      return jsonResponse({ success: true, data: "123" })
    }) as typeof fetch

    const result = await runAnalyticsCli([
      "analytics-agent",
      "session",
      "create",
      "--domain-id",
      "195",
      "--title",
      "   ",
      "--msg",
      "张三买的是什么商品",
    ])

    expect(result.exitCode).toBe(0)
    expect(requestBody).toMatchObject({
      domainId: 195,
      title: "张三买的是什么商品",
    })
  })

  test("session create without title or question uses an agent-generated title", async () => {
    let requestBody: Record<string, unknown> | undefined

    globalThis.fetch = mock(async (_input: RequestInfo | URL, init?: RequestInit) => {
      requestBody = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined
      return jsonResponse({ success: true, data: "123" })
    }) as typeof fetch

    const result = await runAnalyticsCli([
      "analytics-agent",
      "session",
      "create",
      "--domain-id",
      "195",
    ])

    expect(result.exitCode).toBe(0)
    expect(requestBody).toMatchObject({
      domainId: 195,
      title: "Analytics Agent Session",
    })
  })

  test("session create body with blank title uses body message as title", async () => {
    let requestBody: Record<string, unknown> | undefined

    globalThis.fetch = mock(async (_input: RequestInfo | URL, init?: RequestInit) => {
      requestBody = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined
      return jsonResponse({ success: true, data: "123" })
    }) as typeof fetch

    const result = await runAnalyticsCli([
      "analytics-agent",
      "session",
      "create",
      "--domain-id",
      "195",
      "--body",
      JSON.stringify({ title: "   ", msg: "  订单趋势分析  " }),
    ])

    expect(result.exitCode).toBe(0)
    expect(requestBody).toMatchObject({
      domainId: 195,
      title: "订单趋势分析",
    })
  })

  test("session run help warns that questions in the same session must be serial", () => {
    const result = spawnSync(process.execPath, [
      "./src/main.ts",
      "analytics-agent",
      "session",
      "run",
      "--help",
    ], {
      cwd: process.cwd(),
      encoding: "utf-8",
    })

    expect(result.status).toBe(0)
    expect(result.stdout).toContain("同一个 session 内的问答必须串行")
    expect(result.stdout).toContain("Another question is currently being processed")
  })

  test("help is discoverable", () => {
    const result = spawnSync(process.execPath, [
      "./src/main.ts",
      "analytics-agent",
      "session",
      "delete",
      "--help",
    ], {
      cwd: process.cwd(),
      encoding: "utf-8",
    })

    expect(result.status).toBe(0)
    expect(result.stdout).toContain("analytics-agent session delete")
    expect(result.stdout).toContain("--session-id")
  })
})
