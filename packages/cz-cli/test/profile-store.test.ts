import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

const previousHome = process.env.HOME
const previousTestHome = process.env.CLICKZETTA_TEST_HOME

afterEach(() => {
  if (previousHome === undefined) delete process.env.HOME
  else process.env.HOME = previousHome
  if (previousTestHome === undefined) delete process.env.CLICKZETTA_TEST_HOME
  else process.env.CLICKZETTA_TEST_HOME = previousTestHome
})

function writeProfilesToml(content: string) {
  const home = mkdtempSync(path.join(tmpdir(), "cz-cli-profile-store-"))
  const clickzettaDir = path.join(home, ".clickzetta")
  mkdirSync(clickzettaDir, { recursive: true })
  writeFileSync(path.join(clickzettaDir, "profiles.toml"), content)
  process.env.HOME = home
  process.env.CLICKZETTA_TEST_HOME = home
}

describe("readAgentEndpoint", () => {
  test("prefers profiles.<name>.analysis_agent_endpoint", async () => {
    writeProfilesToml([
      'default_profile = "default"',
      "",
      "[profiles.default]",
      'analysis_agent_endpoint = "https://analysis-agent.clickzetta.com"',
      "[profiles.default.agent]",
      'endpoint = "https://legacy-agent.clickzetta.com"',
      "",
    ].join("\n"))

    const { readAgentEndpoint } = await import(`../src/connection/profile-store.ts?${Date.now()}`)
    expect(readAgentEndpoint()).toBe("https://analysis-agent.clickzetta.com")
  })

  test("falls back to profiles.<name>.agent.endpoint", async () => {
    writeProfilesToml([
      'default_profile = "default"',
      "",
      "[profiles.default]",
      'service = "uat-api.clickzetta.com"',
      "[profiles.default.agent]",
      'endpoint = "https://legacy-agent.clickzetta.com"',
      "",
    ].join("\n"))

    const { readAgentEndpoint } = await import(`../src/connection/profile-store.ts?${Date.now()}`)
    expect(readAgentEndpoint()).toBe("https://legacy-agent.clickzetta.com")
  })

  test("infers endpoint from profile service when explicit endpoint is missing", async () => {
    writeProfilesToml([
      'default_profile = "default"',
      "",
      "[profiles.default]",
      'service = "uat-api.clickzetta.com"',
      'protocol = "https"',
      "",
    ].join("\n"))

    const { readAgentEndpoint } = await import(`../src/connection/profile-store.ts?${Date.now()}`)
    expect(readAgentEndpoint()).toBe("https://uat-api.clickzetta.com/clickzetta-campaign-data")
  })

  test("infers endpoint from full service URL without duplicating protocol", async () => {
    writeProfilesToml([
      'default_profile = "default"',
      "",
      "[profiles.default]",
      'service = "http://127.0.0.1:3000/api/"',
      'protocol = "https"',
      "",
    ].join("\n"))

    const { readAgentEndpoint } = await import(`../src/connection/profile-store.ts?${Date.now()}`)
    expect(readAgentEndpoint()).toBe("http://127.0.0.1:3000/api/clickzetta-campaign-data")
  })
})

// The provider menu's memory. Stored inside `[oauth.<id>]` so `auth logout <name>`
// drops it with the token instead of leaving a stale hint pointing at a session that
// no longer exists.
describe("last_provider", () => {
  test("round-trips through the token section", async () => {
    writeProfilesToml(["[oauth.prod]", 'token = "t"', ""].join("\n"))

    const store = await import(`../src/connection/profile-store.ts?${Date.now()}`)
    store.saveLastProvider("prod", "DINGTALK")
    expect(store.readLastProvider("prod")).toBe("DINGTALK")
  })

  // Writing a section here would mint an orphan `[oauth.<id>]` holding a hint and no
  // token — the same class of drift that produced stray `[oauth.cz<random>]` rows.
  test("refuses to create a section that has no token", async () => {
    writeProfilesToml(['default_profile = "default"', "", "[profiles.default]", ""].join("\n"))

    const store = await import(`../src/connection/profile-store.ts?${Date.now()}`)
    store.saveLastProvider("absent", "FEISHU")
    expect(store.readLastProvider("absent")).toBeUndefined()
  })

  test("keeps sessions apart", async () => {
    writeProfilesToml(["[oauth.prod]", 'token = "t"', "", "[oauth.dev]", 'token = "t"', ""].join("\n"))

    const store = await import(`../src/connection/profile-store.ts?${Date.now()}`)
    store.saveLastProvider("prod", "DINGTALK")
    store.saveLastProvider("dev", "browser")
    expect(store.readLastProvider("prod")).toBe("DINGTALK")
    expect(store.readLastProvider("dev")).toBe("browser")
  })

  // A token write replaces the whole `[oauth.<id>]` subtable, so the hint only
  // survives because writeOAuthEntry carries it across. Pinned here because the
  // ordering that used to be required (save the hint after provisioning) could
  // never have covered the writer that actually erased it — the runtime refresh
  // below, which login does not control.
  test("a later token write keeps the hint", async () => {
    writeProfilesToml(["[oauth.prod]", 'token = "t"', ""].join("\n"))

    const store = await import(`../src/connection/profile-store.ts?${Date.now()}`)
    store.saveLastProvider("prod", "DINGTALK")
    store.saveSharedOAuthToken("prod", {
      token: "fresh",
      refreshToken: "r",
      expireTimeMs: 3600 * 1000,
      obtainedAt: Date.now(),
      userId: 0,
      instanceId: 0,
    })
    expect(store.readLastProvider("prod")).toBe("DINGTALK")
  })

  test("a runtime token refresh keeps the hint too", async () => {
    writeProfilesToml(
      [
        "[profiles.prod_0]",
        'oauth = "prod"',
        "",
        "[oauth.prod]",
        'access_token = "t"',
        "expire_time_ms = 3600000",
        "obtained_at = 1",
        "instance_id = 1",
        "user_id = 1",
        "",
      ].join("\n"),
    )

    const store = await import(`../src/connection/profile-store.ts?${Date.now()}`)
    store.saveLastProvider("prod", "FEISHU")
    store.makeProfileTokenStore("prod_0").save({
      token: "refreshed",
      refreshToken: "r",
      expireTimeMs: 3600 * 1000,
      obtainedAt: Date.now(),
      userId: 1,
      instanceId: 1,
    })
    expect(store.readLastProvider("prod")).toBe("FEISHU")
  })

  test("a token section with no hint reads as no memory", async () => {
    writeProfilesToml(["[oauth.prod]", 'token = "t"', ""].join("\n"))

    const store = await import(`../src/connection/profile-store.ts?${Date.now()}`)
    expect(store.readLastProvider("prod")).toBeUndefined()
  })
})
