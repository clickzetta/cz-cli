import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { AuthToken } from "@clickzetta/sdk"
import { runLogin } from "../src/commands/login"
import type { LoginTarget } from "../src/connection/login-target"
import type { BrowserLoginResult } from "../src/commands/login-browser"
import { configureClickzettaLlm } from "../src/connection/provision"
import { makeProfileTokenStore, saveProfiles } from "../src/connection/profile-store"
import { readLlmEntries, setActiveModel, writeLlmEntries } from "../src/llm/native-config"
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

// After login, provisioning stamps the OAuth issuer (the login entry host,
// api.example.com per makeTarget) onto the persisted token so refresh can
// target /oauth2/token there. That's what load() returns.
const PERSISTED_TOKEN: AuthToken = { ...KNOWN_TOKEN, issuer: "api.example.com" }

const KNOWN_RESULT: BrowserLoginResult = {
  token: KNOWN_TOKEN,
  userInfo: {
    instanceName: "89b94150",
    workspace: "quick_start",
    schema: "public",
    vcluster: "DEFAULT_AP",
    accountName: "wynptmks",
    accountId: 112407,
    tenantId: 112407,
    userId: 110000011361,
    instanceId: 159973,
    apiKey: "secret-api-key",
    aimeshEndpointBaseUrl: "https://dev-aimesh.clickzetta.com/",
    // Region service the real parseUserInfo derives from gatewayMapping["1-1"].
    service: "dev-api.clickzetta.com",
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

// login writes the profile named by --name (not the global --profile, which
// only selects which profile to READ). So the target profile is set via `name`.
function makeArgs(overrides: Partial<GlobalArgs> & { browser?: boolean; name?: string } = {}) {
  return { format: "json", debug: false, name: PROFILE, ...overrides } as GlobalArgs & { browser?: boolean }
}

// Login target the resolver would produce — deliberately profile-free. The
// central host is only where OAuth runs; the persisted service comes from
// userinfo (gatewayMapping), not from here.
function makeTarget(): LoginTarget {
  return { entryHost: "api.example.com", protocol: "https" }
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
        resolveLoginTarget: async () => makeTarget(),
      })
    } finally {
      out.restore()
    }

    expect(browserCalls).toBe(1)

    const text = readFileSync(profilesPath(), "utf-8")
    // Connection context flattened onto the top-level profile entry.
    expect(text).toContain('instance = "89b94150"')
    expect(text).toContain('workspace = "quick_start"')
    expect(text).toContain('vcluster = "DEFAULT_AP"')
    expect(text).toContain("account_id = 112407")
    expect(text).toContain('account_name = "wynptmks"')
    // aimeshEndpointBaseUrl flattens to the top-level profile field of the same
    // name (also what the credential path writes), NOT a separate userinfo subtable.
    expect(text).toContain('aimeshEndpointBaseUrl = "https://dev-aimesh.clickzetta.com/"')
    expect(text).not.toContain("[profiles.czcli.userinfo]")

    // Token persisted in the shared [oauth.<id>] section; loadable via the
    // profile's oauth pointer (no explicit id).
    const loaded = makeProfileTokenStore(PROFILE).load()
    expect(loaded).toEqual(PERSISTED_TOKEN)

    // LLM provisioned from userinfo apiKey/aimeshEndpointBaseUrl under the profile name.
    const llm = readLlmEntries()
    expect(llm.llm[PROFILE]).toEqual({
      provider: "clickzetta",
      api_key: "secret-api-key",
      base_url: "https://dev-aimesh.clickzetta.com/",
    })

    // Requirement 11.3: success output MUST NOT include token/refresh values.
    expect(out.text()).not.toContain("access-secret-xyz")
    expect(out.text()).not.toContain("refresh-secret-xyz")
    expect(out.text()).toContain("logged_in")
    expect(process.exitCode).toBe(0)
  })

  // Browser OAuth is now the DEFAULT entry point: running `login` with no
  // credential flag drives the browser flow and provisions the profile, even
  // without --browser (the old LOGIN_MODE_REQUIRED gate is gone).
  test("default (no flags): runs browser login and provisions the profile", async () => {
    saveProfiles({ [PROFILE]: { pat: PAT, instance: "old-instance", service: "https://api.example.com" } })

    let browserCalls = 0
    const out = captureStdout()
    try {
      await runLogin(makeArgs(), {
        loginWithBrowser: async () => {
          browserCalls++
          return KNOWN_RESULT
        },
        resolveLoginTarget: async () => makeTarget(),
      })
    } finally {
      out.restore()
    }

    expect(browserCalls).toBe(1)
    // Token persisted in the shared section; loadable via the profile pointer.
    expect(makeProfileTokenStore(PROFILE).load()).toEqual(PERSISTED_TOKEN)
    expect(readFileSync(profilesPath(), "utf-8")).toContain('instance = "89b94150"')
    expect(out.text()).toContain("logged_in")
    expect(process.exitCode).toBe(0)
  })

  // Multi-profile: enumeration yields several (instance × workspace) combos →
  // one profile per combo (_0/_1…), all sharing ONE [oauth.<id>] token section.
  test("enumeration: writes one profile per combo sharing a single oauth token", async () => {
    configureClickzettaLlm(`${PROFILE}_0`, {
      apiKey: "legacy-api-key",
      baseURL: "https://legacy-aimesh.clickzetta.com/",
    })
    setActiveModel(`${PROFILE}_0/qwen/qwen3-coder-plus`)
    const resultWithInstances: BrowserLoginResult = {
      ...KNOWN_RESULT,
      instances: [
        { instanceId: 159973, instanceName: "89b94150", service: "cn-shanghai-alicloud.api.clickzetta.com" },
        { instanceId: 271876, instanceName: "453c81e6", service: "cn-shanghai-alicloud.api.clickzetta.com" },
      ],
    }
    const out = captureStdout()
    try {
      await runLogin(makeArgs(), {
        loginWithBrowser: async () => resultWithInstances,
        resolveLoginTarget: async () => makeTarget(),
        // Fake enumerator: 2 instances × workspaces → 3 combos.
        enumerateOAuthCombos: async () => [
          { service: "cn-shanghai-alicloud.api.clickzetta.com", instance: "89b94150", instanceId: 159973, workspace: "quick_start" },
          { service: "cn-shanghai-alicloud.api.clickzetta.com", instance: "89b94150", instanceId: 159973, workspace: "analytics" },
          { service: "cn-shanghai-alicloud.api.clickzetta.com", instance: "453c81e6", instanceId: 271876, workspace: "quick_start" },
        ],
      })
    } finally {
      out.restore()
    }

    const text = readFileSync(profilesPath(), "utf-8")
    // Three profiles named with _0/_1/_2 suffixes.
    expect(text).toContain(`[profiles.${PROFILE}_0]`)
    expect(text).toContain(`[profiles.${PROFILE}_1]`)
    expect(text).toContain(`[profiles.${PROFILE}_2]`)
    // Each combo's workspace landed on its profile.
    expect(text).toContain('workspace = "analytics"')
    // A single shared section named after the session, and every profile points at it.
    expect(text).toContain(`[oauth.${PROFILE}]`)
    const oauthSections = text.match(/\[oauth\.[^\]]+\]/g) ?? []
    expect(oauthSections.length).toBe(1)
    const pointers = text.match(/^oauth = "[^"]+"$/gm) ?? []
    expect(pointers.length).toBe(3)
    expect(new Set(pointers)).toEqual(new Set([`oauth = "${PROFILE}"`])) // all point at [oauth.czcli]

    // Default profile is the first combo; token loadable via its pointer.
    expect(makeProfileTokenStore(`${PROFILE}_0`).load()).toEqual(PERSISTED_TOKEN)
    // Sibling profile shares the same token.
    expect(makeProfileTokenStore(`${PROFILE}_2`).load()).toEqual(PERSISTED_TOKEN)

    // The LLM belongs to the shared OAuth login, not the arbitrary first profile.
    const llm = readLlmEntries()
    expect(llm.llm[PROFILE]).toEqual({
      provider: "clickzetta",
      api_key: "secret-api-key",
      base_url: "https://dev-aimesh.clickzetta.com/",
    })
    expect(llm.llm[`${PROFILE}_0`]).toBeUndefined()
    expect(llm.model).toBe(`${PROFILE}/qwen/qwen3-coder-plus`)

    expect(out.text()).toContain("logged_in")
    expect(out.text()).toContain(`${PROFILE}_0`)
    expect(process.exitCode).toBe(0)
  })

  // Session name is required: no --name and the prompt yields nothing
  // (non-interactive / cancelled) → SESSION_NAME_REQUIRED, browser never runs.
  test("requires a session name → SESSION_NAME_REQUIRED when none provided or prompted", async () => {
    let browserCalls = 0
    const out = captureStdout()
    try {
      await runLogin({ format: "json", debug: false } as GlobalArgs & { browser?: boolean }, {
        loginWithBrowser: async () => {
          browserCalls++
          return KNOWN_RESULT
        },
        resolveLoginTarget: async () => makeTarget(),
        promptSessionName: async () => undefined, // non-TTY / cancelled
      })
    } finally {
      out.restore()
    }
    expect(browserCalls).toBe(0)
    expect(out.text()).toContain("SESSION_NAME_REQUIRED")
    expect(process.exitCode).not.toBe(0)
  })

  // TTY: no --name → prompt supplies the session name, and login proceeds using it.
  test("prompts for the session name interactively when omitted", async () => {
    const out = captureStdout()
    try {
      await runLogin({ format: "json", debug: false } as GlobalArgs & { browser?: boolean }, {
        loginWithBrowser: async () => KNOWN_RESULT,
        resolveLoginTarget: async () => makeTarget(),
        promptSessionName: async () => "prompted-sess",
      })
    } finally {
      out.restore()
    }
    // The prompted name became the oauth session id (single-profile fallback,
    // since KNOWN_RESULT has no instances to enumerate).
    const text = readFileSync(profilesPath(), "utf-8")
    expect(text).toContain("[oauth.prompted-sess]")
    expect(text).toContain('oauth = "prompted-sess"')
    expect(out.text()).toContain("logged_in")
    expect(process.exitCode).toBe(0)
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
        resolveLoginTarget: async () => makeTarget(),
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

  // Adaptive dispatch: --credential provisions a profile via the shared
  // credential path and never touches the browser flow.
  test("--credential: provisions from credential without browser login", async () => {
    const cred = Buffer.from(
      JSON.stringify({
        instanceName: "credinst",
        workspaceName: "credws",
        accessToken: "czt_cred",
        apiKey: "ck_cred",
        aimeshEndpointBaseUrl: "https://gw.example.com/",
      }),
      "utf-8",
    ).toString("base64")

    let browserCalls = 0
    const out = captureStdout()
    try {
      await runLogin(makeArgs({ credential: cred, name: "credprofile" }), {
        loginWithBrowser: async () => {
          browserCalls++
          return KNOWN_RESULT
        },
      })
    } finally {
      out.restore()
    }

    expect(browserCalls).toBe(0)
    const text = readFileSync(profilesPath(), "utf-8")
    expect(text).toContain('instance = "credinst"')
    expect(text).toContain("[profiles.credprofile]")
    expect(out.text()).toContain("logged_in")
    expect(process.exitCode).toBe(0)
  })

  // A second login under the SAME session name is a re-login: the only thing it
  // owns is the token. The signal is [oauth.<name>] already existing — see
  // oauthSectionExists — and llm.json in particular must survive untouched,
  // because its api_key may be the gateway virtual key the quota flow swapped in.
  test("re-login: refreshes the token, reports relogin, and does not rewrite llm.json", async () => {
    const first = captureStdout()
    try {
      await runLogin(makeArgs(), {
        loginWithBrowser: async () => KNOWN_RESULT,
        resolveLoginTarget: async () => makeTarget(),
      })
    } finally {
      first.restore()
    }
    expect(first.text()).toContain('"relogin":false')
    expect(first.text()).toContain('"llm_configured":true')

    // Stand in for llm/key-provision.ts swapping in a virtual key after the
    // complimentary quota ran out.
    const llm = readLlmEntries()
    llm.llm[PROFILE] = { ...llm.llm[PROFILE]!, api_key: "virtual-key-after-quota" }
    writeLlmEntries({ llm: llm.llm })

    const second = captureStdout()
    try {
      await runLogin(makeArgs(), {
        loginWithBrowser: async () => ({ ...KNOWN_RESULT, token: { ...KNOWN_RESULT.token, token: "access-secret-2" } }),
        resolveLoginTarget: async () => makeTarget(),
      })
    } finally {
      second.restore()
    }

    expect(second.text()).toContain('"relogin":true')
    // The key stays present so a parser never has to interpret its absence; the
    // value says the write was deliberately not attempted rather than failed.
    expect(second.text()).toContain('"llm_configured":"not_attempted"')
    expect(makeProfileTokenStore(PROFILE).load()?.token).toBe("access-secret-2")
    expect(readLlmEntries().llm[PROFILE]?.api_key).toBe("virtual-key-after-quota")
    expect(process.exitCode).toBe(0)
  })

  // --pat is not a login: no flow behind `login` consumes it (the setup flow only
  // accepts --credential or username+password+account-name), so it must be
  // rejected with a pointer to `profile create` instead of being handed to a flow
  // that would silently drop it and then demand a username.
  test("--pat: rejected with a pointer to `profile create`, no browser, no setup flow", async () => {
    let browserCalls = 0
    let authConfigureCalls = 0
    const out = captureStdout()
    try {
      await runLogin(makeArgs({ name: "myprof", pat: "czt_explicit" }), {
        loginWithBrowser: async () => {
          browserCalls++
          return KNOWN_RESULT
        },
        runAuthConfigure: async () => {
          authConfigureCalls++
        },
      })
    } finally {
      out.restore()
    }

    expect(browserCalls).toBe(0)
    expect(authConfigureCalls).toBe(0)
    expect(out.text()).toContain("PAT_NOT_A_LOGIN")
    expect(out.text()).toContain("profile create myprof --pat")
    // Never echo the secret back.
    expect(out.text()).not.toContain("czt_explicit")
    expect(process.exitCode).toBe(2)
  })

  // Zero llm.json writes on a re-login is deliberate, but a session that never got
  // an entry (its first login carried no apiKey) would otherwise stay entry-less
  // with nothing in the output saying so — `llm_configured` is omitted on re-login.
  test("re-login warns when this session has no llm entry, without writing one", async () => {
    const first = captureStdout()
    try {
      await runLogin(makeArgs(), {
        // userInfo without an apiKey: nothing to configure on the first login.
        loginWithBrowser: async () => ({ ...KNOWN_RESULT, userInfo: { ...KNOWN_RESULT.userInfo!, apiKey: undefined } }),
        resolveLoginTarget: async () => makeTarget(),
      })
    } finally {
      first.restore()
    }
    expect(readLlmEntries().llm[PROFILE]).toBeUndefined()

    const second = captureStdout()
    try {
      await runLogin(makeArgs(), {
        loginWithBrowser: async () => ({ ...KNOWN_RESULT, userInfo: { ...KNOWN_RESULT.userInfo!, apiKey: undefined } }),
        resolveLoginTarget: async () => makeTarget(),
      })
    } finally {
      second.restore()
    }

    expect(second.text()).toContain("No LLM entry named")
    expect(second.text()).toContain("agent llm add")
    // Still no write — the warning replaces the write, it does not precede one.
    expect(readLlmEntries().llm[PROFILE]).toBeUndefined()
  })

  // A wrapper that forwards --pat alongside the credentials it actually uses had a
  // working invocation; the redirect must not turn that into a hard failure. The PAT
  // is still ignored by the flow, so say so on stderr rather than silently.
  test("--pat alongside --username/--password: proceeds, warns on stderr", async () => {
    let authConfigureCalls = 0
    const errs: string[] = []
    const originalWrite = process.stderr.write.bind(process.stderr)
    // @ts-expect-error - narrow stub for the single call shape used here
    process.stderr.write = (chunk: string) => {
      errs.push(String(chunk))
      return true
    }
    try {
      await runLogin(makeArgs({ pat: "czt_x", username: "u", password: "p" }), {
        loginWithBrowser: async () => KNOWN_RESULT,
        runAuthConfigure: async () => {
          authConfigureCalls++
        },
      })
    } finally {
      process.stderr.write = originalWrite
    }

    expect(authConfigureCalls).toBe(1)
    expect(errs.join("")).toContain("--pat is ignored")
    expect(process.exitCode).toBe(0)
  })

  // The suggestion is copy-pasted and read by agents, so a name with shell
  // metacharacters must not be interpolated into it verbatim.
  test("--pat: a session name that is not shell-safe falls back to <name> in the hint", async () => {
    const out = captureStdout()
    try {
      await runLogin(makeArgs({ name: "my prod; rm -rf x", pat: "czt_x" }), {
        loginWithBrowser: async () => KNOWN_RESULT,
      })
    } finally {
      out.restore()
    }

    expect(out.text()).toContain("profile create <name> --pat")
    expect(out.text()).not.toContain("rm -rf")
  })

  // The non-OAuth setup flow keys the profile by --name; `login` must default it
  // like the deprecated `setup` alias does, or the flow writes a profile literally
  // named "undefined" and makes it default_profile.
  test("--username/--password without a name: profile name defaults to 'default'", async () => {
    let seen: unknown
    await runLogin({ ...makeArgs({ username: "u", password: "p" }), name: undefined }, {
      loginWithBrowser: async () => KNOWN_RESULT,
      runAuthConfigure: async (argv) => {
        seen = argv
      },
    })

    expect((seen as { name?: string }).name).toBe("default")
  })
})
