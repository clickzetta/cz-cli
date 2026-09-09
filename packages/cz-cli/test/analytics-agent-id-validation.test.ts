import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"

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

function parsedError(output: string): Record<string, string> {
  return (JSON.parse(output.trim()) as { error: Record<string, string> }).error
}

describe("analytics-agent id validation", () => {
  beforeEach(() => {
    process.exitCode = 0
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    process.stdout.write = originalStdoutWrite
    process.stderr.write = originalStderrWrite
    process.exitCode = 0
  })

  test("session run rejects invalid session-id instead of auto-creating a session", async () => {
    globalThis.fetch = mock(async () => {
      throw new Error("fetch should not be called")
    }) as typeof fetch

    const result = await runAnalyticsCli([
      "analytics-agent",
      "session",
      "run",
      "--session-id",
      "abc",
      "--domain-id",
      "5",
      "--msg",
      "hello",
    ])

    expect(result.exitCode).toBe(2)
    expect(parsedError(result.output).code).toBe("USAGE_ERROR")
    expect(parsedError(result.output).message).toContain("--session-id")
  })

  test("session run with a valid session-id does not require domain-id", async () => {
    let runRequestBody: Record<string, unknown> | undefined

    globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes("/open/text2insight/query")) {
        runRequestBody = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined
        return jsonResponse({ success: true, data: { questionId: 99 } })
      }
      if (url.includes("/open/safe_question_poll")) {
        return jsonResponse({ success: true, data: { responses: [{ dataType: "finish", modelRes: { data: { message: "done" } } }] } })
      }
      return jsonResponse({ success: true, data: {} })
    }) as typeof fetch

    const result = await runAnalyticsCli([
      "analytics-agent",
      "session",
      "run",
      "--session-id",
      "7",
      "--msg",
      "hello",
      "--summary",
    ])

    expect(result.exitCode).toBe(0)
    expect(runRequestBody).toMatchObject({ sessionId: 7, msg: "hello" })
    expect(runRequestBody).not.toHaveProperty("domainId")
  })

  test("metric detail rejects invalid metric-id before sending request", async () => {
    globalThis.fetch = mock(async () => {
      throw new Error("fetch should not be called")
    }) as typeof fetch

    const result = await runAnalyticsCli(["analytics-agent", "metric", "detail", "abc"])

    expect(result.exitCode).toBe(2)
    expect(parsedError(result.output).message).toContain("--metric-id")
  })

  test("domain detail rejects non-positive domain-id before building /NaN path", async () => {
    globalThis.fetch = mock(async () => {
      throw new Error("fetch should not be called")
    }) as typeof fetch

    const result = await runAnalyticsCli(["analytics-agent", "domain", "detail", "0"])

    expect(result.exitCode).toBe(2)
    expect(parsedError(result.output).message).toContain("--domain-id")
  })

  test("knowledge file upload rejects invalid space-id before reading local file", async () => {
    globalThis.fetch = mock(async () => {
      throw new Error("fetch should not be called")
    }) as typeof fetch

    const result = await runAnalyticsCli([
      "analytics-agent",
      "knowledge",
      "file",
      "upload",
      "-1",
      "./does-not-exist.txt",
    ])

    expect(result.exitCode).toBe(2)
    expect(parsedError(result.output).message).toContain("--space-id")
  })

  test("knowledge folder create allows parent-id 0 for root", async () => {
    let requestBody: Record<string, unknown> | undefined

    globalThis.fetch = mock(async (_input: RequestInfo | URL, init?: RequestInit) => {
      requestBody = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined
      return jsonResponse({ success: true, data: { id: 10 } })
    }) as typeof fetch

    const result = await runAnalyticsCli([
      "analytics-agent",
      "knowledge",
      "folder",
      "create",
      "1",
      "--parent-id",
      "0",
      "--name",
      "root-child",
    ])

    expect(result.exitCode).toBe(0)
    expect(requestBody).toMatchObject({ parentId: 0, name: "root-child" })
  })

  test("datasource create sends a direct JDBC connection", async () => {
    let requestBody: Record<string, unknown> | undefined

    globalThis.fetch = mock(async (_input: RequestInfo | URL, init?: RequestInit) => {
      requestBody = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined
      return jsonResponse({ success: true, data: { id: 9 } })
    }) as typeof fetch

    const result = await runAnalyticsCli([
      "analytics-agent",
      "datasource",
      "create",
      "--name",
      "lakehouse_ds",
      "--type",
      "lakehouse",
      "--connection-username",
      "datasource-user",
      "--connection-password",
      "datasource-password",
      "--jdbc-url",
      "jdbc:clickzetta://jnsxwfyr.uat-api.clickzetta.com/cxx_dt_test?schema=public&virtualCluster=DEFAULT",
      "--ap-vc",
      "DEFAULT",
    ])

    expect(result.exitCode).toBe(0)
    expect(requestBody).toMatchObject({
      name: "lakehouse_ds",
      type: "lakehouse",
      connection: {
        username: "datasource-user",
        password: "datasource-password",
        jdbcUrl: "jdbc:clickzetta://jnsxwfyr.uat-api.clickzetta.com/cxx_dt_test?schema=public&virtualCluster=DEFAULT",
        apVc: "DEFAULT",
      },
    })
  })

  test("datasource create builds a JDBC connection from split Lakehouse fields", async () => {
    let requestBody: Record<string, unknown> | undefined

    globalThis.fetch = mock(async (_input: RequestInfo | URL, init?: RequestInit) => {
      requestBody = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined
      return jsonResponse({ success: true, data: { id: 9 } })
    }) as typeof fetch

    const result = await runAnalyticsCli([
      "analytics-agent",
      "datasource",
      "create",
      "--name",
      "lakehouse_ds",
      "--type",
      "lakehouse",
      "--connection-username",
      "datasource-user",
      "--connection-password",
      "datasource-password",
      "--connection-service",
      "https://uat-api.clickzetta.com/api/",
      "--connection-instance",
      "jnsxwfyr",
      "--connection-workspace",
      "cxx dt/test",
      "--connection-schema",
      "sales data",
      "--connection-vcluster",
      "AP VC",
    ])

    expect(result.exitCode).toBe(0)
    expect(requestBody).toMatchObject({
      name: "lakehouse_ds",
      type: "lakehouse",
      connection: {
        username: "datasource-user",
        password: "datasource-password",
        jdbcUrl: "jdbc:clickzetta://jnsxwfyr.uat-api.clickzetta.com/api/cxx%20dt%2Ftest?schema=sales+data&virtualCluster=AP+VC",
        apVc: "AP VC",
      },
    })
  })

  test("datasource create keeps the raw --connection path compatible", async () => {
    let requestBody: Record<string, unknown> | undefined

    globalThis.fetch = mock(async (_input: RequestInfo | URL, init?: RequestInit) => {
      requestBody = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined
      return jsonResponse({ success: true, data: { id: 9 } })
    }) as typeof fetch

    const result = await runAnalyticsCli([
      "analytics-agent",
      "datasource",
      "create",
      "--name",
      "legacy_ds",
      "--type",
      "lakehouse",
      "--connection",
      '{"username":"legacy-user","password":"legacy-password","jdbcUrl":"jdbc:clickzetta://instance.service/workspace"}',
    ])

    expect(result.exitCode).toBe(0)
    expect(requestBody).toMatchObject({
      connection: {
        username: "legacy-user",
        password: "legacy-password",
        jdbcUrl: "jdbc:clickzetta://instance.service/workspace",
      },
    })
  })

  test("datasource create rejects raw and simplified connection options together", async () => {
    globalThis.fetch = mock(async () => {
      throw new Error("fetch should not be called")
    }) as typeof fetch

    const result = await runAnalyticsCli([
      "analytics-agent",
      "datasource",
      "create",
      "--connection",
      '{}',
      "--connection-username",
      "datasource-user",
      "--connection-password",
      "datasource-password",
      "--jdbc-url",
      "jdbc:clickzetta://instance.service/workspace",
    ])

    expect(result.exitCode).toBe(2)
    expect(parsedError(result.output).message).toContain("either --connection/--body")
  })

  test("datasource create rejects direct and split JDBC options together", async () => {
    globalThis.fetch = mock(async () => {
      throw new Error("fetch should not be called")
    }) as typeof fetch

    const result = await runAnalyticsCli([
      "analytics-agent",
      "datasource",
      "create",
      "--connection-username",
      "datasource-user",
      "--connection-password",
      "datasource-password",
      "--jdbc-url",
      "jdbc:clickzetta://instance.service/workspace",
      "--connection-service",
      "service",
    ])

    expect(result.exitCode).toBe(2)
    expect(parsedError(result.output).message).toContain("--jdbc-url cannot be combined")
  })

  test("datasource create rejects incomplete split Lakehouse fields", async () => {
    globalThis.fetch = mock(async () => {
      throw new Error("fetch should not be called")
    }) as typeof fetch

    const result = await runAnalyticsCli([
      "analytics-agent",
      "datasource",
      "create",
      "--connection-username",
      "datasource-user",
      "--connection-password",
      "datasource-password",
      "--connection-service",
      "service",
    ])

    expect(result.exitCode).toBe(2)
    expect(parsedError(result.output).message).toContain("--connection-instance is required")
  })

  test("datasource load validates --domain-ids as positive integers", async () => {
    let requestBody: Record<string, unknown> | undefined

    globalThis.fetch = mock(async (_input: RequestInfo | URL, init?: RequestInit) => {
      requestBody = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined
      return jsonResponse({ success: true, data: { datasetId: 12 } })
    }) as typeof fetch

    const result = await runAnalyticsCli([
      "analytics-agent",
      "datasource",
      "load",
      "3",
      "--table-name",
      "orders",
      "--domain-ids",
      "[5,6]",
    ])

    expect(result.exitCode).toBe(0)
    expect(requestBody).toMatchObject({ domainIds: [5, 6] })
  })

  test("datasource load rejects invalid --domain-ids before sending request", async () => {
    globalThis.fetch = mock(async () => {
      throw new Error("fetch should not be called")
    }) as typeof fetch

    const result = await runAnalyticsCli([
      "analytics-agent",
      "datasource",
      "load",
      "3",
      "--table-name",
      "orders",
      "--domain-ids",
      "[5,0]",
    ])

    expect(result.exitCode).toBe(2)
    expect(parsedError(result.output).message).toContain("--domain-ids")
  })

  test("datasource load defaults displayName to an explicit table name", async () => {
    let requestBody: Record<string, unknown> | undefined

    globalThis.fetch = mock(async (_input: RequestInfo | URL, init?: RequestInit) => {
      requestBody = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined
      return jsonResponse({ success: true, data: { datasetId: 12 } })
    }) as typeof fetch

    const result = await runAnalyticsCli([
      "analytics-agent",
      "datasource",
      "load",
      "3",
      "--table-name",
      "orders",
    ])

    expect(result.exitCode).toBe(0)
    expect(requestBody).toMatchObject({ tableName: "orders", displayName: "orders" })
  })

  test("datasource load extracts table name from --path", async () => {
    let requestBody: Record<string, unknown> | undefined

    globalThis.fetch = mock(async (_input: RequestInfo | URL, init?: RequestInit) => {
      requestBody = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined
      return jsonResponse({ success: true, data: { datasetId: 12 } })
    }) as typeof fetch

    const result = await runAnalyticsCli([
      "analytics-agent",
      "datasource",
      "load",
      "3",
      "--path",
      "workspace:default/schema:public/table:orders",
    ])

    expect(result.exitCode).toBe(0)
    expect(requestBody).toMatchObject({
      path: "workspace:default/schema:public/table:orders",
      tableName: "orders",
      displayName: "orders",
    })
  })

  test("domain table add extracts the path fields and defaults displayName", async () => {
    let requestBody: Record<string, unknown> | undefined

    globalThis.fetch = mock(async (_input: RequestInfo | URL, init?: RequestInit) => {
      requestBody = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined
      return jsonResponse({ success: true, data: { datasetId: 12 } })
    }) as typeof fetch

    const result = await runAnalyticsCli([
      "analytics-agent",
      "domain",
      "table",
      "add",
      "27",
      "--datasource-id",
      "3",
      "--path",
      "workspace:default/schema:public/table:orders",
    ])

    expect(result.exitCode).toBe(0)
    expect(requestBody).toMatchObject({
      workspace: "default",
      schema: "public",
      tableName: "orders",
      displayName: "orders",
    })
  })

  test("datasource load accepts the --table alias with workspace and schema", async () => {
    let requestBody: Record<string, unknown> | undefined

    globalThis.fetch = mock(async (_input: RequestInfo | URL, init?: RequestInit) => {
      requestBody = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined
      return jsonResponse({ success: true, data: { datasetId: 12 } })
    }) as typeof fetch

    const result = await runAnalyticsCli([
      "analytics-agent",
      "datasource",
      "load",
      "3",
      "--workspace",
      "default",
      "--schema",
      "public",
      "--table",
      "orders",
      "--domain-ids",
      "[5]",
    ])

    expect(result.exitCode).toBe(0)
    expect(requestBody).toMatchObject({
      path: "workspace:default/schema:public",
      tableName: "orders",
      displayName: "orders",
      domainIds: [5],
    })
  })

  test.each([
    ["datasource load", ["analytics-agent", "datasource", "load", "3"]],
    ["datasource load with a blank name", ["analytics-agent", "datasource", "load", "3", "--table-name", ""]],
    ["domain table add", ["analytics-agent", "domain", "table", "add", "27", "--datasource-id", "3"]],
    ["domain table add with a blank path name", ["analytics-agent", "domain", "table", "add", "27", "--datasource-id", "3", "--path", "workspace:default/schema:public/table:"]],
  ])("%s rejects a missing or blank table name before sending a request", async (_name, args) => {
    globalThis.fetch = mock(async () => {
      throw new Error("fetch should not be called")
    }) as typeof fetch

    const result = await runAnalyticsCli(args)

    expect(result.exitCode).toBe(2)
    expect(parsedError(result.output).message).toContain("--table-name")
  })

  test("domain table add accepts the --table alias with workspace and schema", async () => {
    let requestBody: Record<string, unknown> | undefined

    globalThis.fetch = mock(async (_input: RequestInfo | URL, init?: RequestInit) => {
      requestBody = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined
      return jsonResponse({ success: true, data: { id: 88 } })
    }) as typeof fetch

    const result = await runAnalyticsCli([
      "analytics-agent",
      "domain",
      "table",
      "add",
      "27",
      "--workspace",
      "default",
      "--schema",
      "public",
      "--table",
      "orders",
    ])

    expect(result.exitCode).toBe(0)
    expect(requestBody).toMatchObject({
      workspace: "default",
      schema: "public",
      tableName: "orders",
      displayName: "orders",
    })
  })

  test("domain joins apply rejects non-positive dataset ids in --join", async () => {
    globalThis.fetch = mock(async () => {
      throw new Error("fetch should not be called")
    }) as typeof fetch

    const result = await runAnalyticsCli([
      "analytics-agent",
      "domain",
      "joins",
      "apply",
      "--domain-id",
      "1",
      "--join",
      "0:orders.user_id=2:users.id@n:1",
    ])

    expect(result.exitCode).toBe(1)
    expect(result.output).toContain("datasetId must be a positive integer")
  })
})
