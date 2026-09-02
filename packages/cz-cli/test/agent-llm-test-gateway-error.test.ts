/**
 * `agent llm test` must explain a gateway failure the same way a session does.
 * Run: bun test test/agent-llm-test-gateway-error.test.ts
 *
 * The probe builds its own request instead of going through the provider, so it
 * bypassed the error classifier entirely: an overdue tenant saw
 * `HTTP 403 … {"error":{"code":"GATEWAY_TENANT_OVERDUE",…}}` from the probe while
 * the agent explained the same condition as "Insufficient account balance…". Two
 * answers for one condition, and the raw one is the harder to act on.
 *
 * `agent llm test` is an agent-runtime command, so the in-process execute() helper
 * refuses it and the global fetch boundary cannot reach a subprocess. This suite
 * therefore runs the real CLI against a local HTTP server that answers with
 * verbatim gateway bodies — the same shape captured from cn-shanghai.
 *
 * The spawn has to be ASYNC. spawnSync blocks the event loop, which is exactly what
 * Bun.serve needs in order to accept the child's connection, so the two deadlock:
 * the symptom is a test that hangs to its timeout with the server never once hit.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test"
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const RUNTIME = process.execPath
const ENTRY = ["./src/main.ts"]

let home: string
let server: ReturnType<typeof Bun.serve>
let gatewayUrl: string
/** Set per test; the server replays it as the probe's response. */
let nextFailure: { status: number; body: unknown }
/** Set per test; response headers the probe should read the quota off. */
let nextHeaders: Record<string, string> | undefined

beforeAll(() => {
  home = join(tmpdir(), `cz-llmtest-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(join(home, ".clickzetta"), { recursive: true })

  server = Bun.serve({
    port: 0,
    fetch(request) {
      if (new URL(request.url).pathname.endsWith("/models")) {
        return Response.json({ object: "list", data: [{ id: "deepseek/deepseek-v4-pro" }] })
      }
      return Response.json(nextFailure.body, { status: nextFailure.status, headers: nextHeaders })
    },
  })
  // The probe appends /chat/completions to the configured base, and cz-cli
  // normalizes a bare host to /gateway/v1 — mirror that here.
  gatewayUrl = `http://127.0.0.1:${server.port}/gateway/v1`

  writeFileSync(
    join(home, ".clickzetta", "llm.json"),
    JSON.stringify({
      provider: {
        cz: { name: "cz", npm: "@clickzetta/ai-gateway", options: { apiKey: "k".repeat(32), baseURL: gatewayUrl } },
      },
    }),
  )
})

afterAll(() => {
  server?.stop(true)
  rmSync(home, { recursive: true, force: true })
})

async function runLlmTest() {
  const proc = Bun.spawn([RUNTIME, ...ENTRY, "agent", "llm", "test", "cz", "--format", "json"], {
    env: {
      ...process.env,
      HOME: home,
      CLICKZETTA_TEST_HOME: home,
      // Keep the accounts link out of the assertions: this suite is about which
      // message is chosen, not how the URL is derived (billing-error-url covers that).
      CZ_ACCOUNTS_URL: "",
      CZ_CLI_DISABLE_UPDATE_CHECK: "1",
    },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  })
  const [out, err] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()])
  await proc.exited
  const line = `${out}\n${err}`
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.startsWith("{"))
  if (!line) throw new Error(`no JSON in CLI output:\n${out}\n${err}`)
  // An error is reported at the top level; a success is wrapped in `data`.
  return JSON.parse(line) as {
    error?: { code?: string; message?: string; gateway_code?: string; status?: number }
    data?: {
      sample_response?: string
      quotas?: Array<{ period?: string; periodCode?: string; limit?: number; used?: number; remaining?: number; scope?: string }>
    }
  }
}

describe("agent llm test — gateway failures", () => {
  beforeEach(() => {
    nextHeaders = undefined
  })

  test("an exhausted complimentary key gets the create-your-own-key guidance", async () => {
    // GATEWAY_TOO_MANY_REQUESTS is absent from the documented code table; this body
    // is verbatim from the live gateway, where the alias prefix marks the grant.
    const message =
      "[G2] Too many request. path=/gateway/v1/chat/completions, requestId=req-abc, " +
      "virtualApiKeyAlias=cz-code_auto_vmhmdkcc, tenantId=1, detail=Virtual key total quota exceeded"
    nextFailure = { status: 429, body: { error: { code: "GATEWAY_TOO_MANY_REQUESTS", message, source: "gateway" } } }

    const json = await runLlmTest()
    expect(json.error?.gateway_code).toBe("GATEWAY_TOO_MANY_REQUESTS")
    expect(json.error?.message).toContain("complimentary token quota has been exhausted")
    expect(json.error?.message).toContain("cz-cli ai-gateway key create")
    // The raw body must not be what the user is left reading.
    expect(json.error?.message).not.toContain("virtualApiKeyAlias")
  })

  test("an overdue tenant is reported as a balance problem, not a raw 403", async () => {
    nextFailure = {
      status: 403,
      body: {
        error: {
          code: "GATEWAY_TENANT_OVERDUE",
          message: "[G2] Tenant overdue. path=/v1/chat/completions, requestId=req-xyz, tenantId=228241",
          source: "gateway",
        },
      },
    }

    const json = await runLlmTest()
    expect(json.error?.gateway_code).toBe("GATEWAY_TENANT_OVERDUE")
    expect(json.error?.message).toContain("Insufficient account balance")
    expect(json.error?.message).toContain("req-xyz")
  })

  test("a tenant cycle cap is not described as a balance problem", async () => {
    // Paying does not lift a cycle cap, so the probe must not imply that it does.
    nextFailure = {
      status: 403,
      body: {
        error: { code: "GATEWAY_TENANT_OVER_QUOTA", message: "[G2] Tenant over quota. requestId=req-q", source: "gateway" },
      },
    }

    const json = await runLlmTest()
    expect(json.error?.gateway_code).toBe("GATEWAY_TENANT_OVER_QUOTA")
    expect(json.error?.message).toContain("billing cycle")
    expect(json.error?.message).not.toContain("add funds")
  })

  test("a code with no tailored advice keeps the HTTP-status form", async () => {
    // For these the status and raw detail are the only information there is, so
    // they must survive rather than be replaced by a generic message.
    nextFailure = {
      status: 400,
      body: {
        error: { code: "GATEWAY_MODEL_NOT_RESOLVED", message: "[G2] Model not resolved. requestId=req-m", source: "gateway" },
      },
    }

    const json = await runLlmTest()
    expect(json.error?.gateway_code).toBeUndefined()
    expect(json.error?.message).toContain("HTTP 400")
    expect(json.error?.message).toContain("GATEWAY_MODEL_NOT_RESOLVED")
  })
})

/**
 * The same probe that proves a key works also reports how much of it is left: the
 * gateway puts the allowance on every successful completion's headers, so this costs
 * no extra request. `quotas` is part of the `--format json` payload, so it is a
 * contract, not a debug aid — these cases pin its shape.
 */
describe("agent llm test — token quota", () => {
  const COMPLETION = {
    id: "chatcmpl-1",
    object: "chat.completion",
    choices: [{ index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" }],
  }

  test("a successful probe reports the quota the headers carried", async () => {
    nextFailure = { status: 200, body: COMPLETION }
    nextHeaders = {
      "x-czgw-ratelimit-api-key-token-period": "PDO",
      "x-czgw-ratelimit-api-key-token-limit": "10000000",
      "x-czgw-ratelimit-api-key-token-used": "238",
      "x-czgw-ratelimit-api-key-token-remaining": "9999762",
    }

    const json = await runLlmTest()
    expect(json.error).toBeUndefined()
    expect(json.data?.quotas).toEqual([
      { period: "daily", periodCode: "PDO", limit: 10000000, used: 238, remaining: 9999762, scope: "api-key" },
    ])
  })

  test("every configured period is reported, not just the first", async () => {
    nextFailure = { status: 200, body: COMPLETION }
    nextHeaders = {
      "x-czgw-ratelimit-api-key-token-period": "PTO, PDO",
      "x-czgw-ratelimit-api-key-token-limit": "1000000000, 10000000",
      "x-czgw-ratelimit-api-key-token-used": "21306417, 238",
      "x-czgw-ratelimit-api-key-token-remaining": "978693583, 9999762",
    }

    const json = await runLlmTest()
    expect(json.data?.quotas?.map((quota) => quota.period)).toEqual(["total", "daily"])
  })

  /**
   * A gateway that sends no quota headers is not a failure and not a zero — the probe
   * still passed, and the key omits the field entirely rather than reporting an empty
   * allowance. cn-shanghai-alicloud-aimesh behaved this way as of 2026-09-01.
   */
  test("a gateway that reports no quota still passes, with the field absent", async () => {
    nextFailure = { status: 200, body: COMPLETION }
    nextHeaders = undefined

    const json = await runLlmTest()
    expect(json.error).toBeUndefined()
    expect(json.data?.sample_response).toBe("ok")
    expect(json.data && "quotas" in json.data).toBe(false)
  })
})
