import { beforeEach, describe, expect, test } from "bun:test"
import { writeFileSync } from "node:fs"
import { join } from "node:path"
import { onFetch, onPath } from "./support/fetch-boundary"
import { requireTestHome } from "./support/cz-fixtures"
import { clearTokenCache } from "@clickzetta/sdk"
import { setActiveModel, writeLlmEntries } from "../src/llm/native-config"
import {
  centralPortalHost,
  fetchQuotaSnapshot,
  isPortalOk,
  maskApiKey,
  matchKeyUsage,
  readProfileInfo,
  readRecentProviders,
  resolveClickzettaEntry,
  selectDisplayedProvider,
} from "../src/opencode-plugin/tui-quota-data"

const PROD_KEY = "ff52aaaaaaaaaaaaaaaaaaaaaaaa9bc8"
const DEV_KEY = "dfceaaaaaaaaaaaaaaaaaaaaaaaa18e4"

/** Two profiles on different portals, mirroring a real multi-tenant setup. */
function writeProfiles() {
  writeFileSync(
    join(requireTestHome(), ".clickzetta", "profiles.toml"),
    [
      "default_profile = 'dev_0'",
      "",
      "[profiles.prod_0]",
      "pat = 'pat-prod'",
      "service = 'cn-shanghai-alicloud.api.clickzetta.com'",
      "instance = 'inst-prod'",
      "workspace = 'quick_start'",
      "account_name = 'prod-account'",
      "account_id = 228044",
      "",
      "[profiles.dev_0]",
      "pat = 'pat-dev'",
      "service = 'dev-api.clickzetta.com'",
      "instance = 'inst-dev'",
      "workspace = 'quick_start'",
      "account_name = 'dev-account'",
      "account_id = 112407",
      "",
    ].join("\n"),
  )
}

function writeEntries() {
  requireTestHome()
  writeLlmEntries({
    llm: {
      prod_0: { provider: "clickzetta", api_key: PROD_KEY, base_url: "https://aimesh.example.com/gateway/v1" },
      dev_0: { provider: "clickzetta", api_key: DEV_KEY, base_url: "https://dev-aimesh.example.com/gateway/v1" },
      "cc-sh": { provider: "clickzetta", api_key: PROD_KEY, base_url: "https://aimesh.example.com/gateway/v1" },
      claude: { provider: "anthropic", api_key: "sk-ant-xxx" },
    },
  })
}

/**
 * Portal fixtures keyed by host, so a wrong-tenant lookup is observable.
 *
 * Handlers match in registration order, so a test that wants a specific read to
 * fail registers its own handler BEFORE calling this.
 */
function stubPortal() {
  const seen: string[] = []
  // Both profiles authenticate by PAT, which the SDK exchanges via loginSingle
  // before either of the reads under test.
  onPath("/clickzetta-portal/user/loginSingle", () => ({
    code: 0,
    data: { token: "portal-token", instanceId: 1, userId: 2, expireTime: 3_600_000 },
  }))
  onFetch({
    match: (url) => url.includes("/clickzetta-portal/"),
    respond: (url) => {
      seen.push(url)
      const dev = url.includes("dev-api.clickzetta.com")
      // The dev host answers 200 where production answers 0 — both mean success.
      const code = dev ? 200 : 0
      if (url.includes("/hornhub/account/billing/account/")) {
        return {
          code,
          data: { cashAmount: dev ? 0 : 51.2772, oweAmount: 0, accountName: dev ? "wynptmks" : "pdiaxzjq" },
        }
      }
      if (url.includes("/user/getCurrentUser")) {
        return {
          code,
          data: { id: dev ? 4 : 2, accountId: dev ? 112407 : 228044, name: dev ? "wynptmks" : "pdiaxzjq", instanceId: 1 },
        }
      }
      if (url.includes("/user/listApiKeys")) {
        const userName = new URL(url).searchParams.get("userName")
        if (userName !== (dev ? "wynptmks" : "pdiaxzjq")) throw new Error(`wrong userName ${userName}`)
        return {
          code,
          data: dev
            ? [
                {
                  id: 10018,
                  status: 1,
                  type: "free",
                  rateLimitType: "quota_pdo",
                  rateLimitValue: 10_000_000,
                  usage: 0,
                  vapiKeyAlias: "cz-code_auto_wynptmks",
                  vapiKeyMasked: "dfce****18e4",
                },
              ]
            : [
                {
                  id: 1256,
                  status: 1,
                  type: "standard",
                  rateLimitType: "quota_total",
                  rateLimitValue: 10_000_000,
                  usage: 68_131,
                  vapiKeyAlias: "my-key",
                  vapiKeyMasked: "9367****a9cf",
                },
                {
                  id: 587,
                  status: 1,
                  type: "free",
                  rateLimitType: "quota_total",
                  rateLimitValue: 10_000_000,
                  usage: 10_082_801,
                  vapiKeyAlias: "cz-code_auto_pdiaxzjq",
                  vapiKeyMasked: "ff52****9bc8",
                },
              ],
        }
      }
      throw new Error(`unexpected portal path ${url}`)
    },
  })
  return seen
}

beforeEach(() => {
  writeProfiles()
  writeEntries()
  // The SDK memoizes tokens per connection for the process; without this a later
  // test reuses the token minted against an earlier test's stub.
  clearTokenCache()
})

describe("isPortalOk", () => {
  // The production host answers 0 and the dev host answers 200; either may arrive
  // as a string. Pinning one silently reads `data: null` on the other.
  test("accepts every success code the portal actually returns", () => {
    for (const code of [0, "0", 200, "200"]) expect(isPortalOk(code)).toBe(true)
  })

  test("rejects business error codes", () => {
    for (const code of [500, 8888, "7777", undefined, null]) expect(isPortalOk(code)).toBe(false)
  })
})

describe("maskApiKey", () => {
  test("produces the portal's masked form", () => {
    expect(maskApiKey(PROD_KEY)).toBe("ff52****9bc8")
  })

  test("declines to mask a key too short to disambiguate", () => {
    expect(maskApiKey("abc")).toBeUndefined()
  })
})

describe("matchKeyUsage", () => {
  const payload = {
    code: 0,
    data: [
      {
        rateLimitType: "quota_total",
        rateLimitValue: 10_000_000,
        usage: 68_131,
        vapiKeyAlias: "my-key",
        vapiKeyMasked: "9367****a9cf",
      },
      {
        rateLimitType: "quota_pdo",
        rateLimitValue: 1_000,
        usage: 7,
        vapiKeyAlias: "free",
        vapiKeyMasked: "ff52****9bc8",
      },
    ],
  }

  test("picks the entry matching the active key, not merely the first", () => {
    expect(matchKeyUsage(payload, PROD_KEY)).toEqual({ used: 7, limit: 1_000, period: "daily", alias: "free" })
  })

  test("returns nothing when no key matches", () => {
    expect(matchKeyUsage(payload, "0000aaaaaaaaaaaaaaaaaaaaaaaa0000")).toEqual({})
  })

  // The gateway-admin route spells it vApiKeyMasked; accept both so a caller
  // switching sources doesn't silently stop matching.
  test("accepts the gateway-admin capitalisation", () => {
    const admin = {
      data: [
        { rateLimitType: "quota_total", rateLimitValue: 5, usage: 1, vApiKeyAlias: "a", vApiKeyMasked: "ff52****9bc8" },
      ],
    }
    expect(matchKeyUsage(admin, PROD_KEY)).toEqual({ used: 1, limit: 5, period: "total", alias: "a" })
  })

  test("tolerates a malformed payload", () => {
    expect(matchKeyUsage(undefined, PROD_KEY)).toEqual({})
    expect(matchKeyUsage({ code: 0, data: null }, PROD_KEY)).toEqual({})
  })
})

describe("resolveClickzettaEntry", () => {
  test("prefers the provider the TUI currently has selected", () => {
    expect(resolveClickzettaEntry("prod_0")).toEqual({ name: "prod_0", apiKey: PROD_KEY })
  })

  test("falls back to the configured active model when no provider is passed", () => {
    setActiveModel("dev_0/deepseek-v3.2")
    expect(resolveClickzettaEntry()).toEqual({ name: "dev_0", apiKey: DEV_KEY })
  })

  // Rendering nothing is the requirement here: the indicator shares a row with
  // the model label and must not show an error for a non-ClickZetta provider.
  test("returns nothing when the selected provider is not clickzetta", () => {
    setActiveModel("claude/claude-sonnet-4")
    expect(resolveClickzettaEntry("claude")).toBeUndefined()
  })

  test("does not infer an LLM from the unrelated current Profile", () => {
    const previous = process.env.CZ_PROFILE
    process.env.CZ_PROFILE = "prod_0"
    try {
      expect(resolveClickzettaEntry()).toBeUndefined()
    } finally {
      if (previous === undefined) delete process.env.CZ_PROFILE
      else process.env.CZ_PROFILE = previous
    }
  })

  test("falls back to the sole clickzetta entry when it is unambiguous", () => {
    writeLlmEntries({
      llm: {
        only: { provider: "clickzetta", api_key: PROD_KEY, base_url: "https://aimesh.example.com/gateway/v1" },
        claude: { provider: "anthropic", api_key: "sk-ant-xxx" },
      },
    })
    expect(resolveClickzettaEntry()).toEqual({ name: "only", apiKey: PROD_KEY })
  })

  // Guessing between tenants would report a quota for the wrong account.
  test("declines to guess when several clickzetta entries exist", () => {
    expect(resolveClickzettaEntry()).toBeUndefined()
  })

  // An explicit non-ClickZetta selection must not fall through to a ClickZetta
  // entry: that quota is not the one the current model consumes.
  test("does not fall back when the selected provider is a known non-clickzetta one", () => {
    const previous = process.env.CZ_PROFILE
    process.env.CZ_PROFILE = "prod_0"
    try {
      expect(resolveClickzettaEntry("claude")).toBeUndefined()
    } finally {
      if (previous === undefined) delete process.env.CZ_PROFILE
      else process.env.CZ_PROFILE = previous
    }
  })

  test("returns nothing when the selected provider is unknown", () => {
    writeLlmEntries({
      llm: {
        only: { provider: "clickzetta", api_key: PROD_KEY, base_url: "https://aimesh.example.com/gateway/v1" },
      },
    })
    expect(resolveClickzettaEntry("environment-provider")).toBeUndefined()
  })
})

describe("selectDisplayedProvider", () => {
  const providers = [
    { id: "prod_0", models: { prod: {} } },
    { id: "dev_0", models: { "deepseek-v3.2": {} } },
  ]

  test("prefers a pinned model's provider", () => {
    expect(
      selectDisplayedProvider({
        configModel: "dev_0/deepseek-v3.2",
        recent: [{ providerID: "prod_0", modelID: "prod" }],
        providers,
      }),
    ).toBe("dev_0")
  })

  // The launch profile does not decide this — the TUI's own history does, so the
  // indicator has to follow the same order or it reports a key the session isn't
  // spending.
  test("falls back to the newest recent provider when nothing is pinned", () => {
    expect(
      selectDisplayedProvider({
        recent: [
          { providerID: "prod_0", modelID: "prod" },
          { providerID: "dev_0", modelID: "deepseek-v3.2" },
        ],
        providers: [providers[1]!, providers[0]!],
      }),
    ).toBe("prod_0")
  })

  test("skips recent models that no longer exist", () => {
    expect(
      selectDisplayedProvider({
        recent: [
          { providerID: "prod_0", modelID: "gone" },
          { providerID: "dev_0", modelID: "deepseek-v3.2" },
        ],
        providers,
      }),
    ).toBe("dev_0")
  })

  test("ignores a pinned model that is no longer available", () => {
    expect(selectDisplayedProvider({ configModel: "prod_0/gone", recent: [], providers })).toBe("prod_0")
  })

  test("falls back to the first available provider", () => {
    expect(selectDisplayedProvider({ providers })).toBe("prod_0")
  })

  test("returns nothing when there are no providers", () => {
    expect(selectDisplayedProvider({ providers: [] })).toBeUndefined()
  })
})

describe("readRecentProviders", () => {
  test("reads the TUI's persisted recent list", () => {
    const dir = join(requireTestHome(), ".clickzetta")
    writeFileSync(join(dir, "model.json"), JSON.stringify({ recent: [{ providerID: "prod_0", modelID: "x" }] }))
    expect(readRecentProviders(dir)).toEqual([{ providerID: "prod_0", modelID: "x" }])
  })

  test("treats a missing or malformed state file as no history", () => {
    const dir = join(requireTestHome(), ".clickzetta")
    expect(readRecentProviders(join(dir, "nope"))).toEqual([])
    writeFileSync(join(dir, "model.json"), "{not json")
    expect(readRecentProviders(dir)).toEqual([])
  })
})

describe("fetchQuotaSnapshot", () => {
  test("reports current Profile balance and the selected LLM key's usage independently", async () => {
    stubPortal()
    const snapshot = await fetchQuotaSnapshot({ providerID: "prod_0" })
    expect(snapshot).toEqual({
      cash: 0,
      owe: 0,
      used: 10_082_801,
      limit: 10_000_000,
      period: "total",
      alias: "cz-code_auto_pdiaxzjq",
    })
  })

  test("finds an LLM key even when no same-named Profile exists", async () => {
    const seen = stubPortal()
    const snapshot = await fetchQuotaSnapshot({ providerID: "cc-sh" })
    expect(seen.some((url) => url.includes("dev-api.clickzetta.com"))).toBe(true)
    expect(seen.some((url) => url.includes("cn-shanghai-alicloud.api.clickzetta.com"))).toBe(true)
    expect(snapshot).toMatchObject({ cash: 0, alias: "cz-code_auto_pdiaxzjq", used: 10_082_801 })
  })

  test("handles the dev portal's 200 success code and daily window", async () => {
    const seen = stubPortal()
    const snapshot = await fetchQuotaSnapshot({ providerID: "dev_0" })
    expect(snapshot).toMatchObject({ cash: 0, used: 0, limit: 10_000_000, period: "daily" })
    expect(seen.some((url) => url.includes("cn-shanghai-alicloud.api.clickzetta.com"))).toBe(false)
  })

  test("honors CZ_PROFILE for balance without changing which LLM key is measured", async () => {
    const previous = {
      profile: process.env.CZ_PROFILE,
      service: process.env.CZ_SERVICE,
      instance: process.env.CZ_INSTANCE,
    }
    process.env.CZ_PROFILE = "prod_0"
    process.env.CZ_SERVICE = "cn-shanghai-alicloud.api.clickzetta.com"
    process.env.CZ_INSTANCE = "inst-prod"
    try {
      const seen = stubPortal()
      const snapshot = await fetchQuotaSnapshot({ providerID: "dev_0" })
      expect(seen.some((url) => url.includes("dev-api.clickzetta.com"))).toBe(true)
      expect(seen.some((url) => url.includes("cn-shanghai-alicloud.api.clickzetta.com"))).toBe(true)
      expect(snapshot).toMatchObject({ cash: 51.2772, alias: "cz-code_auto_wynptmks", used: 0 })
    } finally {
      for (const [key, value] of [
        ["CZ_PROFILE", previous.profile],
        ["CZ_SERVICE", previous.service],
        ["CZ_INSTANCE", previous.instance],
      ] as const) {
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
      }
    }
  })

  test("returns undefined for a non-clickzetta provider without any request", async () => {
    const seen: string[] = []
    onFetch({
      match: (url) => {
        seen.push(url)
        return false
      },
      respond: () => ({}),
    })
    expect(await fetchQuotaSnapshot({ providerID: "claude" })).toBeUndefined()
    expect(seen).toEqual([])
  })

  // Independent reads: an account with no billing record still has a usable quota.
  test("still reports quota when the billing read fails", async () => {
    onFetch({
      match: (url) => url.includes("/hornhub/account/billing/"),
      respond: () => new Response("nope", { status: 500 }),
    })
    stubPortal()
    const snapshot = await fetchQuotaSnapshot({ providerID: "prod_0" })
    expect(snapshot?.cash).toBeUndefined()
    expect(snapshot?.used).toBe(10_082_801)
  })

  test("still reports balance when the key listing fails", async () => {
    onFetch({
      match: (url) => url.includes("/user/listApiKeys"),
      respond: () => new Response("nope", { status: 500 }),
    })
    stubPortal()
    const snapshot = await fetchQuotaSnapshot({ providerID: "prod_0" })
    expect(snapshot?.cash).toBe(0)
    expect(snapshot?.used).toBeUndefined()
  })

  // A total outage must surface as a rejection so the caller keeps the last good
  // reading instead of replacing it with an empty one.
  test("throws when both reads fail", async () => {
    onPath("/clickzetta-portal/user/loginSingle", () => ({
      code: 0,
      data: { token: "portal-token", instanceId: 1, userId: 2, expireTime: 3_600_000 },
    }))
    onFetch({
      match: (url) => url.includes("/clickzetta-portal/"),
      respond: () => new Response("nope", { status: 503 }),
    })
    await expect(fetchQuotaSnapshot({ providerID: "prod_0" })).rejects.toThrow()
  })
})

// The live portal is method-sensitive and inverts what the URLs imply:
// getCurrentUser only answers to POST, while listApiKeys and the billing route
// only answer to GET; the wrong verb yields code 8888 with data:null. The
// original stubPortal ignores method, so it could not catch a read issued with
// the wrong verb — the exact defect that left the quota indicator blank.
describe("fetchQuotaSnapshot — portal method sensitivity", () => {
  function stubMethodStrictPortal(opts: { currentUserPostFails?: boolean } = {}) {
    onPath("/clickzetta-portal/user/loginSingle", () => ({
      code: 0,
      data: { token: "portal-token", instanceId: 1, userId: 2, expireTime: 3_600_000 },
    }))
    const err8888 = { code: 8888, message: "unknown error", data: null }
    onFetch({
      match: (url) => url.includes("/clickzetta-portal/"),
      respond: (url, method) => {
        if (url.includes("/user/getCurrentUser")) {
          if (method !== "POST") return err8888
          if (opts.currentUserPostFails) return err8888
          return { code: 0, data: { id: 2, accountId: 228044, name: "pdiaxzjq", instanceId: 1 } }
        }
        if (url.includes("/hornhub/account/billing/account/")) {
          if (method !== "GET") return err8888
          return { code: 0, data: { cashAmount: 51.2772, oweAmount: 0, accountName: "pdiaxzjq" } }
        }
        if (url.includes("/user/listApiKeys")) {
          if (method !== "GET") return err8888
          return {
            code: 0,
            data: [
              {
                id: 587,
                status: 1,
                type: "free",
                rateLimitType: "quota_total",
                rateLimitValue: 10_000_000,
                usage: 10_082_801,
                vapiKeyAlias: "cz-code_auto_pdiaxzjq",
                vapiKeyMasked: "ff52****9bc8",
              },
            ],
          }
        }
        throw new Error(`unexpected portal path ${url}`)
      },
    })
  }

  test("resolves usage when each endpoint is called with the verb it requires", async () => {
    stubMethodStrictPortal()
    const snapshot = await fetchQuotaSnapshot({ providerID: "prod_0" })
    expect(snapshot).toMatchObject({ used: 10_082_801, limit: 10_000_000, period: "total" })
  })

  // listApiKeys scopes to the token identity and ignores the userName value, so
  // a failed getCurrentUser must not sink the whole quota read.
  test("falls back to an empty userName when getCurrentUser fails", async () => {
    stubMethodStrictPortal({ currentUserPostFails: true })
    const snapshot = await fetchQuotaSnapshot({ providerID: "prod_0" })
    expect(snapshot).toMatchObject({ used: 10_082_801, limit: 10_000_000 })
  })
})

/**
 * The cash balance is a property of the connection Profile and does NOT depend on
 * which LLM key is in play. It used to: fetchQuotaSnapshot bailed on the shared
 * `resolveClickzettaEntry` exit, so any failure to pin an LLM entry also removed
 * the balance — and issued zero portal requests, so "no balance" was really "never
 * asked". Users saw both figures vanish and no way to tell which half was broken.
 */
describe("balance survives an unresolvable LLM entry", () => {
  test("reports the balance when several ClickZetta entries make the key ambiguous", async () => {
    // writeEntries() defines three ClickZetta entries and nothing pins one, so no
    // key can be named. Pre-fix this returned undefined and skipped every read.
    setActiveModel("")
    stubPortal()
    const snapshot = await fetchQuotaSnapshot({})
    expect(snapshot).toMatchObject({ cash: 0 })
    // Quota is genuinely unknowable here — absent, not guessed from another tenant.
    expect(snapshot?.used).toBeUndefined()
    expect(snapshot?.limit).toBeUndefined()
  })

  test("reports the balance when the pinned ClickZetta entry has no api_key", async () => {
    writeLlmEntries({ llm: { keyless: { provider: "clickzetta", base_url: "https://aimesh.example.com/gateway/v1" } } })
    setActiveModel("keyless/deepseek-v3.2")
    stubPortal()
    const snapshot = await fetchQuotaSnapshot({})
    expect(snapshot).toMatchObject({ cash: 0 })
    expect(snapshot?.used).toBeUndefined()
  })

  // The one case that SHOULD hide everything: a ¥ figure next to a Claude model
  // would name money that model is not spending.
  test("still renders nothing when the session is on a foreign provider", async () => {
    stubPortal()
    expect(await fetchQuotaSnapshot({ providerID: "claude" })).toBeUndefined()
  })

  test("still renders nothing when no ClickZetta entry exists at all", async () => {
    writeLlmEntries({ llm: { claude: { provider: "anthropic", api_key: "sk-ant-xxx" } } })
    setActiveModel("")
    stubPortal()
    expect(await fetchQuotaSnapshot({})).toBeUndefined()
  })

  /**
   * Walking past the current profile only serves the quota hunt (finding the portal
   * that knows this key). With no key there is nothing to hunt, and continuing hides
   * failures: a later profile's empty-but-successful snapshot lands in `loaded` and
   * swallows the current profile's real error, so a broken balance read renders as a
   * silent blank indistinguishable from "nothing to show". Caught on a live config
   * where the default profile's host was unreachable and the result was `{}`.
   */
  test("surfaces the balance error instead of masking it with another profile", async () => {
    // dev_0 is the default profile; make only ITS billing read fail. prod_0 would
    // otherwise answer successfully and hide it.
    onFetch({
      match: (url) => url.includes("dev-api.clickzetta.com") && url.includes("/hornhub/account/billing/"),
      respond: () => {
        throw new Error("billing unreachable")
      },
    })
    stubPortal()
    setActiveModel("")
    await expect(fetchQuotaSnapshot({})).rejects.toThrow("billing unreachable")
  })
})

describe("readProfileInfo", () => {
  test("reports the active profile's identity and connection target", () => {
    const previous = process.env.CZ_PROFILE
    process.env.CZ_PROFILE = "prod_0"
    try {
      expect(readProfileInfo()).toEqual({
        profile: "prod_0",
        authType: "pat",
        accountName: "prod-account",
        userName: undefined,
        region: "cn-shanghai-alicloud",
        instance: "inst-prod",
        workspace: "quick_start",
      })
    } finally {
      if (previous === undefined) delete process.env.CZ_PROFILE
      else process.env.CZ_PROFILE = previous
    }
  })

  // The region label comes off the service host, so an environment host reports the
  // environment rather than a bogus region.
  test("derives the region from the service host", () => {
    const previous = process.env.CZ_PROFILE
    process.env.CZ_PROFILE = "dev_0"
    try {
      expect(readProfileInfo()?.region).toBe("dev")
    } finally {
      if (previous === undefined) delete process.env.CZ_PROFILE
      else process.env.CZ_PROFILE = previous
    }
  })

  // This half must never need the network: it is the part of the section that has
  // to stay on screen when the portal is unreachable or does not serve the host.
  test("resolves with no portal handler registered at all", () => {
    const previous = process.env.CZ_PROFILE
    process.env.CZ_PROFILE = "prod_0"
    onFetch({ match: () => true, respond: () => { throw new Error("no network expected") } })
    try {
      expect(readProfileInfo()?.profile).toBe("prod_0")
    } finally {
      if (previous === undefined) delete process.env.CZ_PROFILE
      else process.env.CZ_PROFILE = previous
    }
  })
})

describe("centralPortalHost", () => {
  test("drops a region label from a regional api host", () => {
    expect(centralPortalHost("https://ap-shanghai-tencentcloud.api.clickzetta.com")).toBe("https://api.clickzetta.com")
    expect(centralPortalHost("https://cn-shanghai-alicloud.api.clickzetta.com")).toBe("https://api.clickzetta.com")
    expect(centralPortalHost("https://ap-southeast-1-aws.api.singdata.com")).toBe("https://api.singdata.com")
  })

  // These are environment labels, not region segments: the label is part of
  // `uat-api` / `dev-api` rather than a segment before `api.`. Verified against
  // both hosts — they serve these routes as-is, so rewriting them would break the
  // deployments that currently work.
  test("leaves environment hosts and an already-central host alone", () => {
    expect(centralPortalHost("https://uat-api.clickzetta.com")).toBeUndefined()
    expect(centralPortalHost("https://dev-api.clickzetta.com")).toBeUndefined()
    expect(centralPortalHost("https://api.clickzetta.com")).toBeUndefined()
    expect(centralPortalHost("http://localhost:8080")).toBeUndefined()
  })
})

describe("portal reads fall back to the central host", () => {
  // The measured failure: a tencentcloud-region host answers HTTP 200 with the
  // portal's own error code 8888 for both reads, while the same token against the
  // central host returns the data. Without the fallback the indicator silently
  // showed nothing for any such profile.
  test("recovers a balance when the profile's own host answers 8888", async () => {
    const seen: string[] = []
    onPath("/clickzetta-portal/user/loginSingle", () => ({
      code: 0,
      data: { token: "portal-token", instanceId: 1, userId: 2, expireTime: 3_600_000 },
    }))
    onFetch({
      match: (url) => url.includes("/clickzetta-portal/"),
      respond: (url) => {
        seen.push(url)
        // Region host: HTTP 200 but a business error, exactly as observed.
        if (url.includes("cn-shanghai-alicloud.api.clickzetta.com")) {
          return { code: 8888, message: "未知异常", data: null }
        }
        if (url.includes("/hornhub/account/billing/account/")) {
          return { code: 0, data: { cashAmount: 12.5, oweAmount: 0 } }
        }
        if (url.includes("/user/listApiKeys")) return { code: 0, data: [] }
        if (url.includes("/user/getCurrentUser")) return { code: 0, data: { name: "who" } }
        throw new Error(`unexpected portal path ${url}`)
      },
    })

    const previous = process.env.CZ_PROFILE
    process.env.CZ_PROFILE = "prod_0"
    try {
      const snapshot = await fetchQuotaSnapshot({ providerID: "prod_0" })
      expect(snapshot?.cash).toBe(12.5)
      expect(seen.some((url) => url.includes("cn-shanghai-alicloud.api.clickzetta.com"))).toBe(true)
      expect(seen.some((url) => url.includes("//api.clickzetta.com"))).toBe(true)
    } finally {
      if (previous === undefined) delete process.env.CZ_PROFILE
      else process.env.CZ_PROFILE = previous
    }
  })

  // The profile's own host must stay the primary: only two deployments could be
  // verified first-hand, so a working host must never be second-guessed.
  test("does not touch the central host when the profile's own host answers", async () => {
    const seen: string[] = []
    onPath("/clickzetta-portal/user/loginSingle", () => ({
      code: 0,
      data: { token: "portal-token", instanceId: 1, userId: 2, expireTime: 3_600_000 },
    }))
    onFetch({
      match: (url) => url.includes("/clickzetta-portal/"),
      respond: (url) => {
        seen.push(url)
        if (url.includes("/hornhub/account/billing/account/")) {
          return { code: 0, data: { cashAmount: 7, oweAmount: 0 } }
        }
        if (url.includes("/user/listApiKeys")) return { code: 0, data: [] }
        if (url.includes("/user/getCurrentUser")) return { code: 0, data: { name: "who" } }
        throw new Error(`unexpected portal path ${url}`)
      },
    })

    const previous = process.env.CZ_PROFILE
    process.env.CZ_PROFILE = "prod_0"
    try {
      const snapshot = await fetchQuotaSnapshot({ providerID: "prod_0" })
      expect(snapshot?.cash).toBe(7)
      expect(seen.some((url) => url.includes("//api.clickzetta.com"))).toBe(false)
    } finally {
      if (previous === undefined) delete process.env.CZ_PROFILE
      else process.env.CZ_PROFILE = previous
    }
  })
})
