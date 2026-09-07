import { beforeEach, describe, expect, test } from "bun:test"
import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { readLlmEntries, setActiveModel, writeLlmEntries } from "../src/llm/native-config.js"
import { onFetch, onStudio, requireTestHome, stubStudioContext } from "./support/cz-fixtures.js"

// Network-boundary test: no mock.module of our own src or of @clickzetta/sdk. The real gateway
// command runs (execute → ai-gateway → getGatewayContext → SDK studioRequest),
// and only the network boundary (globalThis.fetch, intercepted in preload) is
// stubbed. The AIGW admin endpoints funnel through studioRequest → fetch, so we
// stub them by path with onStudio(); auth/context plumbing comes from
// stubStudioContext() + a real profiles.toml.

const modelListBodies: unknown[] = []
let nextKeyID = 100
const gatewayKeys = new Map<number, { alias: string; value: string }>()

function modelRows(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    modelIdentifier: `model-${i + 1}`,
    modelName: `Model ${i + 1}`,
    modelDesc: `Desc ${i + 1}`,
  }))
}

// Register the AIGW admin fixtures. These mirror the shapes the old
// mock.module("@clickzetta/sdk") returned from studioRequest, but now respond
// at the real backend paths reached via fetch. studioRequest requires the
// envelope `code` to be 0/200, so every response wraps data as { code: 200 }.
function registerGatewayFixtures() {
  onStudio("/llm-gateway-admin/v2/virtual-key/listWithAuth", (body) => {
    const alias = typeof (body as Record<string, unknown> | undefined)?.vApiKeyAlias === "string"
      ? String((body as Record<string, unknown>).vApiKeyAlias)
      : undefined
    const rows = [...gatewayKeys.entries()]
      .filter(([, key]) => !alias || key.alias === alias)
      .map(([id, key]) => ({ id, vApiKeyAlias: key.alias, vApiKeyMasked: `${key.value.slice(0, 4)}****${key.value.slice(-4)}` }))
    return { code: 200, data: rows, count: rows.length }
  })
  onStudio("/llm-gateway-admin/v2/virtual-key/save", (body) => {
    const alias = String((body as Record<string, unknown>).vApiKeyAlias)
    const existing = [...gatewayKeys.entries()].find(([, key]) => key.alias === alias)
    if (existing) return { code: 200, data: existing[0] }
    const id = nextKeyID++
    gatewayKeys.set(id, { alias, value: `ck-${alias}-plaintext` })
    return { code: 200, data: id }
  })
  onFetch({
    match: (url) => url.includes("/llm-gateway-admin/v2/virtual-key/getApiKey?id="),
    respond: (url) => {
      const id = Number(url.split("=").at(-1))
      const key = gatewayKeys.get(id)
      if (!key) throw new Error(`unknown key id: ${id}`)
      return { code: 200, data: key.value }
    },
  })
  onFetch({
    match: (url) => url.includes("/llm-gateway-admin/v2/virtual-key/delete?id="),
    respond: (url) => {
      const id = Number(url.split("=").at(-1))
      gatewayKeys.delete(id)
      return { code: 200, data: true }
    },
  })
  onStudio("/llm-gateway-admin/v2/model/list", (body) => {
    modelListBodies.push(body)
    if ((body as Record<string, unknown>).virtualKey === "empty_key") {
      return { code: 200, data: [], count: 0 }
    }
    const pageSize = typeof (body as Record<string, unknown> | undefined)?.pageSize === "number"
      ? (body as Record<string, number>).pageSize
      : 0
    return pageSize === 0
      ? { code: 200, data: [], count: 0 }
      : { code: 200, data: modelRows(Math.min(pageSize, 12)), count: 12 }
  })
}

const { execute } = await import("../src/execute.ts")

function firstJson(output: string) {
  return JSON.parse(output.trim().split("\n")[0] ?? "{}") as Record<string, unknown>
}

beforeEach(() => {
  gatewayKeys.clear()
  modelListBodies.length = 0
  nextKeyID = 100
  // Start from an empty provider map so each test's expectations don't inherit
  // entries written by an earlier one (Bun shares a process across test files).
  const testHome = requireTestHome()
  writeLlmEntries({ llm: {} })
  writeFileSync(
    join(testHome, ".clickzetta", "profiles.toml"),
    [
      "[profiles.test]",
      "pat = 'pat'",
      "workspace = 'wanxin_test_04'",
      "instance = 'inst'",
      "service = 'uat-api.clickzetta.com'",
      "",
    ].join("\n"),
  )
  stubStudioContext()
  registerGatewayFixtures()
})

describe("ai-gateway model list", () => {
  test("explains empty model lists as likely missing AIGW admin permission", async () => {
    const result = await execute("ai-gateway model list empty_key")
    const json = firstJson(result.output)

    expect(result.exitCode).toBe(0)
    expect(json.data).toEqual([])
    expect(json.ai_message).toBe("No AIGW models returned. This usually means the virtual key VALUE is wrong (did you pass the alias by mistake?). Get the actual key value via: cz-cli ai-gateway key get <alias>")
  })

  test("defaults to 10 models and explains how to adjust the cap", async () => {
    const result = await execute("ai-gateway model list czt_virtual_key")
    const json = firstJson(result.output)

    expect(result.exitCode).toBe(0)
    expect((modelListBodies.at(-1) as Record<string, unknown>).pageSize).toBe(10)
    expect(json.count).toBe(10)
    expect(json.ai_message).toBe("Showing 10 of 12 models. Use --limit to increase the cap, or --no-limit to remove the default cap.")
  })

  test("passes explicit limit through to the model list page size", async () => {
    const result = await execute("ai-gateway model list czt_virtual_key --limit 3")
    const json = firstJson(result.output)

    expect(result.exitCode).toBe(0)
    expect((modelListBodies.at(-1) as Record<string, unknown>).pageSize).toBe(3)
    expect(json.count).toBe(3)
    expect(json.ai_message).toBe("Showing 3 of 12 models. Use --limit to increase the cap, or --no-limit to remove the default cap.")
  })

  test("no-limit disables the default ten model cap", async () => {
    const result = await execute("ai-gateway model list czt_virtual_key --no-limit")
    const json = firstJson(result.output)

    expect(result.exitCode).toBe(0)
    expect((modelListBodies.at(-1) as Record<string, unknown>).pageSize).toBe(200)
    expect(json.count).toBe(12)
    expect(json.ai_message).toBeUndefined()
  })

})

describe("ai-gateway key add-to-llm", () => {
  test("registers the created virtual key without changing the active model", async () => {
    const testHome = requireTestHome()
    mkdirSync(join(testHome, ".clickzetta"), { recursive: true })
    writeFileSync(
      join(testHome, ".clickzetta", "profiles.toml"),
      [
        'default_profile = "dev"',
        "",
        "[profiles.dev]",
        "pat = 'pat'",
        "workspace = 'wanxin_test_04'",
        "instance = 'inst'",
        "service = 'uat-api.clickzetta.com'",
        'aimeshEndpointBaseUrl = "https://profile-gateway.example/gateway/v1"',
        "",
      ].join("\n"),
    )

    writeLlmEntries({
      llm: {
        existing: {
          provider: "clickzetta",
          api_key: "ck-existing",
          base_url: "https://profile-gateway.example/gateway/v1",
        },
      },
    })
    setActiveModel("existing/deepseek/deepseek-v4-pro")

    const result = await execute("ai-gateway key create demo-key --add-to-llm demo-key")
    const json = firstJson(result.output)
    const entries = readLlmEntries()

    expect(result.exitCode).toBe(0)
    expect(json.ai_message).toContain("cz-cli agent llm test demo-key")
    expect(json.ai_message).toContain("cz-cli agent llm models demo-key")
    expect(json.ai_message).toContain("cz-cli agent llm use demo-key/<MODEL_ID>")
    expect(json.ai_message).toContain("Default model 'existing/deepseek/deepseek-v4-pro' is unchanged")
    expect(json.data.llm).toMatchObject({
      current_default: "existing/deepseek/deepseek-v4-pro",
      default_changed: false,
      optional_checks: ["cz-cli agent llm test demo-key", "cz-cli agent llm models demo-key"],
    })
    expect(entries.model).toBe("existing/deepseek/deepseek-v4-pro")
    expect(entries.llm["demo-key"]).toEqual({
      provider: "clickzetta",
      api_key: "ck-demo-key-plaintext",
      base_url: "https://profile-gateway.example/gateway/v1",
    })
  })

  test("rejects the removed --use option before creating a virtual key", async () => {
    const result = await execute("ai-gateway key create demo-key --add-to-llm demo-key --use")
    const json = firstJson(result.output)

    expect(result.exitCode).toBe(1)
    expect(json.error).toMatchObject({ code: "USE_OPTION_REMOVED" })
    expect(json.next_steps).toEqual([
      "cz-cli agent llm models <name>",
      "cz-cli agent llm use <name>/<MODEL_ID>",
    ])
    expect(json.optional_checks).toEqual(["cz-cli agent llm test <name>"])
    expect(gatewayKeys.size).toBe(0)
    expect(readLlmEntries().llm["demo-key"]).toBeUndefined()
  })
})

/**
 * `ai-gateway quota` reads the allowance off a completion's response headers, so its
 * whole contract is "what the gateway said", including when the gateway said something
 * that is not about the quota at all.
 */
describe("ai-gateway quota", () => {
  const BASE = "https://uat-aimesh.clickzetta.com/gateway/v1"
  const KEY = "k".repeat(32)

  function withClickzettaEntry() {
    writeLlmEntries({ llm: { cz: { provider: "clickzetta", api_key: KEY, base_url: BASE } } })
  }

  /** Answer the model catalog, then the probe, with whatever the case needs. */
  function stubGateway(input: { models?: unknown; completion: () => Response }) {
    onFetch({
      match: (url) => url.startsWith(BASE),
      respond: (url) => {
        if (url.endsWith("/models")) {
          return input.models === undefined ? new Response("nope", { status: 503 }) : input.models
        }
        return input.completion()
      },
    })
  }

  test("reports every period the headers carried", async () => {
    withClickzettaEntry()
    stubGateway({
      models: { object: "list", data: [{ id: "deepseek/deepseek-v4-pro" }] },
      completion: () =>
        new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: "ok" } }] }), {
          status: 200,
          headers: {
            "content-type": "application/json",
            "x-czgw-ratelimit-api-key-token-period": "PTO, PDO",
            "x-czgw-ratelimit-api-key-token-limit": "1000000000, 10000000",
            "x-czgw-ratelimit-api-key-token-used": "21306417, 238",
            "x-czgw-ratelimit-api-key-token-remaining": "978693583, 9999762",
          },
        }),
    })

    const result = await execute("ai-gateway quota cz")
    const json = firstJson(result.output)
    expect(result.exitCode).toBe(0)
    const data = json.data as { quotas?: Array<{ period?: string }> }
    expect(data.quotas?.map((quota) => quota.period)).toEqual(["total", "daily"])
  })

  /**
   * A 404 for a model nobody asked for says nothing about the quota — the catalog could
   * not be listed, so the probe fell back to a hardcoded id this tenant does not serve.
   * Collapsing that into GATEWAY_QUOTA_UNAVAILABLE is the "two surfaces, two verdicts"
   * defect probe.ts documents, so it gets its own code and names the remedy.
   */
  test("a 404 on a fallback probe model is not reported as an unreadable quota", async () => {
    withClickzettaEntry()
    stubGateway({
      completion: () => new Response(JSON.stringify({ error: { message: "model not found" } }), { status: 404 }),
    })

    const result = await execute("ai-gateway quota cz")
    const json = firstJson(result.output)
    const error = json.error as { code?: string; message?: string }
    expect(error.code).toBe("GATEWAY_PROBE_MODEL_UNAVAILABLE")
    expect(error.message).toContain("--model")
    expect(error.message).toContain("says nothing about the quota")
  })

  test("a 404 on a model the caller named IS reported as an unreadable quota", async () => {
    withClickzettaEntry()
    stubGateway({
      completion: () => new Response(JSON.stringify({ error: { message: "model not found" } }), { status: 404 }),
    })

    const result = await execute("ai-gateway quota cz --model mine/does-not-exist")
    const json = firstJson(result.output)
    expect((json.error as { code?: string }).code).toBe("GATEWAY_QUOTA_UNAVAILABLE")
  })

  /**
   * Two ClickZetta entries and nothing pinned is exactly where this command used to guess
   * the first one while the sidebar refused to choose — same llm.json, two answers. It now
   * asks for a name and lists the candidates.
   */
  test("with two candidates and nothing pinned it asks for a name instead of guessing", async () => {
    writeLlmEntries({
      llm: {
        prod: { provider: "clickzetta", api_key: KEY, base_url: BASE },
        staging: { provider: "clickzetta", api_key: "s".repeat(32), base_url: BASE },
      },
    })
    const result = await execute("ai-gateway quota")
    const message = ((firstJson(result.output).error as { message?: string }) ?? {}).message ?? ""
    expect(message).toContain("naming one is required")
    expect(message).toContain("prod")
    expect(message).toContain("staging")
  })

  test("naming one of several is answered directly", async () => {
    writeLlmEntries({
      llm: {
        prod: { provider: "clickzetta", api_key: KEY, base_url: BASE },
        staging: { provider: "clickzetta", api_key: "s".repeat(32), base_url: BASE },
      },
    })
    stubGateway({
      models: { object: "list", data: [{ id: "deepseek/deepseek-v4-pro" }] },
      completion: () =>
        new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: "ok" } }] }), {
          status: 200,
          headers: {
            "content-type": "application/json",
            "x-czgw-ratelimit-api-key-token-period": "PDO",
            "x-czgw-ratelimit-api-key-token-limit": "10000000",
            "x-czgw-ratelimit-api-key-token-used": "238",
            "x-czgw-ratelimit-api-key-token-remaining": "9999762",
          },
        }),
    })
    const result = await execute("ai-gateway quota prod")
    expect(result.exitCode).toBe(0)
    expect((firstJson(result.output).data as { llm?: string }).llm).toBe("prod")
  })

  test("a gateway that sends no quota headers is not reported as zero", async () => {
    withClickzettaEntry()
    stubGateway({
      models: { object: "list", data: [{ id: "deepseek/deepseek-v4-pro" }] },
      completion: () =>
        new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: "ok" } }] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    })

    const result = await execute("ai-gateway quota cz")
    const json = firstJson(result.output)
    expect(result.exitCode).toBe(0)
    expect((json.data as Record<string, unknown>).quotas).toBeUndefined()
    expect(String(json.ai_message)).toContain("reported no quota headers")
  })
})
