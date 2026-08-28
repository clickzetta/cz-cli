import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { writeFileSync } from "node:fs"
import { join } from "node:path"
import { onFetch, onStudio, stubStudioContext } from "./support/cz-fixtures.js"

// Network-boundary test: no mock.module of our own src. The real analytics-agent session run
// command runs (registerAnalyticsAgentCommand → resolveAnalyticsContext →
// getStudioContext → SDK), and only the network boundary (globalThis.fetch,
// intercepted in preload) is stubbed. The analysis-agent endpoint comes from a
// real profiles.toml and the studio auth/context plumbing from stubStudioContext().

const { createCli } = await import("../src/cli.ts")
const { registerAnalyticsAgentCommand } = await import("../src/commands/analytics-agent.ts")

const originalStdoutWrite = process.stdout.write.bind(process.stdout)
const originalStderrWrite = process.stderr.write.bind(process.stderr)

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

describe("analytics-agent session run", () => {
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
    stubStudioContext()
  })

  afterEach(() => {
    process.stdout.write = originalStdoutWrite
    process.stderr.write = originalStderrWrite
    process.exitCode = 0
  })

  test("outputs the raw safe_question_poll payload by default", async () => {
    const pollPayload = {
      success: true,
      data: {
        questionId: 123,
        responses: [
          {
            resGroupId: 1,
            dataType: "thinking",
            modelRes: { data: { message: "step 1" } },
          },
          {
            resGroupId: 1,
            dataType: "summary",
            modelRes: { data: { message: "final answer" } },
          },
          {
            resGroupId: 1,
            dataType: "finish",
            modelRes: { data: { message: "done" } },
          },
        ],
      },
    }

    onStudio("/open/text2insight/query", () => ({ data: { questionId: 123 } }))
    onStudio("/open/safe_question_poll", () => pollPayload)

    const result = await runAnalyticsCli([
      "analytics-agent",
      "session",
      "run",
      "--session-id",
      "7",
      "--msg",
      "hello",
    ])

    expect(result.exitCode).toBe(0)
    expect(JSON.parse(result.output.trim())).toMatchObject({
      ...pollPayload,
      ai_message: expect.stringContaining("同一个 session 内的问答必须串行"),
    })
  })

  test("shows the final-summary output when --summary is set", async () => {
    onStudio("/open/text2insight/query", () => ({ data: { questionId: 123 } }))
    onStudio("/open/safe_question_poll", () => ({
      success: true,
      data: {
        questionId: 123,
        responses: [
          {
            resGroupId: 1,
            dataType: "summary",
            modelRes: { data: { message: "final answer" } },
          },
          {
            resGroupId: 1,
            dataType: "finish",
            modelRes: { data: { message: "done" } },
          },
        ],
      },
    }))

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
    expect(result.output).toContain("final answer")
    expect(result.output).toContain("同一个 session 内的问答必须串行")
    expect(result.output).toContain("Another question is currently being processed")
  })

  test("uses the first question as title when auto-creating a session", async () => {
    let createBody: Record<string, unknown> | undefined

    onStudio("/open/session/safe_new", (body) => {
      createBody = body as Record<string, unknown>
      return "7"
    })
    onStudio("/open/text2insight/query", () => ({ data: { questionId: 123 } }))
    onStudio("/open/safe_question_poll", () => ({
      success: true,
      data: {
        questionId: 123,
        responses: [
          {
            resGroupId: 1,
            dataType: "finish",
            modelRes: { data: { message: "done" } },
          },
        ],
      },
    }))

    const result = await runAnalyticsCli([
      "analytics-agent",
      "session",
      "run",
      "--domain-id",
      "195",
      "--msg",
      " 张三买了什么商品 ",
    ])

    expect(result.exitCode).toBe(0)
    expect(createBody).toMatchObject({
      domainId: 195,
      title: "张三买了什么商品",
    })
  })

  test("fails before auto-creating a session when no title or question is available", async () => {
    const result = await runAnalyticsCli([
      "analytics-agent",
      "session",
      "run",
      "--domain-id",
      "195",
    ])

    expect(result.exitCode).toBe(2)
    const parsed = JSON.parse(result.output.trim()) as Record<string, { code: string; message: string }>
    expect(parsed.error.code).toBe("USAGE_ERROR")
    expect(parsed.error.message).toContain("Pass --msg")
  })

  test("uses body message as title when auto-creating a session", async () => {
    let createBody: Record<string, unknown> | undefined
    let runBody: Record<string, unknown> | undefined

    onStudio("/open/session/safe_new", (body) => {
      createBody = body as Record<string, unknown>
      return "7"
    })
    onStudio("/open/text2insight/query", (body) => {
      runBody = body as Record<string, unknown>
      return { data: { questionId: 123 } }
    })
    onStudio("/open/safe_question_poll", () => ({
      success: true,
      data: {
        questionId: 123,
        responses: [
          {
            resGroupId: 1,
            dataType: "finish",
            modelRes: { data: { message: "done" } },
          },
        ],
      },
    }))

    const result = await runAnalyticsCli([
      "analytics-agent",
      "session",
      "run",
      "--domain-id",
      "195",
      "--body",
      JSON.stringify({ msg: "  客单价是多少  " }),
    ])

    expect(result.exitCode).toBe(0)
    expect(createBody).toMatchObject({
      domainId: 195,
      title: "客单价是多少",
    })
    expect(runBody).toMatchObject({
      sessionId: 7,
      msg: "  客单价是多少  ",
    })
  })

  test("refreshes the SDK token once when the Analytics Agent returns 401", async () => {
    let requests = 0
    onFetch({
      match: (url) => url.includes("/open/api/v1/analytics-agent/datagpt/enabled"),
      respond: () => {
        requests += 1
        if (requests === 1) return new Response(JSON.stringify({ code: "401", message: "token expired" }), { status: 401 })
        return { success: true, data: true }
      },
    })

    const result = await runAnalyticsCli(["analytics-agent", "service", "enabled"])

    expect(result.exitCode).toBe(0)
    expect(requests).toBe(2)
    expect(JSON.parse(result.output.trim()).data).toBe(true)
  })

  test("falls back from an expired legacy agent token to the profile OAuth session", async () => {
    writeFileSync(
      join(process.env.CLICKZETTA_TEST_HOME!, ".clickzetta", "profiles.toml"),
      [
        "[oauth.session]",
        "access_token = 'old-oauth-token'",
        "refresh_token = 'refresh-token'",
        "expire_time_ms = 3600000",
        `obtained_at = ${Date.now() - 3600000}`,
        "instance_id = 11",
        "user_id = 44",
        "issuer = 'issuer.example.com'",
        "",
        "[profiles.test]",
        "oauth = 'session'",
        "workspace = 'wanxin_test_04'",
        "instance = 'inst'",
        "service = 'uat-api.clickzetta.com'",
        "analysis_agent_endpoint = 'https://example.clickzetta.com'",
        "",
        "[profiles.test.agent]",
        "token = 'expired-agent-token'",
        "user_id = 44",
        "tenant_id = 55",
        "instance_id = 11",
        "",
      ].join("\n"),
    )

    onFetch({
      match: (url) => url.includes("/clickzetta-hornhub/oauth2/token"),
      respond: () => ({
        access_token: "fresh-oauth-token",
        refresh_token: "rotated-refresh-token",
        token_type: "Bearer",
        expires_in: 3600,
      }),
    })
    let requests = 0
    let secondToken: string | undefined
    const urls: string[] = []
    onFetch({
      match: (url) => url.includes("/open/api/v1/analytics-agent/datagpt/enabled"),
      respond: (url, _method, _body, headers) => {
        requests += 1
        urls.push(url)
        if (requests === 2) secondToken = headers["x-clickzetta-token"]
        if (requests === 1) return new Response(JSON.stringify({ message: "token expired" }), { status: 401 })
        return { success: true, data: true }
      },
    })

    const result = await runAnalyticsCli(["analytics-agent", "service", "enabled"])

    expect(result.exitCode).toBe(0)
    expect(requests).toBe(2)
    expect(secondToken).toBe("fresh-oauth-token")
    // The refresh swaps identity, so the retry's tenant must come from the new
    // context — in the query string too, not just the headers.
    expect(new URL(urls[0]!).searchParams.get("tenantId")).toBe("55")
    expect(new URL(urls[1]!).searchParams.get("tenantId")).toBe("10")
  })

  test("an expired agent token falls back without rotating a still-valid OAuth session", async () => {
    writeFileSync(
      join(process.env.CLICKZETTA_TEST_HOME!, ".clickzetta", "profiles.toml"),
      [
        "[oauth.session]",
        "access_token = 'live-oauth-token'",
        "refresh_token = 'refresh-token'",
        "expire_time_ms = 3600000",
        `obtained_at = ${Date.now()}`,
        "instance_id = 11",
        "user_id = 44",
        "issuer = 'issuer.example.com'",
        "",
        "[profiles.test]",
        "oauth = 'session'",
        "workspace = 'wanxin_test_04'",
        "instance = 'inst'",
        "service = 'uat-api.clickzetta.com'",
        "analysis_agent_endpoint = 'https://example.clickzetta.com'",
        "",
        "[profiles.test.agent]",
        "token = 'expired-agent-token'",
        "user_id = 44",
        "tenant_id = 55",
        "instance_id = 11",
        "",
      ].join("\n"),
    )

    let rotations = 0
    onFetch({
      match: (url) => url.includes("/clickzetta-hornhub/oauth2/token"),
      respond: () => {
        rotations += 1
        return { access_token: "rotated", token_type: "Bearer", expires_in: 3600 }
      },
    })
    let requests = 0
    let secondToken: string | undefined
    onFetch({
      match: (url) => url.includes("/open/api/v1/analytics-agent/datagpt/enabled"),
      respond: (_url, _method, _body, headers) => {
        requests += 1
        if (requests === 2) secondToken = headers["x-clickzetta-token"]
        if (requests === 1) return new Response(JSON.stringify({ message: "token expired" }), { status: 401 })
        return { success: true, data: true }
      },
    })

    const result = await runAnalyticsCli(["analytics-agent", "service", "enabled"])

    expect(result.exitCode).toBe(0)
    expect(requests).toBe(2)
    // The [agent] token is not the SDK's credential, so the remedy is to
    // authenticate as the profile does — the unexpired OAuth token is reused and
    // the refresh token must not be spent replacing a token that still works.
    expect(secondToken).toBe("live-oauth-token")
    expect(rotations).toBe(0)
  })

  test("abandons a batch flow instead of finishing it under the refreshed tenant", async () => {
    writeFileSync(
      join(process.env.CLICKZETTA_TEST_HOME!, ".clickzetta", "profiles.toml"),
      [
        "[oauth.session]",
        "access_token = 'old-oauth-token'",
        "refresh_token = 'refresh-token'",
        "expire_time_ms = 3600000",
        `obtained_at = ${Date.now() - 3600000}`,
        "instance_id = 11",
        "user_id = 44",
        "issuer = 'issuer.example.com'",
        "",
        "[profiles.test]",
        "oauth = 'session'",
        "workspace = 'wanxin_test_04'",
        "instance = 'inst'",
        "service = 'uat-api.clickzetta.com'",
        "analysis_agent_endpoint = 'https://example.clickzetta.com'",
        "",
        "[profiles.test.agent]",
        "token = 'expired-agent-token'",
        "user_id = 44",
        "tenant_id = 55",
        "instance_id = 11",
        "",
      ].join("\n"),
    )

    onFetch({
      match: (url) => url.includes("/clickzetta-hornhub/oauth2/token"),
      respond: () => ({
        access_token: "fresh-oauth-token",
        refresh_token: "rotated-refresh-token",
        token_type: "Bearer",
        expires_in: 3600,
      }),
    })
    // The catalog is enumerated under the [agent] tenant (55).
    onStudio("/open/api/v1/analytics-agent/metrics/list", () => [
      { id: 1, names: ["m1"], status: "ENABLE" },
      { id: 2, names: ["m2"], status: "ENABLE" },
      { id: 3, names: ["m3"], status: "ENABLE" },
    ])
    const disableTenants: (string | null)[] = []
    onFetch({
      match: (url) => url.includes("/open/api/v1/analytics-agent/metrics/disable"),
      respond: (url) => {
        disableTenants.push(new URL(url).searchParams.get("tenantId"))
        return new Response(JSON.stringify({ message: "token expired" }), { status: 401 })
      },
    })

    const result = await runAnalyticsCli([
      "analytics-agent",
      "metric",
      "disable",
      "--all",
      "--domain-id",
      "195",
    ])

    // Only the first target reaches the wire. The refresh moves the session to
    // tenant 10, which does not own ids enumerated from tenant 55, so the whole
    // context is abandoned — the per-target catch must not carry the batch on.
    expect(disableTenants).toEqual(["55"])
    expect(result.output).toContain("tenant 10")
    expect(result.exitCode).not.toBe(0)
  })

  test("a profile with no refreshable credential fails the 401 immediately", () => {
    writeFileSync(
      join(process.env.CLICKZETTA_TEST_HOME!, ".clickzetta", "profiles.toml"),
      [
        "[profiles.test]",
        "workspace = 'wanxin_test_04'",
        "instance = 'inst'",
        "service = 'uat-api.clickzetta.com'",
        "analysis_agent_endpoint = 'https://example.clickzetta.com'",
        "",
        "[profiles.test.agent]",
        "token = 'expired-agent-token'",
        "user_id = 44",
        "tenant_id = 55",
        "instance_id = 11",
        "",
      ].join("\n"),
    )

    let requests = 0
    onFetch({
      match: (url) => url.includes("/open/api/v1/analytics-agent/datagpt/enabled"),
      respond: () => {
        requests += 1
        return new Response(JSON.stringify({ message: "token expired" }), { status: 401 })
      },
    })

    return runAnalyticsCli(["analytics-agent", "service", "enabled"]).then((result) => {
      expect(result.exitCode).not.toBe(0)
      // No pat, no password, no OAuth pointer: forceRefreshToken would spend six
      // login retries to arrive back at this same 401, so it must not be tried.
      expect(requests).toBe(1)
    })
  })

  test("refuses to finish a flow under a tenant it did not start in", async () => {
    writeFileSync(
      join(process.env.CLICKZETTA_TEST_HOME!, ".clickzetta", "profiles.toml"),
      [
        "[oauth.session]",
        "access_token = 'old-oauth-token'",
        "refresh_token = 'refresh-token'",
        "expire_time_ms = 3600000",
        `obtained_at = ${Date.now() - 3600000}`,
        "instance_id = 11",
        "user_id = 44",
        "issuer = 'issuer.example.com'",
        "",
        "[profiles.test]",
        "oauth = 'session'",
        "workspace = 'wanxin_test_04'",
        "instance = 'inst'",
        "service = 'uat-api.clickzetta.com'",
        "analysis_agent_endpoint = 'https://example.clickzetta.com'",
        "",
        "[profiles.test.agent]",
        "token = 'expired-agent-token'",
        "user_id = 44",
        "tenant_id = 55",
        "instance_id = 11",
        "",
      ].join("\n"),
    )

    onFetch({
      match: (url) => url.includes("/clickzetta-hornhub/oauth2/token"),
      respond: () => ({
        access_token: "fresh-oauth-token",
        refresh_token: "rotated-refresh-token",
        token_type: "Bearer",
        expires_in: 3600,
      }),
    })
    // The question is minted under the [agent] tenant (55); the poll then 401s,
    // and the refresh moves the session to tenant 10. Continuing would poll for
    // a questionId that tenant never issued.
    onStudio("/open/text2insight/query", () => ({ data: { questionId: 123 } }))
    let polls = 0
    onFetch({
      match: (url) => url.includes("/open/safe_question_poll"),
      respond: () => {
        polls += 1
        return new Response(JSON.stringify({ message: "token expired" }), { status: 401 })
      },
    })

    const result = await runAnalyticsCli([
      "analytics-agent",
      "session",
      "run",
      "--session-id",
      "7",
      "--msg",
      "hello",
    ])

    expect(result.exitCode).not.toBe(0)
    expect(polls).toBe(1)
    expect(result.output).toContain("tenant 10")
    expect(result.output).toContain("55")
  })
})
