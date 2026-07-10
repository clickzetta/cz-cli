import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const home = mkdtempSync(join(tmpdir(), "cz-cli-clickzetta-rotation-"))
const profileDir = join(home, ".clickzetta")
const profileFile = join(profileDir, "profiles.toml")

const studioCalls: Array<{ path: string; body: unknown; baseUrl?: string; instanceName?: string }> = []
const gatewayState = {
  listData: [] as Array<Record<string, unknown>>,
  getById: {
    99: "ck-new",
  } as Record<number, string>,
}
const actualSdk = await import("@clickzetta/sdk")

mock.module("@clickzetta/sdk", () => ({
  ...actualSdk,
  getToken: async () => ({
    token: "portal-token",
    instanceId: 11,
    userId: 22,
    expireTimeMs: 60_000,
    obtainedAt: Date.now(),
  }),
  getCurrentUser: async () => ({
    id: 22,
    accountId: 33,
    name: "alice",
    instanceId: 11,
  }),
  studioRequest: async (config: unknown, path: string, body: unknown) => {
    studioCalls.push({
      path,
      body,
      baseUrl: typeof config === "object" && config && "baseUrl" in config ? String(config.baseUrl) : undefined,
      instanceName: typeof config === "object" && config && "instanceName" in config ? String(config.instanceName) : undefined,
    })
    if (path === "/llm-gateway-admin/v2/virtual-key/listWithAuth") {
      return { code: 0, data: gatewayState.listData }
    }
    if (path === "/llm-gateway-admin/v2/virtual-key/save") {
      return { code: 0, data: 99 }
    }
    if (path.startsWith("/llm-gateway-admin/v2/virtual-key/getApiKey?id=")) {
      const id = Number(path.split("=").at(-1))
      const key = gatewayState.getById[id]
      if (key) return { code: 0, data: key }
    }
    throw new Error(`Unexpected studioRequest path: ${path}`)
  },
}))

mock.module("@clack/prompts", () => ({
  confirm: async () => true,
  isCancel: () => false,
  log: {
    success: () => {},
    warn: () => {},
  },
}))

const {
  isClickzettaQuotaExhausted,
  maybeRotateExhaustedClickzettaLlm,
  pinAlicloudAdminHost,
} = await import("../src/llm/clickzetta-rotation.ts")
const { readLlmEntries, writeLlmEntries } = await import("../src/llm/native-config.ts")

beforeEach(() => {
  studioCalls.length = 0
  gatewayState.listData = []
  gatewayState.getById = { 99: "ck-new" }
  delete process.env.CZ_PROFILE
  process.env.CLICKZETTA_TEST_HOME = home
  process.env.HOME = home
  mkdirSync(profileDir, { recursive: true })
  writeFileSync(
    profileFile,
    [
      'default_profile = "uat"',
      "[profiles.default]",
      'pat = "pat-token"',
      'instance = "inst"',
      'workspace = "ws"',
      'service = "mock-service.example"',
      'protocol = "https"',
      "",
      "[profiles.uat]",
      'pat = "pat-uat"',
      'instance = "inst-uat"',
      'workspace = "ws-uat"',
      'username = "UAT_TEST"',
      'service = "uat-service.example"',
      'protocol = "https"',
      'ai_gateway_url = "https://mock-aimesh.example/gateway/v1"',
      "",
    ].join("\n"),
  )
  writeLlmEntries({
    llm: {
      clickzetta: {
        provider: "clickzetta",
        api_key: "ck-old",
        base_url: "https://mock-aimesh.example/gateway/v1",
      },
    },
    default_llm: "clickzetta",
  })
})

afterAll(() => {
  delete process.env.CLICKZETTA_TEST_HOME
  delete process.env.CZ_PROFILE
  rmSync(home, { recursive: true, force: true })
})

describe("clickzetta key rotation", () => {
  test("recognizes the clickzetta free key quota-exhausted 429 pattern", () => {
    expect(
      isClickzettaQuotaExhausted({
        provider: "clickzetta",
        status: 429,
        detail:
          "{\"code\":429,\"message\":\"Virtual key total quota exceeded: limit is 10000000 tokens for virtual key 'cz-code_auto_pdiaxzjq', current usage: 10082801 tokens\"}",
      }),
    ).toBe(true)
    expect(
      isClickzettaQuotaExhausted({
        provider: "clickzetta",
        status: 429,
        detail:
          "{\"code\":429,\"message\":\"Virtual key total quota exceeded: limit is 10000000 tokens for virtual key 'cz-cli_auto_UAT_TEST', current usage: 10075371 tokens\"}",
      }),
    ).toBe(false)
  })

  test("quota-exhausted 429 pattern rotates automatically in non-interactive mode", async () => {
    const result = await maybeRotateExhaustedClickzettaLlm({
      provider: "clickzetta",
      status: 429,
      detail:
        "{\"code\":429,\"message\":\"Virtual key total quota exceeded: limit is 10000000 tokens for virtual key 'cz-code_auto_old', current usage: 10075371 tokens\"}",
      approval: "auto",
    })

    expect(result?.rotated).toBe(true)
    expect(result?.entryName).toBe("uat")
    expect(result?.profile).toBe("uat")
    expect(studioCalls[0]?.path).toBe("/llm-gateway-admin/v2/virtual-key/listWithAuth")
    expect(studioCalls[0]?.body).toEqual({
      pageIndex: 1,
      pageSize: 200,
      vApiKeyAlias: "cz-cli_user_UAT_TEST",
    })
    expect(studioCalls[1]?.path).toBe("/llm-gateway-admin/v2/virtual-key/save")
    expect(studioCalls[1]?.body).toEqual({
      vApiKeyAlias: "cz-cli_user_UAT_TEST",
      rateLimitConfigs: { quota_total: 10000000 },
    })
    const llm = readLlmEntries()
    expect(llm.default_llm).toBe("uat")
    expect(llm.llm.uat?.api_key).toBe("ck-new")
  })

  test("quota-exhausted 429 pattern creates new entry after explicit confirmation", async () => {
    const result = await maybeRotateExhaustedClickzettaLlm({
      provider: "clickzetta",
      status: 429,
      detail:
        "{\"code\":429,\"message\":\"Virtual key total quota exceeded: limit is 10000000 tokens for virtual key 'cz-code_auto_old', current usage: 10075371 tokens\"}",
      approval: "prompt",
    })

    expect(result?.rotated).toBe(true)
    expect(result?.entryName).toBe("uat")
    const llm = readLlmEntries()
    expect(llm.default_llm).toBe("uat")
    expect(llm.llm.uat?.api_key).toBe("ck-new")
  })

  test("uses CZ_PROFILE env var to determine which profile to use for key creation", async () => {
    process.env.CZ_PROFILE = "default"
    writeFileSync(
      profileFile,
      [
        'default_profile = "uat"',
        "",
        "[profiles.default]",
        'pat = "pat-token"',
        'instance = "inst"',
        'workspace = "ws"',
        'service = "mock-service.example"',
        'protocol = "https"',
        'ai_gateway_url = "https://mock-aimesh.example/gateway/v1"',
        "",
        "[profiles.uat]",
        'pat = "pat-uat"',
        'instance = "inst-uat"',
        'workspace = "ws-uat"',
        'service = "uat-service.example"',
        'protocol = "https"',
        "",
      ].join("\n"),
    )

    const result = await maybeRotateExhaustedClickzettaLlm({
      provider: "clickzetta",
      status: 429,
      detail:
        "{\"code\":429,\"message\":\"Virtual key total quota exceeded: limit is 10000000 tokens for virtual key 'cz-code_auto_old', current usage: 10075371 tokens\"}",
      approval: "auto",
    })

    expect(result?.rotated).toBe(true)
    expect(result?.profile).toBe("default")
    expect(result?.entryName).toBe("default")
    expect(studioCalls[0]?.baseUrl).toBe("https://mock-service.example")
    expect(studioCalls[0]?.instanceName).toBe("inst")
    expect(studioCalls[0]?.path).toBe("/llm-gateway-admin/v2/virtual-key/listWithAuth")
    expect(studioCalls[1]?.path).toBe("/llm-gateway-admin/v2/virtual-key/save")
    expect(studioCalls[1]?.body).toEqual({
      vApiKeyAlias: expect.stringMatching(/^cz-cli_auto_/),
      rateLimitConfigs: { quota_total: 10000000 },
    })
    const llm = readLlmEntries()
    expect(llm.default_llm).toBe("default")
    expect(llm.llm.default?.api_key).toBe("ck-new")
  })

  test("reuses an existing key with the derived alias before creating a new one", async () => {
    writeFileSync(
      profileFile,
      [
        'default_profile = "uat"',
        "",
        "[profiles.uat]",
        'pat = "pat-uat"',
        'instance = "inst-uat"',
        'workspace = "ws-uat"',
        'username = "EXISTING_TEST"',
        'service = "uat-service.example"',
        'protocol = "https"',
        'ai_gateway_url = "https://mock-aimesh.example/gateway/v1"',
        "",
      ].join("\n"),
    )
    gatewayState.listData = [{ id: 77, vApiKeyAlias: "cz-cli_user_EXISTING_TEST" }]
    gatewayState.getById[77] = "ck-existing"

    const result = await maybeRotateExhaustedClickzettaLlm({
      provider: "clickzetta",
      status: 429,
      detail:
        "{\"code\":429,\"message\":\"Virtual key total quota exceeded: limit is 10000000 tokens for virtual key 'cz-code_auto_old', current usage: 10075371 tokens\"}",
      approval: "auto",
    })

    expect(result?.rotated).toBe(true)
    expect(result?.alias).toBe("cz-cli_user_EXISTING_TEST")
    expect(studioCalls.map((call) => call.path)).toEqual([
      "/llm-gateway-admin/v2/virtual-key/listWithAuth",
      "/llm-gateway-admin/v2/virtual-key/getApiKey?id=77",
    ])
    const llm = readLlmEntries()
    expect(llm.default_llm).toBe("uat")
    expect(llm.llm.uat?.api_key).toBe("ck-existing")
  })

  test("does not rotate when quota is exhausted for a non-free key", async () => {
    const result = await maybeRotateExhaustedClickzettaLlm({
      provider: "clickzetta",
      status: 429,
      detail:
        "{\"code\":429,\"message\":\"Virtual key total quota exceeded: limit is 10000000 tokens for virtual key 'cz-cli_auto_UAT_TEST', current usage: 10075371 tokens\"}",
      approval: "auto",
    })

    expect(result).toBeUndefined()
    expect(studioCalls).toEqual([])
  })

  test("pins alicloud admin host to shanghai regardless of region", () => {
    expect(pinAlicloudAdminHost("https://cn-beijing-alicloud.api.clickzetta.com")).toBe(
      "https://cn-shanghai-alicloud.api.clickzetta.com",
    )
    expect(pinAlicloudAdminHost("https://cn-hangzhou-alicloud.api.clickzetta.com")).toBe(
      "https://cn-shanghai-alicloud.api.clickzetta.com",
    )
    // already shanghai → unchanged
    expect(pinAlicloudAdminHost("https://cn-shanghai-alicloud.api.clickzetta.com")).toBe(
      "https://cn-shanghai-alicloud.api.clickzetta.com",
    )
    // non-alicloud hosts left untouched
    expect(pinAlicloudAdminHost("https://ap-shanghai-tencentcloud.api.clickzetta.com")).toBe(
      "https://ap-shanghai-tencentcloud.api.clickzetta.com",
    )
    expect(pinAlicloudAdminHost("https://uat-api.clickzetta.com")).toBe(
      "https://uat-api.clickzetta.com",
    )
  })

  test("routes admin calls to shanghai when profile service is a non-shanghai alicloud region", async () => {
    writeFileSync(
      profileFile,
      [
        'default_profile = "bj"',
        "",
        "[profiles.bj]",
        'pat = "pat-bj"',
        'instance = "inst-bj"',
        'workspace = "ws-bj"',
        'username = "BJ_TEST"',
        'service = "cn-beijing-alicloud.api.clickzetta.com"',
        'protocol = "https"',
        'ai_gateway_url = "https://cn-shanghai-alicloud-aimesh.api.clickzetta.com/gateway/v1"',
        "",
      ].join("\n"),
    )

    const result = await maybeRotateExhaustedClickzettaLlm({
      provider: "clickzetta",
      status: 429,
      detail:
        "{\"code\":429,\"message\":\"Virtual key total quota exceeded: limit is 10000000 tokens for virtual key 'cz-code_auto_old', current usage: 10075371 tokens\"}",
      approval: "auto",
    })

    expect(result?.rotated).toBe(true)
    // every admin call must target the shanghai portal, not beijing
    expect(studioCalls.length).toBeGreaterThan(0)
    for (const call of studioCalls) {
      expect(call.baseUrl).toBe("https://cn-shanghai-alicloud.api.clickzetta.com")
    }
  })
})
