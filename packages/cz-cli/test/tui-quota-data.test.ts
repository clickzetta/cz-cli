import { beforeEach, describe, expect, test } from "bun:test"
import { writeFileSync } from "node:fs"
import { join } from "node:path"
import { onFetch, onPath } from "./support/fetch-boundary"
import { requireTestHome } from "./support/cz-fixtures"
import { clearTokenCache } from "@clickzetta/sdk"
import { setActiveModel, writeLlmEntries } from "../src/llm/native-config"
import {
  centralPortalHost,
  clearUnservedHostForTest,
  clearUserNameCacheForTest,
  fetchProfileUserName,
  fetchQuotaSnapshot,
  isPortalOk,
  readHeaderQuota,
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
      // listApiKeys is deliberately NOT stubbed: the token quota now comes from the
      // gateway's response headers, and any call to this route would be a regression
      // back to the retired portal poll. Reaching the throw below is the assertion.
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
  // portalRead's unserved-host memory is process-global too; without this, a
  // test that gets its region host marked unserved leaks that into a later
  // test using the SAME host with a different fixture (a healthy region host,
  // or an error the test expects to be rethrown).
  clearUnservedHostForTest()
  // Same reasoning as above, for fetchProfileUserName's per-profile name cache.
  clearUserNameCacheForTest()
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
  test("reports the current Profile's balance", async () => {
    stubPortal()
    expect(await fetchQuotaSnapshot({ providerID: "prod_0" })).toEqual({ cash: 0, owe: 0 })
  })

  /**
   * The balance belongs to the current Profile and to nothing else. This used to walk
   * every configured Profile hunting the portal that knew the selected virtual key —
   * a search that existed only for the token quota, which now arrives on the
   * gateway's own response headers. One Profile, one read.
   */
  test("reads only the current Profile, whatever LLM entry is selected", async () => {
    const seen = stubPortal()
    await fetchQuotaSnapshot({ providerID: "prod_0" })
    expect(seen.some((url) => url.includes("dev-api.clickzetta.com"))).toBe(true)
    expect(seen.some((url) => url.includes("cn-shanghai-alicloud.api.clickzetta.com"))).toBe(false)
  })

  test("honors CZ_PROFILE for which account's balance is read", async () => {
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
      expect(await fetchQuotaSnapshot({ providerID: "dev_0" })).toMatchObject({ cash: 51.2772 })
      expect(seen.some((url) => url.includes("cn-shanghai-alicloud.api.clickzetta.com"))).toBe(true)
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

  /**
   * A `current` that names a profile absent from profiles.toml — stale CZ_PROFILE, or a
   * default_profile pointing at a deleted profile — must not fall back to whichever
   * profile happens to be first in the file: that paints ANOTHER TENANT'S cash balance
   * under the user's own Profile section, which readProfileInfo (same file) already
   * refuses to do for the identity rows. No request either — there is no account to ask
   * about.
   */
  test("a current profile absent from the file reports no balance, and sends no request", async () => {
    const previous = process.env.CZ_PROFILE
    process.env.CZ_PROFILE = "deleted_profile"
    try {
      const seen: string[] = []
      onFetch({
        match: (url) => {
          seen.push(url)
          return false
        },
        respond: () => ({}),
      })
      expect(await fetchQuotaSnapshot({ providerID: "prod_0" })).toEqual({})
      expect(seen).toEqual([])
    } finally {
      if (previous === undefined) delete process.env.CZ_PROFILE
      else process.env.CZ_PROFILE = previous
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

  // A rejection is what tells the caller to keep the last good reading instead of
  // replacing it with an empty one.
  test("throws when the billing read fails", async () => {
    onFetch({
      match: (url) => url.includes("/hornhub/account/billing/"),
      respond: () => new Response("nope", { status: 500 }),
    })
    stubPortal()
    await expect(fetchQuotaSnapshot({ providerID: "prod_0" })).rejects.toThrow()
  })

  /**
   * A profile with no account_id can never name whose balance to read. Resolving to
   * nothing is right; throwing would make the caller pin the previous profile's
   * balance — someone else's money — for the rest of the session.
   */
  /**
   * Nothing pinned at all — no CZ_PROFILE, no default_profile — is the one input where the
   * old code showed no balance: it gated billing on `name === current`, and with `current`
   * undefined that was false for every profile. Now the first TOML profile's balance is
   * read, which is deliberate: readProfileInfo already names that same profile as the
   * session's identity, so a figure beside it belongs to the account being shown. Pinned
   * here because it is the one place old and new differ.
   */
  test("with nothing pinned, the first profile's balance is read", async () => {
    const previous = process.env.CZ_PROFILE
    delete process.env.CZ_PROFILE
    writeFileSync(
      join(requireTestHome(), ".clickzetta", "profiles.toml"),
      [
        "[profiles.first]",
        "pat = 'pat-first'",
        "service = 'dev-api.clickzetta.com'",
        "instance = 'i'",
        "account_id = 112407",
        "",
      ].join("\n"),
    )
    try {
      const seen = stubPortal()
      expect(await fetchQuotaSnapshot({ providerID: "prod_0" })).toMatchObject({ cash: 0 })
      expect(seen.some((url) => url.includes("dev-api.clickzetta.com"))).toBe(true)
    } finally {
      if (previous === undefined) delete process.env.CZ_PROFILE
      else process.env.CZ_PROFILE = previous
    }
  })

  test("resolves to nothing, without a request, when the profile has no account_id", async () => {
    writeFileSync(
      join(requireTestHome(), ".clickzetta", "profiles.toml"),
      ["default_profile = 'bare'", "", "[profiles.bare]", "pat = 'pat-bare'", "service = 'dev-api.clickzetta.com'", "instance = 'i'", ""].join("\n"),
    )
    const seen = stubPortal()
    expect(await fetchQuotaSnapshot({ providerID: "prod_0" })).toEqual({})
    expect(seen).toEqual([])
  })
})

// The live portal is method-sensitive and inverts what the URLs imply: getCurrentUser
// only answers to POST while the billing route only answers to GET; the wrong verb
// yields code 8888 with data:null. stubPortal ignores method, so it cannot catch a
// read issued with the wrong verb — the exact defect that left the indicator blank.
describe("fetchQuotaSnapshot — portal method sensitivity", () => {
  test("reads billing with the verb it requires", async () => {
    onPath("/clickzetta-portal/user/loginSingle", () => ({
      code: 0,
      data: { token: "portal-token", instanceId: 1, userId: 2, expireTime: 3_600_000 },
    }))
    onFetch({
      match: (url) => url.includes("/clickzetta-portal/"),
      respond: (url, method) => {
        if (!url.includes("/hornhub/account/billing/account/")) throw new Error(`unexpected portal path ${url}`)
        if (method !== "GET") return { code: 8888, message: "unknown error", data: null }
        return { code: 0, data: { cashAmount: 51.2772, oweAmount: 0, accountName: "pdiaxzjq" } }
      },
    })
    expect(await fetchQuotaSnapshot({ providerID: "prod_0" })).toMatchObject({ cash: 51.2772 })
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
    expect(await fetchQuotaSnapshot({})).toMatchObject({ cash: 0 })
  })

  test("reports the balance when the pinned ClickZetta entry has no api_key", async () => {
    writeLlmEntries({ llm: { keyless: { provider: "clickzetta", base_url: "https://aimesh.example.com/gateway/v1" } } })
    setActiveModel("keyless/deepseek-v3.2")
    stubPortal()
    expect(await fetchQuotaSnapshot({})).toMatchObject({ cash: 0 })
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
})

/**
 * The token half. No portal, no network, no credentials, and no cache — the provider puts
 * the reading on the step's provider metadata, opencode carries it onto the step-finish
 * part, and this reads it back off the TUI's own state store.
 */
describe("readHeaderQuota", () => {
  const QUOTA = [
    { period: "daily" as const, periodCode: "PDO", limit: 10_000_000, used: 238, remaining: 9_999_762, scope: "api-key" },
  ]
  const step = (quota?: unknown) => ({
    type: "step-finish",
    ...(quota === undefined ? {} : { metadata: { clickzetta: { quota } } }),
  })
  /** One assistant message with the given parts, as the state store would hand them over. */
  const store = (input: { providerID: string; parts: unknown[] }) => ({
    messages: [{ role: "assistant", id: "msg_1", providerID: input.providerID }],
    parts: () => input.parts as never,
  })

  test("reads the quota off the step-finish part of an assistant message", () => {
    expect(readHeaderQuota(store({ providerID: "prod_0", parts: [step(QUOTA)] }))).toEqual(QUOTA)
  })

  test("the newest reading wins", () => {
    const later = [{ ...QUOTA[0]!, used: 500, remaining: 9_999_500 }]
    expect(readHeaderQuota(store({ providerID: "prod_0", parts: [step(QUOTA), step(later)] }))).toEqual(later)
  })

  /**
   * Quota is charged to the key that served the request, and the message names its own
   * provider — so a reading from a model the user has since switched away from must not be
   * painted under the new one.
   */
  test("a reading from another provider is not borrowed", () => {
    expect(
      readHeaderQuota({ ...store({ providerID: "dev_0", parts: [step(QUOTA)] }), providerID: "prod_0" }),
    ).toBeUndefined()
  })

  test("without a provider filter any reading answers", () => {
    expect(readHeaderQuota(store({ providerID: "dev_0", parts: [step(QUOTA)] }))).toEqual(QUOTA)
  })

  /** An older message still answers once the newest one has nothing to say. */
  test("walks back past a message that reported nothing", () => {
    const parts: Record<string, unknown[]> = { msg_1: [step(QUOTA)], msg_2: [step()] }
    expect(
      readHeaderQuota({
        messages: [
          { role: "assistant", id: "msg_1", providerID: "prod_0" },
          { role: "assistant", id: "msg_2", providerID: "prod_0" },
        ],
        parts: (id) => (parts[id] ?? []) as never,
      }),
    ).toEqual(QUOTA)
  })

  /** A turn aborted mid-stream has no step-finish part: absent, not stale. */
  test("a step that never finished reports nothing", () => {
    expect(readHeaderQuota(store({ providerID: "prod_0", parts: [{ type: "text", text: "hi" }] }))).toBeUndefined()
  })

  test("a gateway that sends no quota headers leaves the part bare", () => {
    expect(readHeaderQuota(store({ providerID: "prod_0", parts: [step()] }))).toBeUndefined()
  })

  test("user messages are skipped", () => {
    expect(
      readHeaderQuota({ messages: [{ role: "user", id: "msg_1" }], parts: () => [step(QUOTA)] as never }),
    ).toBeUndefined()
  })

  /** The metadata crossed a wire as JSON, so a malformed payload must read as nothing. */
  test("a malformed payload reads as nothing, not as a row", () => {
    for (const bad of [null, "PDO", 42, [], [{ noPeriodCode: true }]]) {
      expect(readHeaderQuota(store({ providerID: "prod_0", parts: [step(bad)] }))).toBeUndefined()
    }
  })

  test("nothing in the session reads as nothing", () => {
    expect(readHeaderQuota({ messages: [], parts: () => [] })).toBeUndefined()
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
        env: undefined,
        region: "cn-shanghai-alicloud",
        instance: "inst-prod",
        workspace: "quick_start",
      })
    } finally {
      if (previous === undefined) delete process.env.CZ_PROFILE
      else process.env.CZ_PROFILE = previous
    }
  })

  // The env label comes off the service host, so an environment host reports the
  // environment rather than a bogus "prod".
  test("derives the env from the service host", () => {
    const previous = process.env.CZ_PROFILE
    process.env.CZ_PROFILE = "dev_0"
    try {
      expect(readProfileInfo()?.env).toBe("dev")
      expect(readProfileInfo()?.region).toBeUndefined()
    } finally {
      if (previous === undefined) delete process.env.CZ_PROFILE
      else process.env.CZ_PROFILE = previous
    }
  })

  // env and region are different facts, not alternatives: a regional host IS
  // production, so it must not report an env at all (which would invite reading
  // "no env" as "not prod") while it DOES report which region.
  test("reports region rather than env for a regional host, and never both", () => {
    const previous = process.env.CZ_PROFILE
    process.env.CZ_PROFILE = "prod_0"
    try {
      const info = readProfileInfo()
      expect(info?.region).toBe("cn-shanghai-alicloud")
      expect(info?.env).toBeUndefined()
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

  // A custom/private domain must render nothing rather than a fabricated "prod":
  // this panel's job is telling the user which deployment they're pointed at, and
  // an invented answer is worse than an absent row.
  test("omits env for a custom domain detectEnv would have guessed \"prod\" for", () => {
    writeFileSync(
      join(requireTestHome(), ".clickzetta", "profiles.toml"),
      ["[profiles.private_0]", "pat = 'pat-private'", "service = 'cn-east.api.acme-internal.example'"].join("\n"),
    )
    const previous = process.env.CZ_PROFILE
    process.env.CZ_PROFILE = "private_0"
    try {
      expect(readProfileInfo()?.env).toBeUndefined()
    } finally {
      if (previous === undefined) delete process.env.CZ_PROFILE
      else process.env.CZ_PROFILE = previous
    }
  })

  // A stale/typo'd CZ_PROFILE naming a profile absent from the file must render
  // nothing, not silently substitute a different tenant's identity.
  test("renders nothing when CZ_PROFILE names a profile absent from the file", () => {
    const previous = process.env.CZ_PROFILE
    process.env.CZ_PROFILE = "does_not_exist"
    try {
      expect(readProfileInfo()).toBeUndefined()
    } finally {
      if (previous === undefined) delete process.env.CZ_PROFILE
      else process.env.CZ_PROFILE = previous
    }
  })
})

describe("fetchProfileUserName", () => {
  // prod_0's TOML block carries no `username` (it's a `pat` profile) — the exact
  // shape that needs the portal round-trip, not the direct-from-TOML shortcut.
  test("resolves via the portal and tags the result with the profile it came from", async () => {
    onPath("/clickzetta-portal/user/loginSingle", () => ({
      code: 0,
      data: { token: "portal-token", instanceId: 1, userId: 2, expireTime: 3_600_000 },
    }))
    onFetch({
      match: (url) => url.includes("/clickzetta-portal/"),
      respond: (url) => {
        if (url.includes("/user/getCurrentUser")) return { code: 0, data: { name: "pdiaxzjq" } }
        throw new Error(`unexpected portal path ${url}`)
      },
    })

    const previous = process.env.CZ_PROFILE
    process.env.CZ_PROFILE = "prod_0"
    try {
      expect(await fetchProfileUserName()).toEqual({ profile: "prod_0", name: "pdiaxzjq" })
    } finally {
      if (previous === undefined) delete process.env.CZ_PROFILE
      else process.env.CZ_PROFILE = previous
    }
  })

  test("returns undefined rather than throwing when the portal fails", async () => {
    onPath("/clickzetta-portal/user/loginSingle", () => ({
      code: 0,
      data: { token: "portal-token", instanceId: 1, userId: 2, expireTime: 3_600_000 },
    }))
    onFetch({
      match: (url) => url.includes("/clickzetta-portal/"),
      respond: () => new Response("nope", { status: 500 }),
    })

    const previous = process.env.CZ_PROFILE
    process.env.CZ_PROFILE = "prod_0"
    try {
      expect(await fetchProfileUserName()).toBeUndefined()
    } finally {
      if (previous === undefined) delete process.env.CZ_PROFILE
      else process.env.CZ_PROFILE = previous
    }
  })

  // A profile with `username` already in its TOML block (password auth) never
  // touches the network at all — the value comes straight from readProfileInfo.
  test("returns the TOML username with no portal call for a password profile", async () => {
    writeFileSync(
      join(requireTestHome(), ".clickzetta", "profiles.toml"),
      ["[profiles.pw_0]", "username = 'alice'", "password = 'secret'"].join("\n"),
    )
    onFetch({ match: () => true, respond: () => { throw new Error("no network expected") } })

    const previous = process.env.CZ_PROFILE
    process.env.CZ_PROFILE = "pw_0"
    try {
      expect(await fetchProfileUserName()).toEqual({ profile: "pw_0", name: "alice" })
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

  // The root is pinned to the two measured domains. A private/enterprise deployment
  // names its own domain in profiles.toml's `service` field, and that domain was
  // never verified to serve these routes at any host — rewriting it would send the
  // profile's portal token to a host the tenant never configured.
  test("does not rewrite a host outside clickzetta.com/singdata.com", () => {
    expect(centralPortalHost("https://cn-east.api.acme-internal.example")).toBeUndefined()
    expect(centralPortalHost("https://region.api.clickzetta.com.evil.example")).toBeUndefined()
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

  // A THROWN first attempt (transport/auth failure, not a business-code error) must
  // win over an unusable central-host answer: retrying a different host cannot fix
  // a network error, and swallowing it into a resolved-but-empty payload would
  // overwrite fetchQuotaSnapshot's last-good snapshot instead of preserving it.
  // Both reads fail here (not just billing) so the failure actually surfaces as a
  // rejection per the guards in fetchQuotaSnapshot/fetchProfileSnapshot — see
  // "throws when both reads fail" above for why a billing-only failure resolves.
  test("rethrows the profile host's own error when the central host is also unusable", async () => {
    onPath("/clickzetta-portal/user/loginSingle", () => ({
      code: 0,
      data: { token: "portal-token", instanceId: 1, userId: 2, expireTime: 3_600_000 },
    }))
    onFetch({
      match: (url) => url.includes("/clickzetta-portal/"),
      respond: (url) => {
        if (url.includes("cn-shanghai-alicloud.api.clickzetta.com")) {
          throw new Error("connection reset")
        }
        if (url.includes("//api.clickzetta.com")) {
          return { code: 8888, message: "未知异常", data: null }
        }
        throw new Error(`unexpected portal path ${url}`)
      },
    })

    const previous = process.env.CZ_PROFILE
    process.env.CZ_PROFILE = "prod_0"
    try {
      await expect(fetchQuotaSnapshot({ providerID: "prod_0" })).rejects.toThrow("connection reset")
    } finally {
      if (previous === undefined) delete process.env.CZ_PROFILE
      else process.env.CZ_PROFILE = previous
    }
  })

  // Once the central host has PROVEN it can serve the route for a given baseUrl,
  // later reads against that same host skip the doomed first attempt entirely —
  // otherwise a session on this profile pays double the portal requests on every
  // refresh for as long as it runs, not once while the fallback is discovered.
  test("skips the region host on a later call once it is known unserved", async () => {
    const seen: string[] = []
    onPath("/clickzetta-portal/user/loginSingle", () => ({
      code: 0,
      data: { token: "portal-token", instanceId: 1, userId: 2, expireTime: 3_600_000 },
    }))
    onFetch({
      match: (url) => url.includes("/clickzetta-portal/"),
      respond: (url) => {
        seen.push(url)
        if (url.includes("cn-shanghai-alicloud.api.clickzetta.com")) {
          return { code: 8888, message: "未知异常", data: null }
        }
        if (url.includes("/hornhub/account/billing/account/")) {
          return { code: 0, data: { cashAmount: 12.5, oweAmount: 0 } }
        }
        if (url.includes("/user/getCurrentUser")) return { code: 0, data: { name: "who" } }
        throw new Error(`unexpected portal path ${url}`)
      },
    })

    const previous = process.env.CZ_PROFILE
    process.env.CZ_PROFILE = "prod_0"
    try {
      // Two CONSECUTIVE failures are required before the route is skipped — a
      // single failure must not permanently redirect it.
      await fetchQuotaSnapshot({ providerID: "prod_0" }) // strike 1
      await fetchQuotaSnapshot({ providerID: "prod_0" }) // strike 2: now unserved
      seen.length = 0
      await fetchQuotaSnapshot({ providerID: "prod_0" }) // third call: should skip straight to central
      expect(seen.some((url) => url.includes("cn-shanghai-alicloud.api.clickzetta.com"))).toBe(false)
      expect(seen.every((url) => url.includes("//api.clickzetta.com"))).toBe(true)
    } finally {
      if (previous === undefined) delete process.env.CZ_PROFILE
      else process.env.CZ_PROFILE = previous
    }
  })

  // A single transient business-code failure must NOT trigger the skip: the
  // threshold requires two CONSECUTIVE failures, and a successful direct read
  // in between resets the count.
  test("a single business-code failure does not skip the region host on the next call", async () => {
    const seen: string[] = []
    let regionFails = true
    onPath("/clickzetta-portal/user/loginSingle", () => ({
      code: 0,
      data: { token: "portal-token", instanceId: 1, userId: 2, expireTime: 3_600_000 },
    }))
    onFetch({
      match: (url) => url.includes("/clickzetta-portal/"),
      respond: (url) => {
        seen.push(url)
        if (url.includes("cn-shanghai-alicloud.api.clickzetta.com") && regionFails) {
          regionFails = false // only the FIRST region call fails
          return { code: 8888, message: "未知异常", data: null }
        }
        if (url.includes("/hornhub/account/billing/account/")) {
          return { code: 0, data: { cashAmount: 12.5, oweAmount: 0 } }
        }
        if (url.includes("/user/getCurrentUser")) return { code: 0, data: { name: "who" } }
        throw new Error(`unexpected portal path ${url}`)
      },
    })

    const previous = process.env.CZ_PROFILE
    process.env.CZ_PROFILE = "prod_0"
    try {
      await fetchQuotaSnapshot({ providerID: "prod_0" }) // one failure, then the direct retry (region host) succeeds
      seen.length = 0
      await fetchQuotaSnapshot({ providerID: "prod_0" }) // must still try the region host — one strike, not two
      expect(
        seen.some((url) => url.includes("cn-shanghai-alicloud.api.clickzetta.com") && url.includes("/hornhub/account/billing/")),
      ).toBe(true)
    } finally {
      if (previous === undefined) delete process.env.CZ_PROFILE
      else process.env.CZ_PROFILE = previous
    }
  })

  // unservedHost is keyed by baseUrl + path, not by host alone: a region host
  // that fails ONE route (the billing account read, business code 8888) must not
  // stop being asked for a DIFFERENT route (getCurrentUser) it actually serves. A
  // host-wide key would make the first failure redirect every later call for every
  // route.
  test("marking one route unserved does not redirect a different route on the same host", async () => {
    const seen: string[] = []
    onPath("/clickzetta-portal/user/loginSingle", () => ({
      code: 0,
      data: { token: "portal-token", instanceId: 1, userId: 2, expireTime: 3_600_000 },
    }))
    onFetch({
      match: (url) => url.includes("/clickzetta-portal/"),
      respond: (url) => {
        seen.push(url)
        if (url.includes("cn-shanghai-alicloud.api.clickzetta.com") && url.includes("/hornhub/account/billing/")) {
          return { code: 8888, message: "未知异常", data: null }
        }
        if (url.includes("/hornhub/account/billing/account/")) {
          return { code: 0, data: { cashAmount: 12.5, oweAmount: 0 } }
        }
        if (url.includes("/user/getCurrentUser")) return { code: 0, data: { name: "who" } }
        throw new Error(`unexpected portal path ${url}`)
      },
    })

    const previous = process.env.CZ_PROFILE
    process.env.CZ_PROFILE = "prod_0"
    try {
      // First call: the billing read against the region host fails (8888), promotes
      // that ROUTE to unserved and falls back to central for it.
      await fetchQuotaSnapshot({ providerID: "prod_0" })

      // Second call: getCurrentUser (a different route, same host) must still try
      // the region host first — it was never proven unserved for THIS route.
      seen.length = 0
      await fetchProfileUserName()
      expect(
        seen.some((url) => url.includes("cn-shanghai-alicloud.api.clickzetta.com") && url.includes("/user/getCurrentUser")),
      ).toBe(true)
    } finally {
      if (previous === undefined) delete process.env.CZ_PROFILE
      else process.env.CZ_PROFILE = previous
    }
  })
})
