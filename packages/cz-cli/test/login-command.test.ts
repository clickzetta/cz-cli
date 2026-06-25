import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { AuthToken, ConnectionConfig } from "@clickzetta/sdk"
import { runLogin } from "../src/commands/login"
import type { BrowserLoginResult } from "../src/commands/login-browser"
import { makeProfileTokenStore, saveProfiles } from "../src/connection/profile-store"
import { GlobalArgs } from "../src/cli"

const PAT = "pat-secret-123"
const PROFILE = "czcli"

// Token returned by the fake browser login, already backfilled (as the real
// loginWithBrowser would after userinfo) with the userinfo instance identity.
const KNOWN_TOKEN: AuthToken = {
  token: "access-secret-xyz",
  refreshToken: "refresh-secret-xyz",
  expireTimeMs: 3600 * 1000,
  obtainedAt: Date.now(),
  instanceId: 159973,
  userId: 110000011361,
}

const KNOWN_RESULT: BrowserLoginResult = {
  token: KNOWN_TOKEN,
  userInfo: {
    instanceName: "89b94150",
    workspace: "quick_start",
    schema: "public",
    vcluster: "DEFAULT_AP",
    accountName: "wynptmks",
    accountId: 112407,
    userId: 110000011361,
    instanceId: 159973,
  },
  raw: {
    userId: 110000011361,
    accountName: "wynptmks",
    gatewayMapping: '{"1-1":"https://dev-api.clickzetta.com","1-2":"https://dev-api.clickzetta.com"}',
    instanceList: [{ cspId: 1, regionId: 1, serviceId: 1, id: 159973, name: "89b94150" }],
    instanceName: "89b94150",
    workspaceName: "quick_start",
    schema: "public",
    virtualCluster: "DEFAULT_AP",
    aimeshEndpointBaseUrl: "https://dev-aimesh.clickzetta.com/",
    apiKey: "secret-api-key",
    sub: "110000011361",
    preferred_username: "weiliu",
    name: "weiliu",
    account_id: 112407,
  },
}

const ORIGINAL_CALLBACK = process.env.CZ_OAUTH_LOCAL_CALLBACK
const previousTestHome = process.env.CLICKZETTA_TEST_HOME
let home: string

// Capture stdout so we can assert the success payload never echoes secrets.
function captureStdout(): { restore: () => void; text: () => string } {
  const original = process.stdout.write.bind(process.stdout)
  let buffer = ""
  process.stdout.write = ((chunk: unknown) => {
    buffer += String(chunk)
    return true
  }) as typeof process.stdout.write
  return { restore: () => (process.stdout.write = original), text: () => buffer }
}

function makeArgs(overrides: Partial<GlobalArgs> & { browser?: boolean } = {}) {
  return { format: "json", debug: false, profile: PROFILE, ...overrides } as GlobalArgs & { browser?: boolean }
}

// Config resolved from the seeded profile: pat + instance + service. finalInstance
// will become the userinfo instanceName so the cacheKey is `89b94150:<pat>`.
function makeConfig(): ConnectionConfig {
  return {
    service: "https://api.example.com",
    protocol: "https",
    instance: "old-instance",
    pat: PAT,
  } as ConnectionConfig
}

function profilesPath() {
  return join(home, ".clickzetta", "profiles.toml")
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "cz-login-cmd-"))
  process.env.CLICKZETTA_TEST_HOME = home
  delete process.env.CZ_OAUTH_LOCAL_CALLBACK
  process.exitCode = 0
})

afterEach(() => {
  if (previousTestHome === undefined) delete process.env.CLICKZETTA_TEST_HOME
  else process.env.CLICKZETTA_TEST_HOME = previousTestHome
  if (ORIGINAL_CALLBACK === undefined) delete process.env.CZ_OAUTH_LOCAL_CALLBACK
  else process.env.CZ_OAUTH_LOCAL_CALLBACK = ORIGINAL_CALLBACK
  process.exitCode = 0
  rmSync(home, { recursive: true, force: true })
})

describe("runLogin", () => {
  // Requirement 11.3/11.6/11.7: --browser drives the browser flow, persists the
  // token under the FINAL cacheKey, and writes the logged-in connection context
  // into the profile — without echoing secrets.
  test("--browser: persists token + connection context to the real profile", async () => {
    saveProfiles({ [PROFILE]: { pat: PAT, instance: "old-instance", service: "https://api.example.com" } })

    let browserCalls = 0
    const out = captureStdout()
    try {
      await runLogin(makeArgs({ browser: true }), {
        loginWithBrowser: async () => {
          browserCalls++
          return KNOWN_RESULT
        },
        resolveConnectionConfig: () => makeConfig(),
        accountsBaseUrl: () => "https://accounts.example.com",
      })
    } finally {
      out.restore()
    }

    expect(browserCalls).toBe(1)

    const text = readFileSync(profilesPath(), "utf-8")
    // Connection context backfilled from userinfo.
    expect(text).toContain('instance = "89b94150"')
    expect(text).toContain('workspace = "quick_start"')
    expect(text).toContain('vcluster = "DEFAULT_AP"')
    // Requirement 11.9: account identity mapped + full userinfo archived.
    expect(text).toContain("account_id = 112407")
    expect(text).toContain('account_name = "wynptmks"')
    expect(text).toContain("[profiles.czcli.userinfo]")
    expect(text).toContain('aimeshEndpointBaseUrl = "https://dev-aimesh.clickzetta.com/"')

    // Token persisted under the instance-only slot `89b94150` and loadable.
    const loaded = makeProfileTokenStore(PROFILE, "89b94150").load()
    expect(loaded).toEqual(KNOWN_TOKEN)

    // Requirement 11.3: success output MUST NOT include token/refresh values.
    expect(out.text()).not.toContain("access-secret-xyz")
    expect(out.text()).not.toContain("refresh-secret-xyz")
    expect(out.text()).toContain("logged_in")
    expect(process.exitCode).toBe(0)
  })

  // Requirement 11.5: without --browser and with the switch unset, no browser
  // flow runs and nothing is persisted — only guidance + non-zero exit.
  test("gating: no --browser and switch unset does not run browser login", async () => {
    saveProfiles({ [PROFILE]: { pat: PAT, instance: "old-instance", service: "https://api.example.com" } })

    let browserCalls = 0
    const out = captureStdout()
    try {
      await runLogin(makeArgs(), {
        loginWithBrowser: async () => {
          browserCalls++
          return KNOWN_RESULT
        },
        resolveConnectionConfig: () => makeConfig(),
        accountsBaseUrl: () => "https://accounts.example.com",
      })
    } finally {
      out.restore()
    }

    expect(browserCalls).toBe(0)
    // No token persisted under the instance-only slot.
    expect(makeProfileTokenStore(PROFILE, "89b94150").load()).toBeUndefined()
    // Profile instance unchanged.
    expect(readFileSync(profilesPath(), "utf-8")).toContain('instance = "old-instance"')
    expect(process.exitCode).toBe(2)
  })

  // Requirement 11.4: a failed login persists nothing and surfaces an error.
  test("failure: does not persist token when browser login throws", async () => {
    saveProfiles({ [PROFILE]: { pat: PAT, instance: "old-instance", service: "https://api.example.com" } })

    const out = captureStdout()
    try {
      await runLogin(makeArgs({ browser: true }), {
        loginWithBrowser: async () => {
          throw new Error("state mismatch")
        },
        resolveConnectionConfig: () => makeConfig(),
        accountsBaseUrl: () => "https://accounts.example.com",
      })
    } finally {
      out.restore()
    }

    expect(makeProfileTokenStore(PROFILE, "89b94150").load()).toBeUndefined()
    // Profile context unchanged on failure.
    expect(readFileSync(profilesPath(), "utf-8")).toContain('instance = "old-instance"')
    expect(out.text()).toContain("LOGIN_FAILED")
    expect(process.exitCode).not.toBe(0)
  })
})
