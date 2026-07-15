import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { writeFileSync } from "node:fs"
import { join } from "node:path"
import { onFetch, stubStudioContext } from "./support/cz-fixtures.js"

// Network-boundary test: no mock.module of our own src. The real analytics-agent command runs
// (registerAnalyticsAgentCommand → resolveAnalyticsContext → getStudioContext →
// SDK), and only the network boundary (globalThis.fetch, intercepted in preload)
// is stubbed. The analysis-agent endpoint comes from a real profiles.toml and
// the studio auth/context plumbing from stubStudioContext().

const { createCli } = await import("../src/cli.ts")
const { registerAnalyticsAgentCommand } = await import("../src/commands/analytics-agent.ts")

const originalStdoutWrite = process.stdout.write.bind(process.stdout)
const originalStderrWrite = process.stderr.write.bind(process.stderr)

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

describe("analytics-agent domain joins", () => {
  beforeEach(() => {
    process.exitCode = 0
    writeFileSync(
      join(process.env.CLICKZETTA_TEST_HOME!, ".clickzetta", "profiles.toml"),
      [
        "[profiles.test]",
        "pat = 'pat'",
        "workspace = 'wanxin_test_04'",
        "instance = 'inst'",
        "service = 'uat-api.clickzetta.com'",
        "analysis_agent_endpoint = 'https://example.clickzetta.com'",
        "",
      ].join("\n"),
    )
    stubStudioContext({ tenantId: 55 })
  })

  afterEach(() => {
    process.stdout.write = originalStdoutWrite
    process.stderr.write = originalStderrWrite
    process.exitCode = 0
  })

  test("discover calls the open API with tenantId query and domainId path", async () => {
    let requestUrl = ""
    onFetch({
      match: (url) => url.includes("/joins/discover"),
      respond: (url) => {
        requestUrl = url
        return { success: true, data: { taskId: "task-1", status: "RUNNING", joinCount: 0, joins: [] } }
      },
    })

    const result = await runAnalyticsCli([
      "analytics-agent",
      "domain",
      "joins",
      "discover",
      "--domain-id",
      "195",
    ])

    expect(result.exitCode).toBe(0)
    const url = new URL(requestUrl)
    expect(url.pathname).toBe("/open/api/v1/analytics-agent/domains/195/joins/discover")
    expect(url.searchParams.get("tenantId")).toBe("55")
    expect(parseData(result.output)).toEqual({ taskId: "task-1", status: "RUNNING" })
  })

  test("result outputs join details needed by apply", async () => {
    onFetch({
      match: (url) => url.includes("/joins/tasks/"),
      respond: () => ({
        success: true,
        data: {
          taskId: "task-1",
          status: "SUCCESS",
          joinCount: 1,
          joins: [{
            datasetId: 101,
            tableName: "orders",
            attrCode: "user_id",
            joinDatasetId: 202,
            joinTableName: "users",
            joinAttrCode: "id",
            relation: "n:1",
            ignored: "not returned",
          }],
        },
      }),
    })

    const result = await runAnalyticsCli([
      "analytics-agent",
      "domain",
      "joins",
      "result",
      "--task-id",
      "task-1",
    ])

    expect(result.exitCode).toBe(0)
    expect(parseData(result.output)).toEqual({
      taskId: "task-1",
      status: "SUCCESS",
      joinCount: 1,
      joins: [{
        datasetId: 101,
        tableName: "orders",
        attrCode: "user_id",
        joinDatasetId: 202,
        joinTableName: "users",
        joinAttrCode: "id",
        relation: "n:1",
      }],
    })
  })

  test("apply parses --join into backend body and reports submittedCount", async () => {
    let requestUrl = ""
    let requestBody: unknown
    onFetch({
      match: (url) => url.includes("/joins/apply"),
      respond: (url, _method, body) => {
        requestUrl = url
        requestBody = body ?? null
        return { success: true, data: null }
      },
    })

    const result = await runAnalyticsCli([
      "analytics-agent",
      "domain",
      "joins",
      "apply",
      "--domain-id",
      "195",
      "--join",
      "101:orders.user_id=202:users.id@n:1",
    ])

    expect(result.exitCode).toBe(0)
    const url = new URL(requestUrl)
    expect(url.pathname).toBe("/open/api/v1/analytics-agent/domains/195/joins/apply")
    expect(url.searchParams.get("tenantId")).toBe("55")
    expect(requestBody).toEqual({
      joins: [{
        datasetId: 101,
        tableName: "orders",
        attrCode: "user_id",
        joinDatasetId: 202,
        joinTableName: "users",
        joinAttrCode: "id",
        relation: "n:1",
      }],
    })
    expect(parseData(result.output)).toEqual({ submittedCount: 1, status: "ok" })
  })

  test("apply rejects invalid relation before sending request", async () => {
    onFetch({
      match: () => true,
      respond: () => {
        throw new Error("fetch should not be called")
      },
    })

    const result = await runAnalyticsCli([
      "analytics-agent",
      "domain",
      "joins",
      "apply",
      "--domain-id",
      "195",
      "--join",
      "101:orders.user_id=202:users.id@many:one",
    ])

    expect(result.exitCode).toBe(1)
    const parsed = JSON.parse(result.output.trim())
    expect(parsed.error.code).toBe("USAGE_ERROR")
    expect(parsed.error.message).toContain("relation must be one of n:1, 1:1, 1:n")
  })
})
