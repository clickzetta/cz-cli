import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const home = mkdtempSync(join(tmpdir(), "cz-cli-clickzetta-rotation-"))
const profileDir = join(home, ".clickzetta")
const profileFile = join(profileDir, "profiles.toml")

const studioCalls: Array<{ path: string; body: unknown; baseUrl?: string; instanceName?: string }> = []
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
    if (path === "/llm-gateway-admin/v2/virtual-key/save") {
      return { code: 0, data: 99 }
    }
    if (path === "/llm-gateway-admin/v2/virtual-key/getApiKey?id=99") {
      return { code: 0, data: "ck-new" }
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
} = await import("../src/llm/clickzetta-rotation.ts")

beforeEach(() => {
  studioCalls.length = 0
  delete process.env.CZ_PROFILE
  mkdirSync(profileDir, { recursive: true })
  writeFileSync(
    profileFile,
    [
      'default_profile = "default"',
      'default_llm = "clickzetta"',
      "",
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
      'service = "uat-service.example"',
      'protocol = "https"',
      "",
      "[llm.clickzetta]",
      'provider = "clickzetta"',
      'api_key = "ck-old"',
      'base_url = "https://mock-aimesh.example/gateway/v1"',
      'source_profile = "uat"',
      "",
    ].join("\n"),
  )
  process.env.CLICKZETTA_TEST_HOME = home
  process.env.HOME = home
})

afterAll(() => {
  delete process.env.CLICKZETTA_TEST_HOME
  delete process.env.CZ_PROFILE
  rmSync(home, { recursive: true, force: true })
})

describe("clickzetta key rotation", () => {
  test("recognizes the clickzetta quota-exhausted 429 pattern", () => {
    expect(
      isClickzettaQuotaExhausted({
        provider: "clickzetta",
        status: 429,
        detail:
          "{\"code\":429,\"message\":\"Virtual key total quota exceeded: limit is 10000000 tokens for virtual key 'cz-code_auto_old', current usage: 10075371 tokens\"}",
      }),
    ).toBe(true)
    expect(
      isClickzettaQuotaExhausted({
        provider: "clickzetta",
        status: 401,
        detail: "Invalid virtual key",
      }),
    ).toBe(false)
  })

  test("quota-exhausted 429 pattern rotates automatically in non-interactive mode", async () => {
    const result = await maybeRotateExhaustedClickzettaLlm({
      entryName: "clickzetta",
      provider: "clickzetta",
      status: 429,
      detail:
        "{\"code\":429,\"message\":\"Virtual key total quota exceeded: limit is 10000000 tokens for virtual key 'cz-code_auto_old', current usage: 10075371 tokens\"}",
      approval: "auto",
    })

    expect(result?.rotated).toBe(true)
    expect(result?.entryName).toBe("clickzetta")
    expect(result?.sourceProfile).toBe("uat")
    const profiles = readFileSync(profileFile, "utf-8")
    expect(profiles).toContain('api_key = "ck-new"')
    expect(profiles).toContain('source_profile = "uat"')
    expect(profiles).not.toContain("clickzetta-rotated-")
  })

  test("quota-exhausted 429 pattern updates the bound entry after explicit confirmation", async () => {
    const result = await maybeRotateExhaustedClickzettaLlm({
      provider: "clickzetta",
      status: 429,
      detail:
        "{\"code\":429,\"message\":\"Virtual key total quota exceeded: limit is 10000000 tokens for virtual key 'cz-code_auto_old', current usage: 10075371 tokens\"}",
      approval: "prompt",
    })

    expect(result?.rotated).toBe(true)
    expect(result?.entryName).toBe("clickzetta")
    const profiles = readFileSync(profileFile, "utf-8")
    expect(profiles).toContain('api_key = "ck-new"')
    expect(profiles).toContain('default_llm = "clickzetta"')
    expect(profiles).toContain('source_profile = "uat"')
  })

  test("falls back to CZ_PROFILE for an unbound entry without persisting a guessed source_profile", async () => {
    process.env.CZ_PROFILE = "default"
    writeFileSync(
      profileFile,
      [
        'default_profile = "uat"',
        'default_llm = "clickzetta"',
        "",
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
        'service = "uat-service.example"',
        'protocol = "https"',
        "",
        "[llm.clickzetta]",
        'provider = "clickzetta"',
        'api_key = "ck-old"',
        "",
      ].join("\n"),
    )

    const result = await maybeRotateExhaustedClickzettaLlm({
      entryName: "clickzetta",
      provider: "clickzetta",
      status: 429,
      detail:
        "{\"code\":429,\"message\":\"Virtual key total quota exceeded: limit is 10000000 tokens for virtual key 'cz-code_auto_old', current usage: 10075371 tokens\"}",
      approval: "auto",
    })

    expect(result?.rotated).toBe(true)
    expect(result?.sourceProfile).toBe("default")
    expect(studioCalls[0]?.baseUrl).toBe("https://mock-service.example")
    expect(studioCalls[0]?.instanceName).toBe("inst")
    expect(studioCalls[0]?.body).toEqual({
      vApiKeyAlias: expect.stringMatching(/^cz-code_auto_/),
      rateLimitConfigs: { quota_total: 10000000 },
    })
    const profiles = readFileSync(profileFile, "utf-8")
    expect(profiles).toContain('api_key = "ck-new"')
    expect(profiles).not.toContain("source_profile =")
  })
})
