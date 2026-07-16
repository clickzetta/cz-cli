import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test"
import { writeFileSync } from "node:fs"
import { join } from "node:path"
import { onFetch } from "./support/cz-fixtures.js"

// Network-boundary test: the real SDK + real getToken/getCurrentUser/studioRequest run; only the
// network boundary (globalThis.fetch) is stubbed. studioCalls is reconstructed from
// intercepted requests (baseUrl+path from the URL, instanceName from headers) so the
// path/body/baseUrl/routing assertions are preserved.
// @clack/prompts is a TRUE third-party interaction boundary — it stays mocked, but
// leak-safe (captured + restored in afterAll) since mock.module is process-global.

const studioCalls: Array<{ path: string; body: unknown; baseUrl?: string; instanceName?: string }> = []
const gatewayState = {
  listData: [] as Array<Record<string, unknown>>,
  getById: {
    99: "ck-new",
  } as Record<number, string>,
}
const __realClackPrompts = { ...(await import("@clack/prompts")) }

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

// Split an intercepted request into the {baseUrl, path} the old studioRequest stub saw.
function recordStudioCall(url: string, body: unknown, headers: Record<string, string>) {
  const u = new URL(url)
  const baseUrl = `${u.protocol}//${u.host}`
  const path = u.pathname + u.search
  studioCalls.push({ path, body, baseUrl, instanceName: headers.instancename })
}

function installGatewayFetch() {
  // portal login + current user (rotation resolves a token/user first)
  onFetch({
    match: (url) => url.includes("/clickzetta-portal/user/loginSingle"),
    respond: () => ({ code: 0, data: { token: "portal-token", instanceId: 11, userId: 22, expireTime: 60_000 } }),
  })
  onFetch({
    match: (url) => url.includes("/clickzetta-portal/user/getCurrentUser"),
    respond: () => ({ code: 0, data: { id: 22, accountId: 33, name: "alice", instanceId: 11 } }),
  })
  // gateway admin calls — capture like the old studioRequest stub did
  onFetch({
    match: (url) => url.includes("/llm-gateway-admin/v2/virtual-key/listWithAuth"),
    respond: (url, _m, body, headers) => {
      recordStudioCall(url, body, headers)
      return { code: 0, data: gatewayState.listData }
    },
  })
  onFetch({
    match: (url) => url.includes("/llm-gateway-admin/v2/virtual-key/save"),
    respond: (url, _m, body, headers) => {
      recordStudioCall(url, body, headers)
      return { code: 0, data: 99 }
    },
  })
  onFetch({
    match: (url) => url.includes("/llm-gateway-admin/v2/virtual-key/getApiKey"),
    respond: (url, _m, body, headers) => {
      recordStudioCall(url, body, headers)
      const id = Number(new URL(url).searchParams.get("id"))
      return { code: 0, data: gatewayState.getById[id] }
    },
  })
}


const profileFile = join(process.env.CLICKZETTA_TEST_HOME!, ".clickzetta", "profiles.toml")

beforeEach(() => {
  studioCalls.length = 0
  gatewayState.listData = []
  gatewayState.getById = { 99: "ck-new" }
  delete process.env.CZ_PROFILE
  installGatewayFetch()
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
      'aimeshEndpointBaseUrl = "https://mock-aimesh.example/gateway/v1"',
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
  mock.module("@clack/prompts", () => __realClackPrompts)
  delete process.env.CZ_PROFILE
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
        'aimeshEndpointBaseUrl = "https://mock-aimesh.example/gateway/v1"',
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
        'aimeshEndpointBaseUrl = "https://mock-aimesh.example/gateway/v1"',
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
        'aimeshEndpointBaseUrl = "https://cn-shanghai-alicloud-aimesh.api.clickzetta.com/gateway/v1"',
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
