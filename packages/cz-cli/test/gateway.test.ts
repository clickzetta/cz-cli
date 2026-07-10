import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { readLlmEntries } from "../src/llm/native-config.js"

const actualSdk = await import("@clickzetta/sdk")
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

mock.module("@clickzetta/sdk", () => ({
  ...actualSdk,
  studioRequest: async (_sc: unknown, path: string, body?: unknown) => {
    if (path === "/llm-gateway-admin/v2/virtual-key/listWithAuth") {
      const alias = typeof (body as Record<string, unknown> | undefined)?.vApiKeyAlias === "string"
        ? String((body as Record<string, unknown>).vApiKeyAlias)
        : undefined
      const rows = [...gatewayKeys.entries()]
        .filter(([, key]) => !alias || key.alias === alias)
        .map(([id, key]) => ({ id, vApiKeyAlias: key.alias, vApiKeyMasked: `${key.value.slice(0, 4)}****${key.value.slice(-4)}` }))
      return { code: 200, data: rows, count: rows.length }
    }
    if (path === "/llm-gateway-admin/v2/virtual-key/save") {
      const alias = String((body as Record<string, unknown>).vApiKeyAlias)
      const existing = [...gatewayKeys.entries()].find(([, key]) => key.alias === alias)
      if (existing) return { code: 200, data: existing[0] }
      const id = nextKeyID++
      gatewayKeys.set(id, { alias, value: `ck-${alias}-plaintext` })
      return { code: 200, data: id }
    }
    if (path.startsWith("/llm-gateway-admin/v2/virtual-key/getApiKey?id=")) {
      const id = Number(path.split("=").at(-1))
      const key = gatewayKeys.get(id)
      if (!key) throw new Error(`unknown key id: ${id}`)
      return { code: 200, data: key.value }
    }
    if (path.startsWith("/llm-gateway-admin/v2/virtual-key/delete?id=")) {
      const id = Number(path.split("=").at(-1))
      gatewayKeys.delete(id)
      return { code: 200, data: true }
    }
    if (path === "/llm-gateway-admin/v2/model/list") {
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
    }
    throw new Error(`unexpected gateway path: ${path}`)
  },
}))

mock.module("../src/commands/studio-context.js", () => ({
  getGatewayContext: async () => ({
    token: "token",
    instanceId: 1,
    workspaceId: 0,
    projectId: 0,
    userId: 2,
    tenantId: 3,
    instanceName: "inst",
    workspaceName: "",
    env: "dev",
    baseUrl: "https://example.clickzetta.com",
    customHeaders: {},
    userName: "user",
  }),
  getStudioContext: async () => ({}),
}))

mock.module("../src/logger.js", () => ({
  logOperation: () => {},
}))

const { execute } = await import("../src/execute.ts")

function firstJson(output: string) {
  return JSON.parse(output.trim().split("\n")[0] ?? "{}") as Record<string, unknown>
}

let testHome: string | undefined
const originalHome = process.env.CLICKZETTA_TEST_HOME

beforeEach(() => {
  gatewayKeys.clear()
  modelListBodies.length = 0
  nextKeyID = 100
  testHome = mkdtempSync(join(tmpdir(), "cz-cli-gateway-test-"))
  process.env.CLICKZETTA_TEST_HOME = testHome
})

afterEach(() => {
  if (testHome) rmSync(testHome, { recursive: true, force: true })
  if (originalHome === undefined) delete process.env.CLICKZETTA_TEST_HOME
  else process.env.CLICKZETTA_TEST_HOME = originalHome
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
    mkdirSync(join(testHome!, ".clickzetta"), { recursive: true })
    writeFileSync(
      join(testHome!, ".clickzetta", "profiles.toml"),
      ['default_profile = "dev"', "", "[profiles.dev]", 'ai_gateway_url = "https://profile-gateway.example/gateway/v1"', ""].join("\n"),
    )

    const result = await execute("ai-gateway key create demo-key --add-to-llm demo-key --use")
    const json = firstJson(result.output)
    const entries = readLlmEntries()

    expect(result.exitCode).toBe(0)
    expect(json.ai_message).toBe("Virtual key created and registered as agent LLM 'demo-key' (now active).")
    expect(entries.default_llm).toBe("demo-key")
    expect(entries.llm["demo-key"]).toEqual({
      provider: "clickzetta",
      api_key: "ck-demo-key-plaintext",
      base_url: "https://profile-gateway.example/gateway/v1",
    })
  })
})
