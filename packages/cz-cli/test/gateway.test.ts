import { beforeEach, describe, expect, test } from "bun:test"
import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { readLlmEntries } from "../src/llm/native-config.js"
import { onFetch, onStudio, stubStudioContext } from "./support/cz-fixtures.js"

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
  writeFileSync(
    join(process.env.CLICKZETTA_TEST_HOME!, ".clickzetta", "profiles.toml"),
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
  test("registers the created virtual key into ~/.clickzetta/llm.json", async () => {
    mkdirSync(join(process.env.CLICKZETTA_TEST_HOME!, ".clickzetta"), { recursive: true })
    writeFileSync(
      join(process.env.CLICKZETTA_TEST_HOME!, ".clickzetta", "profiles.toml"),
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

    const result = await execute("ai-gateway key create demo-key --add-to-llm demo-key --use")
    const json = firstJson(result.output)
    const entries = readLlmEntries()

    expect(result.exitCode).toBe(0)
    expect(json.ai_message).toBe("Virtual key created and registered as agent LLM 'demo-key' (now active).")
    // cz_change: no default_llm. --use makes the new entry active; when a model is
    // already active its id is carried onto the new entry (config.model =
    // demo-key/<modelId>), otherwise config.model stays unset and opencode
    // auto-selects the sole entry. Either way the active entry prefix is demo-key.
    if (typeof entries.model === "string") expect(entries.model.split("/")[0]).toBe("demo-key")
    expect(entries.llm["demo-key"]).toEqual({
      provider: "clickzetta",
      api_key: "ck-demo-key-plaintext",
      base_url: "https://profile-gateway.example/gateway/v1",
    })
  })
})
