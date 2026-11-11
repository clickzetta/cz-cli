import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { AuthToken } from "@clickzetta/sdk"
import { preselectedProvider, runLogin } from "../src/commands/login"
import { DEVICE_PROVIDERS } from "../src/commands/login-device"
import type { LoginTarget } from "../src/connection/login-target"
import { configureClickzettaLlm, provisionProfileFromOAuth } from "../src/connection/provision"
import type { OAuthLoginResult } from "../src/commands/oauth-userinfo"
import { runAuthConfigure } from "../src/commands/setup"
import { loadProfiles, makeProfileTokenStore, readLastProvider, saveProfiles } from "../src/connection/profile-store"
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
//
// Without instanceId, though KNOWN_TOKEN has one: a browser login does learn an instance
// id, but `[oauth.<id>]` is SHARED by every profile the login provisions — one section
// cannot hold a per-profile fact — so it is not persisted there. It goes on each profile
// instead (see the instance_id assertions below).
const { instanceId: _loginInstanceId, ...KNOWN_TOKEN_WITHOUT_INSTANCE } = KNOWN_TOKEN
const PERSISTED_TOKEN: AuthToken = { ...KNOWN_TOKEN_WITHOUT_INSTANCE, issuer: "api.example.com" }

const KNOWN_RESULT: OAuthLoginResult = {
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

// Device login refuses on a non-TTY, and the provider menu only appears on one, so
// both suites need to claim or disclaim a terminal.
async function withTty<T>(isTty: boolean, fn: () => Promise<T>): Promise<T> {
  const original = process.stdin.isTTY
  Object.defineProperty(process.stdin, "isTTY", { value: isTty, configurable: true })
  try {
    return await fn()
  } finally {
    Object.defineProperty(process.stdin, "isTTY", { value: original, configurable: true })
  }
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
    const resultWithInstances: OAuthLoginResult = {
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
    // One profile per combo, each named `<session>_<workspace>_<instance>` — readable on its
    // own, where the old `_0/_1/_2` meant opening this file to find out which was which.
    expect(text).toContain(`[profiles.${PROFILE}_quick_start_89b94150]`)
    expect(text).toContain(`[profiles.${PROFILE}_analytics_89b94150]`)
    expect(text).toContain(`[profiles.${PROFILE}_quick_start_453c81e6]`)
    // Each combo's workspace landed on its profile.
    expect(text).toContain('workspace = "analytics"')
    // Each profile carries its OWN instance_id, from the combo — the whole point of moving
    // it off the shared token. Two of these combos are one instance, the third another.
    expect(text.match(/^instance_id = 159973$/gm)?.length).toBe(2)
    expect(text.match(/^instance_id = 271876$/gm)?.length).toBe(1)
    // A single shared section named after the session, and every profile points at it.
    expect(text).toContain(`[oauth.${PROFILE}]`)
    const oauthSections = text.match(/\[oauth\.[^\]]+\]/g) ?? []
    expect(oauthSections.length).toBe(1)
    const pointers = text.match(/^oauth = "[^"]+"$/gm) ?? []
    expect(pointers.length).toBe(3)
    expect(new Set(pointers)).toEqual(new Set([`oauth = "${PROFILE}"`])) // all point at [oauth.czcli]

    // The default is the connection userinfo names (instance 89b94150 / quick_start), NOT
    // whichever name sorts first — `analytics` would win alphabetically. Report order is
    // alphabetical so two logins can be diffed; it has no opinion on which connection the
    // user wants, and userinfo does.
    expect(readFileSync(profilesPath(), "utf-8")).toContain(
      `default_profile = "${PROFILE}_quick_start_89b94150"`,
    )
    // Token loadable via its pointer.
    expect(makeProfileTokenStore(`${PROFILE}_quick_start_89b94150`).load()).toEqual(PERSISTED_TOKEN)
    // Sibling profile shares the same token.
    expect(makeProfileTokenStore(`${PROFILE}_quick_start_453c81e6`).load()).toEqual(PERSISTED_TOKEN)

    // The LLM belongs to the shared OAuth login, not the arbitrary first profile.
    const llm = readLlmEntries()
    expect(llm.llm[PROFILE]).toEqual({
      provider: "clickzetta",
      api_key: "secret-api-key",
      base_url: "https://dev-aimesh.clickzetta.com/",
    })
    // `czcli_0` here is an llm.json KEY, not a profile name: it is what the entry was called
    // back when it was keyed by the session's first profile. Profile naming changed; this
    // migration anchor deliberately did not, so the absorb-and-delete still has to fire.
    expect(llm.llm[`${PROFILE}_0`]).toBeUndefined()
    expect(llm.model).toBe(`${PROFILE}/qwen/qwen3-coder-plus`)

    expect(out.text()).toContain("logged_in")
    expect(out.text()).toContain(`${PROFILE}_quick_start_89b94150`)
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
    // default_profile keeps its old meaning (what profiles.toml says); the
    // session-scoped answer has its own key.
    expect(first.text()).toContain('"default_profile":"czcli"')
    expect(first.text()).toContain('"session_default_profile":"czcli"')
    expect(first.text()).toContain('"llm_configured":true')
    expect(first.text()).toContain('"llm_configuration":"written"')

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
    // Stays boolean AND falsy: a consumer doing `if (payload.llm_configured)` must
    // not be told the LLM is ready by a run that never wrote it. The nuance lives in
    // its own key.
    expect(second.text()).toContain('"llm_configured":false')
    expect(second.text()).toContain('"llm_configuration":"skipped_relogin"')
    expect(makeProfileTokenStore(PROFILE).load()?.token).toBe("access-secret-2")
    expect(readLlmEntries().llm[PROFILE]?.api_key).toBe("virtual-key-after-quota")
    expect(process.exitCode).toBe(0)
  })

  test("a peer completing login while the browser is open makes this a re-login", async () => {
    const out = captureStdout()
    try {
      await runLogin(makeArgs(), {
        resolveLoginTarget: async () => makeTarget(),
        loginWithBrowser: async () => {
          provisionProfileFromOAuth(PROFILE, {
            token: KNOWN_TOKEN,
            userInfo: KNOWN_RESULT.userInfo,
            service: "dev-api.clickzetta.com",
            protocol: "https",
          })
          configureClickzettaLlm(PROFILE, { apiKey: "peer-virtual-key" })
          return { ...KNOWN_RESULT, token: { ...KNOWN_TOKEN, token: "second-access", refreshToken: "second-refresh" } }
        },
      })
    } finally {
      out.restore()
    }
    expect(out.text()).toContain('"relogin":true')
    expect(readLlmEntries().llm[PROFILE]?.api_key).toBe("peer-virtual-key")
    expect(makeProfileTokenStore(PROFILE).load()?.token).toBe("second-access")
    expect(process.exitCode).toBe(0)
  })

  // --pat is not a login: no flow behind `login` consumes it (the setup flow only
  // accepts --credential or username+password+account-name), so it must be
  // rejected with a pointer to `profile create` instead of being handed to a flow
  // that would silently drop it and then demand a username.
  // The region prompt on a re-login was the bug: the session name the user typed already
  // names the issuer it was minted against, so asking again asks a question we hold the
  // answer to. These tests assert on the ARGS login.ts passes the resolver, not on the host
  // it comes back with — every other test here stubs resolveLoginTarget with a zero-arg
  // fake, which cannot tell a wired-up recordedIssuer from a dropped one.
  test("re-login hands the resolver the issuer this session recorded, so it never prompts", async () => {
    const seen: Array<{ oauthUrl?: string; partition?: string; recordedIssuer?: string }> = []
    const spyResolve = async (args: { oauthUrl?: string; partition?: string; recordedIssuer?: string }) => {
      seen.push(args)
      return makeTarget()
    }

    const first = captureStdout()
    try {
      await runLogin(makeArgs(), { loginWithBrowser: async () => KNOWN_RESULT, resolveLoginTarget: spyResolve })
    } finally {
      first.restore()
    }
    expect(first.text()).toContain('"relogin":false')
    // Nothing on disk yet, so there is nothing to reuse and the prompt tier is correct.
    expect(seen[0]?.recordedIssuer).toBeUndefined()
    // The first login is what puts the issuer on record (provisioning stamps it onto the
    // shared token) — if it stopped doing that, the re-login below would silently go back
    // to prompting.
    expect(readFileSync(profilesPath(), "utf-8")).toContain('issuer = "api.example.com"')

    const second = captureStdout()
    try {
      await runLogin(makeArgs(), { loginWithBrowser: async () => KNOWN_RESULT, resolveLoginTarget: spyResolve })
    } finally {
      second.restore()
    }
    expect(second.text()).toContain('"relogin":true')
    expect(seen).toHaveLength(2)
    expect(seen[1]?.recordedIssuer).toBe("api.example.com")
    expect(process.exitCode).toBe(0)
  })

  // `logout --keep-profiles` drops the token section and keeps the rows, so this login is
  // classified a re-login (profiles still point at the session) with no issuer on record.
  // Passing something made up would be worse than asking: fall through to the prompt.
  test("re-login after `logout --keep-profiles` has no recorded issuer to reuse", async () => {
    let lastArgs: { recordedIssuer?: string } | undefined
    const spyResolve = async (args: { oauthUrl?: string; partition?: string; recordedIssuer?: string }) => {
      lastArgs = args
      return makeTarget()
    }

    const out1 = captureStdout()
    try {
      await runLogin(makeArgs(), { loginWithBrowser: async () => KNOWN_RESULT, resolveLoginTarget: spyResolve })
    } finally {
      out1.restore()
    }

    const raw = readFileSync(profilesPath(), "utf-8").replace(/\[oauth\.czcli\][\s\S]*?(?=\n\[|$)/, "")
    writeFileSync(profilesPath(), raw)
    expect(readFileSync(profilesPath(), "utf-8")).toContain('oauth = "czcli"')

    const out2 = captureStdout()
    try {
      await runLogin(makeArgs(), { loginWithBrowser: async () => KNOWN_RESULT, resolveLoginTarget: spyResolve })
    } finally {
      out2.restore()
    }
    expect(out2.text()).toContain('"relogin":true')
    expect(lastArgs?.recordedIssuer).toBeUndefined()
  })

  // One session name, two environments. The flag wins, but the fallout is not local to the
  // token: [oauth.<id>] is a single section, so every row under this session now carries a
  // token minted somewhere other than where its `service` points.
  test("a login that moves a session to another issuer warns instead of switching silently", async () => {
    const out1 = captureStdout()
    try {
      await runLogin(makeArgs(), {
        loginWithBrowser: async () => KNOWN_RESULT,
        resolveLoginTarget: async () => makeTarget(),
      })
    } finally {
      out1.restore()
    }
    expect(out1.text()).not.toContain("was last signed in to")

    const out2 = captureStdout()
    try {
      await runLogin(makeArgs(), {
        loginWithBrowser: async () => KNOWN_RESULT,
        // What resolveLoginTarget returns when --partition/--oauth-url names a different
        // host than the record.
        resolveLoginTarget: async () => ({ ...makeTarget(), supersededIssuer: "uat-api.clickzetta.com" }),
      })
    } finally {
      out2.restore()
    }
    expect(out2.text()).toContain("was last signed in to")
    expect(out2.text()).toContain("uat-api.clickzetta.com")
    expect(process.exitCode).toBe(0)
  })

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

  // `auth logout <name> --keep-profiles` deletes [oauth.<name>] and keeps the rows.
  // If the next login read only the section it would call itself a FIRST login and
  // rewrite exactly what --keep-profiles asked to preserve.
  test("login after `logout --keep-profiles` is still a re-login", async () => {
    const out1 = captureStdout()
    try {
      await runLogin(makeArgs(), {
        loginWithBrowser: async () => KNOWN_RESULT,
        resolveLoginTarget: async () => makeTarget(),
      })
    } finally {
      out1.restore()
    }
    const llm = readLlmEntries()
    llm.llm[PROFILE] = { ...llm.llm[PROFILE]!, api_key: "virtual-key-after-quota" }
    writeLlmEntries({ llm: llm.llm })

    // What runLogout does with --keep-profiles: drop the token section, keep the
    // profiles (pointer and all).
    const raw = readFileSync(profilesPath(), "utf-8").replace(/\[oauth\.czcli\][\s\S]*?(?=\n\[|$)/, "")
    writeFileSync(profilesPath(), raw)
    expect(readFileSync(profilesPath(), "utf-8")).toContain('oauth = "czcli"')

    const out2 = captureStdout()
    try {
      await runLogin(makeArgs(), {
        loginWithBrowser: async () => KNOWN_RESULT,
        resolveLoginTarget: async () => makeTarget(),
      })
    } finally {
      out2.restore()
    }

    expect(out2.text()).toContain('"relogin":true')
    expect(readLlmEntries().llm[PROFILE]?.api_key).toBe("virtual-key-after-quota")
  })

  // Zero llm.json writes on a re-login is deliberate, but a session that never got
  // an entry (its first login carried no apiKey) would otherwise stay entry-less
  // with nothing in the output saying so — `llm_configured` is a bare `false` there.
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

  // A defaulted name must not silently replace an existing `default` profile: the
  // setup flow's non-TTY branch calls saveProfile unconditionally, and --credential
  // refuses the same collision.
  // The dispatcher only supplies the default name; the collision itself is the shared
  // flow's call (see the runAuthConfigure test below).
  test("--username/--password with no name delegates with name 'default'", async () => {
    saveProfiles({ default: { pat: "existing-pat", instance: "keep" } })
    let seen: unknown
    await runLogin({ ...makeArgs({ username: "u", password: "p", "account-name": "acct" } as never), name: undefined }, {
      loginWithBrowser: async () => KNOWN_RESULT,
      runAuthConfigure: async (argv) => {
        seen = argv
      },
    })

    expect((seen as { name?: string }).name).toBe("default")
    expect(loadProfiles().default).toEqual({ pat: "existing-pat", instance: "keep" })
  })

  // The collision check lives in the shared flow (runAuthConfigure), not in this
  // dispatcher, so both `login` and the `setup` alias fast-fail before the portal round
  // trip. Driven through the real flow rather than a stub, since the stub is what would
  // hide a check that moved.
  test("a complete credential set with no name refuses before any network call", async () => {
    saveProfiles({ default: { pat: "existing-pat", instance: "keep" } })

    const out = captureStdout()
    try {
      await runAuthConfigure({
        format: "json",
        debug: false,
        name: "default",
        username: "u",
        password: "p",
        "account-name": "acct",
      } as never)
    } finally {
      out.restore()
    }

    expect(out.text()).toContain("PROFILE_EXISTS")
    expect(loadProfiles().default).toEqual({ pat: "existing-pat", instance: "keep" })
  })

  // An incomplete credential set is mid-protocol: runExistingAccountFlowNonTTY answers
  // SETUP_INPUT_REQUIRED and the wrapper re-invokes with more flags. Pre-empting that with
  // PROFILE_EXISTS would stop it at step one, and neither protocol has a name step.
  test("an incomplete credential set still reaches the flow even when 'default' exists", async () => {
    saveProfiles({ default: { pat: "existing-pat" } })
    let authConfigureCalls = 0
    await runLogin({ ...makeArgs({ username: "u" }), name: undefined }, {
      loginWithBrowser: async () => KNOWN_RESULT,
      runAuthConfigure: async () => {
        authConfigureCalls++
      },
    })

    expect(authConfigureCalls).toBe(1)
  })

  // Three keys a working entry can sit under; the raw one is what the zero-combos
  // fallback wrote before this branch sanitized it. A name that sanitizes differently
  // is the only way to tell them apart.
  test("re-login does not warn when the llm entry sits under the raw session name", async () => {
    const raw = "my.prod"
    saveProfiles({ [raw]: { oauth: "my_prod", instance: "i1" } })
    writeLlmEntries({ llm: { [raw]: { provider: "clickzetta", api_key: "still-working" } } })

    const out = captureStdout()
    try {
      await runLogin(makeArgs({ name: raw }), {
        loginWithBrowser: async () => KNOWN_RESULT,
        resolveLoginTarget: async () => makeTarget(),
      })
    } finally {
      out.restore()
    }

    expect(out.text()).toContain('"relogin":true')
    expect(out.text()).not.toContain("No LLM entry named")
  })

  // A cookie-pinned row ignores the refreshed token, so the login must say it was a
  // no-op for that profile rather than reporting a plain success.
  test("re-login warns about profiles pinned to cookie auth", async () => {
    saveProfiles({ [PROFILE]: { oauth: PROFILE, instance: "89b94150", auth_type: "cookie", header: { Cookie: "stale" } } })

    const out = captureStdout()
    try {
      await runLogin(makeArgs(), {
        loginWithBrowser: async () => KNOWN_RESULT,
        resolveLoginTarget: async () => makeTarget(),
      })
    } finally {
      out.restore()
    }

    expect(out.text()).toContain('auth_type = \\"cookie\\"')
    expect(out.text()).toContain(PROFILE)
    expect(loadProfiles()[PROFILE]?.auth_type).toBe("cookie")
  })

  // A session name that needs sanitizing shares its token section with any name that
  // sanitizes the same way, so the user is told rather than silently sharing.
  test("a session name that needs sanitizing is called out", async () => {
    const out = captureStdout()
    try {
      await runLogin(makeArgs({ name: "my.prod" }), {
        loginWithBrowser: async () => KNOWN_RESULT,
        resolveLoginTarget: async () => makeTarget(),
      })
    } finally {
      out.restore()
    }

    expect(out.text()).toContain("my_prod")
    expect(out.text()).toContain("warnings")
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

// --provider selects the device (QR) flow. What it must NOT change is anything
// downstream: the same token store, the same profile, the same LLM entry as a
// browser login of the same account.
describe("runLogin --provider (device flow)", () => {
  function makeDeviceArgs(provider: string, overrides: Record<string, unknown> = {}) {
    return { format: "json", debug: false, name: PROFILE, provider, ...overrides } as GlobalArgs & {
      provider?: string
    }
  }


  test("dispatches to the device flow and provisions exactly like a browser login", async () => {
    let deviceCalls = 0
    let browserCalls = 0
    let sawProvider: string | undefined
    const out = captureStdout()
    try {
      await withTty(true, () =>
        runLogin(makeDeviceArgs("alipay"), {
          loginWithDevice: async ({ provider }) => {
            deviceCalls++
            sawProvider = provider
            return KNOWN_RESULT
          },
          loginWithBrowser: async () => {
            browserCalls++
            return KNOWN_RESULT
          },
          resolveLoginTarget: async () => makeTarget(),
        }),
      )
    } finally {
      out.restore()
    }

    expect(deviceCalls).toBe(1)
    expect(browserCalls).toBe(0)
    // Normalized to the gateway's case-sensitive wire spelling.
    expect(sawProvider).toBe("ALIPAY")

    // Same downstream artifacts as the browser test above.
    expect(makeProfileTokenStore(PROFILE).load()).toEqual(PERSISTED_TOKEN)
    const text = readFileSync(profilesPath(), "utf-8")
    expect(text).toContain('instance = "89b94150"')
    expect(text).toContain('workspace = "quick_start"')

    expect(out.text()).toContain('"login_method"')
    expect(out.text()).toContain("device")
    expect(out.text()).not.toContain("access-secret-xyz")
    expect(process.exitCode).toBe(0)
  })

  test("reports login_method browser when no provider is passed", async () => {
    const out = captureStdout()
    try {
      await runLogin(makeArgs(), {
        loginWithBrowser: async () => KNOWN_RESULT,
        resolveLoginTarget: async () => makeTarget(),
      })
    } finally {
      out.restore()
    }

    expect(out.text()).toContain("browser")
    expect(process.exitCode).toBe(0)
  })

  test("refuses on a non-TTY before any network call, persisting nothing", async () => {
    let deviceCalls = 0
    let targetCalls = 0
    const out = captureStdout()
    try {
      await withTty(false, () =>
        runLogin(makeDeviceArgs("alipay"), {
          loginWithDevice: async () => {
            deviceCalls++
            return KNOWN_RESULT
          },
          resolveLoginTarget: async () => {
            targetCalls++
            return makeTarget()
          },
        }),
      )
    } finally {
      out.restore()
    }

    expect(out.text()).toContain("DEVICE_LOGIN_REQUIRES_TTY")
    expect(deviceCalls).toBe(0)
    // The refusal lands before the region is even resolved (which can prompt).
    expect(targetCalls).toBe(0)
    expect(makeProfileTokenStore(PROFILE).load()).toBeUndefined()
    expect(process.exitCode).not.toBe(0)
  })

  test("rejects an unknown provider without starting a login", async () => {
    let deviceCalls = 0
    const out = captureStdout()
    try {
      await withTty(true, () =>
        runLogin(makeDeviceArgs("qq"), {
          loginWithDevice: async () => {
            deviceCalls++
            return KNOWN_RESULT
          },
          resolveLoginTarget: async () => makeTarget(),
        }),
      )
    } finally {
      out.restore()
    }

    expect(out.text()).toContain("DEVICE_PROVIDER_INVALID")
    expect(deviceCalls).toBe(0)
    expect(process.exitCode).not.toBe(0)
  })

  // `--provider password` is the same device flow with a different verification
  // page: the CLI still never sees a credential, and everything downstream — token
  // store, profile, login_method — is identical to the scan providers.
  test("password is a device provider like any other", async () => {
    let sawProvider: string | undefined
    let browserCalls = 0
    const out = captureStdout()
    try {
      await withTty(true, () =>
        runLogin(makeDeviceArgs("password"), {
          loginWithDevice: async ({ provider }) => {
            sawProvider = provider
            return KNOWN_RESULT
          },
          loginWithBrowser: async () => {
            browserCalls++
            return KNOWN_RESULT
          },
          resolveLoginTarget: async () => makeTarget(),
        }),
      )
    } finally {
      out.restore()
    }

    expect(sawProvider).toBe("PASSWORD")
    expect(browserCalls).toBe(0)
    expect(makeProfileTokenStore(PROFILE).load()).toEqual(PERSISTED_TOKEN)
    expect(out.text()).toContain("device")
    expect(process.exitCode).toBe(0)
  })

  // The dispatch is ordered, so --username used to win and --provider was dropped
  // with no mention of it — the user got SETUP_INPUT_REQUIRED asking for an
  // account name and no clue which flow they had actually invoked. `password`
  // being both a provider VALUE and a flag NAME makes this the likely mistake.
  test.each([
    ["--username", { username: "someone" }],
    ["--password", { password: "hunter2" }],
    ["--credential", { credential: "eyJ4IjoxfQ==" }],
    ["--login-method", { "login-method": "clickzetta" }],
  ])("refuses --provider together with %s", async (_flag, extra) => {
    let deviceCalls = 0
    let configureCalls = 0
    const out = captureStdout()
    try {
      await withTty(true, () =>
        runLogin(makeDeviceArgs("password", extra), {
          loginWithDevice: async () => {
            deviceCalls++
            return KNOWN_RESULT
          },
          runAuthConfigure: async () => {
            configureCalls++
          },
          resolveLoginTarget: async () => makeTarget(),
        }),
      )
    } finally {
      out.restore()
    }

    expect(out.text()).toContain("LOGIN_FLOW_CONFLICT")
    // Neither flow ran: the conflict is refused, not silently resolved either way.
    expect(deviceCalls).toBe(0)
    expect(configureCalls).toBe(0)
    expect(makeProfileTokenStore(PROFILE).load()).toBeUndefined()
    expect(process.exitCode).not.toBe(0)
  })

  test("surfaces an entry without device flow as its own code, not LOGIN_FAILED", async () => {
    const out = captureStdout()
    try {
      await withTty(true, () =>
        runLogin(makeDeviceArgs("alipay"), {
          loginWithDevice: async () => {
            throw new Error("DEVICE_FLOW_UNSUPPORTED: 'https://api.example.com' does not advertise a device_authorization_endpoint")
          },
          resolveLoginTarget: async () => makeTarget(),
        }),
      )
    } finally {
      out.restore()
    }

    expect(out.text()).toContain("DEVICE_FLOW_UNSUPPORTED")
    expect(out.text()).not.toContain("LOGIN_FAILED")
    expect(process.exitCode).not.toBe(0)
  })

  // A 5xx that outlasted the device code and a response shape we cannot parse are
  // opposite diagnoses, and they used to share one advice string that told the user
  // retrying would not help. For the transient one that is wrong: re-running is
  // exactly what fixes it.
  test("a transient gateway failure is not advised as a permanent one", async () => {
    const out = captureStdout()
    try {
      await withTty(true, () =>
        runLogin(makeDeviceArgs("alipay"), {
          loginWithDevice: async () => {
            throw new Error("DEVICE_STATUS_UNAVAILABLE: the device status request failed (HTTP 503) (request id: tssdk-oauth-test)")
          },
          resolveLoginTarget: async () => makeTarget(),
        }),
      )
    } finally {
      out.restore()
    }

    expect(out.text()).toContain("DEVICE_STATUS_UNAVAILABLE")
    expect(out.text()).not.toContain("retrying will not help")
    expect(process.exitCode).not.toBe(0)
  })

  // A body of `null` used to reach here as a TypeError, which matches no prefix in
  // the advice table and no `includes()` branch either, so every device failure with
  // an unreadable body came out as a generic LOGIN_FAILED with retry advice.
  test("an unreadable device response keeps its own code instead of LOGIN_FAILED", async () => {
    const out = captureStdout()
    try {
      await withTty(true, () =>
        runLogin(makeDeviceArgs("alipay"), {
          loginWithDevice: async () => {
            throw new Error(
              "DEVICE_STATUS_UNREADABLE: the device status request answered HTTP 200 with a body that is not a JSON object, so it carries no device status (request id: tssdk-oauth-test)",
            )
          },
          resolveLoginTarget: async () => makeTarget(),
        }),
      )
    } finally {
      out.restore()
    }

    expect(out.text()).toContain("DEVICE_STATUS_UNREADABLE")
    expect(out.text()).not.toContain("LOGIN_FAILED")
    expect(process.exitCode).not.toBe(0)
  })
})

// The interactive provider menu: shown only when no --provider was passed, a human
// is watching, and the entry actually advertises device authorization. Everything
// here injects both seams, because the real probe would reach the network and the
// real menu would block on @clack.
describe("runLogin provider menu", () => {
  function makeMenuArgs(overrides: Record<string, unknown> = {}) {
    return { format: "json", debug: false, name: PROFILE, ...overrides } as GlobalArgs & { provider?: string }
  }

  test("Enter on the first option signs in through the browser", async () => {
    let browserCalls = 0
    let deviceCalls = 0
    const out = captureStdout()
    try {
      await withTty(true, () =>
        runLogin(makeMenuArgs(), {
          deviceFlowAvailable: async () => true,
          promptProvider: async () => "browser",
          loginWithBrowser: async () => {
            browserCalls++
            return KNOWN_RESULT
          },
          loginWithDevice: async () => {
            deviceCalls++
            return KNOWN_RESULT
          },
          resolveLoginTarget: async () => makeTarget(),
        }),
      )
    } finally {
      out.restore()
    }

    expect(browserCalls).toBe(1)
    expect(deviceCalls).toBe(0)
    expect((JSON.parse(out.text()) as { data: Record<string, unknown> }).data.login_method).toBe("browser")
    expect(process.exitCode).toBe(0)
  })

  test("choosing a platform reaches the device flow with that provider", async () => {
    let sawProvider: string | undefined
    const out = captureStdout()
    try {
      await withTty(true, () =>
        runLogin(makeMenuArgs(), {
          deviceFlowAvailable: async () => true,
          promptProvider: async () => "ALIPAY",
          loginWithDevice: async ({ provider }) => {
            sawProvider = provider
            return KNOWN_RESULT
          },
          loginWithBrowser: async () => {
            throw new Error("the browser flow must not run when a platform was chosen")
          },
          resolveLoginTarget: async () => makeTarget(),
        }),
      )
    } finally {
      out.restore()
    }

    expect(sawProvider).toBe("ALIPAY")
    expect((JSON.parse(out.text()) as { data: Record<string, unknown> }).data.login_method).toBe("device")
    expect(makeProfileTokenStore(PROFILE).load()).toEqual(PERSISTED_TOKEN)
    expect(process.exitCode).toBe(0)
  })

  // Aborting must not fall through to the browser: that would sign the user in
  // through the very flow they backed out of, and they would have no way to tell.
  test("aborting the menu writes nothing and is not a browser sign-in", async () => {
    let browserCalls = 0
    let deviceCalls = 0
    const out = captureStdout()
    try {
      await withTty(true, () =>
        runLogin(makeMenuArgs(), {
          deviceFlowAvailable: async () => true,
          promptProvider: async () => undefined,
          loginWithBrowser: async () => {
            browserCalls++
            return KNOWN_RESULT
          },
          loginWithDevice: async () => {
            deviceCalls++
            return KNOWN_RESULT
          },
          resolveLoginTarget: async () => makeTarget(),
        }),
      )
    } finally {
      out.restore()
    }

    expect(out.text()).toContain("LOGIN_CANCELLED")
    expect(browserCalls).toBe(0)
    expect(deviceCalls).toBe(0)
    expect(makeProfileTokenStore(PROFILE).load()).toBeUndefined()
    expect(process.exitCode).not.toBe(0)
  })

  // Three ways the menu must stay out of the way. Each asserts the probe was not
  // even attempted where it is pointless — it costs a discovery round trip, and on
  // a non-TTY it would be spent on a question nobody can answer.
  test.each([
    ["an explicit --provider skips the menu", { provider: "alipay" }, true],
    ["a non-TTY run never asks", {}, false],
  ])("%s", async (_label, extra, isTty) => {
    let menuCalls = 0
    let probeCalls = 0
    const out = captureStdout()
    try {
      await withTty(isTty as boolean, () =>
        runLogin(makeMenuArgs(extra as Record<string, unknown>), {
          deviceFlowAvailable: async () => {
            probeCalls++
            return true
          },
          promptProvider: async () => {
            menuCalls++
            return "browser"
          },
          loginWithBrowser: async () => KNOWN_RESULT,
          loginWithDevice: async () => KNOWN_RESULT,
          resolveLoginTarget: async () => makeTarget(),
        }),
      )
    } finally {
      out.restore()
    }

    expect(menuCalls).toBe(0)
    expect(probeCalls).toBe(0)
    expect(process.exitCode).toBe(0)
  })

  // One usable option is not a choice. Asking here would list four QR platforms
  // that all end in DEVICE_FLOW_UNSUPPORTED.
  test("an entry without device flow goes straight to the browser", async () => {
    let menuCalls = 0
    let browserCalls = 0
    const out = captureStdout()
    try {
      await withTty(true, () =>
        runLogin(makeMenuArgs(), {
          deviceFlowAvailable: async () => false,
          promptProvider: async () => {
            menuCalls++
            return "browser"
          },
          loginWithBrowser: async () => {
            browserCalls++
            return KNOWN_RESULT
          },
          resolveLoginTarget: async () => makeTarget(),
        }),
      )
    } finally {
      out.restore()
    }

    expect(menuCalls).toBe(0)
    expect(browserCalls).toBe(1)
    expect(process.exitCode).toBe(0)
  })

  // The menu's contents come from the same table the device flow uses, so a new
  // platform in DEVICE_PROVIDERS reaches the menu with no edit in login.ts.
  //
  // `password` is the one route left out: it is the same act as the browser option
  // from the user's side, and offering both makes the menu ask a question with two
  // answers the user cannot tell apart. It stays reachable as --provider password,
  // which the device suite above still covers.
  test("offers the scan platforms and leaves password to the flag", async () => {
    let offered: Array<{ label: string; value: string }> = []
    const out = captureStdout()
    try {
      await withTty(true, () =>
        runLogin(makeMenuArgs(), {
          deviceFlowAvailable: async () => true,
          promptProvider: async (choices) => {
            offered = choices
            return "browser"
          },
          loginWithBrowser: async () => KNOWN_RESULT,
          resolveLoginTarget: async () => makeTarget(),
        }),
      )
    } finally {
      out.restore()
    }

    expect(offered.map((choice) => choice.value)).toEqual(["WECHAT", "ALIPAY"])
    // One short of the advertised list, and it is exactly `password` that is missing.
    expect(offered).toHaveLength(DEVICE_PROVIDERS.length - 1)
    expect(offered.map((choice) => choice.value)).not.toContain("PASSWORD")
    // Every offered route says "scan", so none of them reads like the browser option.
    expect(offered.every((choice) => choice.label.startsWith("Scan with"))).toBe(true)
  })

  // A re-login should be one Enter, not the same decision made again.
  test("remembers the route a successful login used and offers it back", async () => {
    const out = captureStdout()
    try {
      await withTty(true, () =>
        runLogin(makeMenuArgs(), {
          deviceFlowAvailable: async () => true,
          promptProvider: async () => "ALIPAY",
          loginWithDevice: async () => KNOWN_RESULT,
          resolveLoginTarget: async () => makeTarget(),
        }),
      )
    } finally {
      out.restore()
    }
    expect(readLastProvider(PROFILE)).toBe("ALIPAY")

    // Second run: the remembered route reaches the menu as its preselection.
    let initial: string | undefined
    const second = captureStdout()
    try {
      await withTty(true, () =>
        runLogin(makeMenuArgs(), {
          deviceFlowAvailable: async () => true,
          promptProvider: async (_choices, remembered) => {
            initial = remembered
            return "ALIPAY"
          },
          loginWithDevice: async () => KNOWN_RESULT,
          resolveLoginTarget: async () => makeTarget(),
        }),
      )
    } finally {
      second.restore()
    }
    expect(initial).toBe("ALIPAY")
  })

  test("records the browser route too, so it can be preselected like any other", async () => {
    const out = captureStdout()
    try {
      await withTty(true, () =>
        runLogin(makeMenuArgs(), {
          deviceFlowAvailable: async () => true,
          promptProvider: async () => "browser",
          loginWithBrowser: async () => KNOWN_RESULT,
          resolveLoginTarget: async () => makeTarget(),
        }),
      )
    } finally {
      out.restore()
    }
    expect(readLastProvider(PROFILE)).toBe("browser")
  })

  // A remembered route must not resurrect a failed attempt, and an aborted menu is
  // not a route at all.
  test("an aborted menu records nothing", async () => {
    const out = captureStdout()
    try {
      await withTty(true, () =>
        runLogin(makeMenuArgs(), {
          deviceFlowAvailable: async () => true,
          promptProvider: async () => undefined,
          loginWithBrowser: async () => KNOWN_RESULT,
          resolveLoginTarget: async () => makeTarget(),
        }),
      )
    } finally {
      out.restore()
    }
    expect(readLastProvider(PROFILE)).toBeUndefined()
  })

  // The hint outlives the menu it was written for: `password` was offerable once and
  // is not any more. Pointing @clack at an absent option highlights nothing, so the
  // menu must fall back to its own first entry rather than trust the stored value.
  test("a remembered route that is no longer offered does not preselect anything", async () => {
    const out = captureStdout()
    try {
      await withTty(true, () =>
        runLogin(makeMenuArgs({ provider: "password" }), {
          loginWithDevice: async () => KNOWN_RESULT,
          resolveLoginTarget: async () => makeTarget(),
        }),
      )
    } finally {
      out.restore()
    }
    expect(readLastProvider(PROFILE)).toBe("PASSWORD")

    let offered: Array<{ value: string }> = []
    let initial: string | undefined
    const second = captureStdout()
    try {
      await withTty(true, () =>
        runLogin(makeMenuArgs(), {
          deviceFlowAvailable: async () => true,
          promptProvider: async (choices, remembered) => {
            offered = choices
            initial = remembered
            return "browser"
          },
          loginWithBrowser: async () => KNOWN_RESULT,
          resolveLoginTarget: async () => makeTarget(),
        }),
      )
    } finally {
      second.restore()
    }

    // Handed over verbatim: the command layer does not second-guess the stored value,
    // it is the menu that decides whether it is still offerable — preselectedProvider
    // below.
    expect(initial).toBe("PASSWORD")
    expect(offered.map((choice) => choice.value)).not.toContain("PASSWORD")
  })
  // A failure after a menu choice is a DEVICE failure. `argv.provider` is empty on
  // this path, so classifying on it told a user whose scan died to go look for a
  // browser window that never opened, and to re-run the plain command.
  test("a generic failure after a menu choice is reported as a device failure", async () => {
    const out = captureStdout()
    try {
      await withTty(true, () =>
        runLogin(makeMenuArgs(), {
          deviceFlowAvailable: async () => true,
          promptProvider: async () => "ALIPAY",
          loginWithDevice: async () => {
            throw new Error("socket hang up")
          },
          loginWithBrowser: async () => {
            throw new Error("the browser flow must not run when a platform was chosen")
          },
          resolveLoginTarget: async () => makeTarget(),
        }),
      )
    } finally {
      out.restore()
    }

    const payload = JSON.parse(out.text()) as { error: { code: string }; ai_message?: string }
    expect(payload.error.code).toBe("LOGIN_FAILED")
    expect(payload.ai_message).toContain("QR sign-in")
    expect(payload.ai_message).not.toContain("Browser sign-in")
  })

  // The same failure with no provider chosen keeps the browser wording, so the
  // fix above is a distinction and not a blanket relabel.
  test("a generic failure after choosing the browser stays a browser failure", async () => {
    const out = captureStdout()
    try {
      await withTty(true, () =>
        runLogin(makeMenuArgs(), {
          deviceFlowAvailable: async () => true,
          promptProvider: async () => "browser",
          loginWithBrowser: async () => {
            throw new Error("socket hang up")
          },
          resolveLoginTarget: async () => makeTarget(),
        }),
      )
    } finally {
      out.restore()
    }

    const payload = JSON.parse(out.text()) as { error: { code: string }; ai_message?: string }
    expect(payload.error.code).toBe("LOGIN_FAILED")
    expect(payload.ai_message).toContain("Browser sign-in")
  })
})

describe("preselectedProvider", () => {
  test("preselects a remembered route the menu still offers", () => {
    expect(preselectedProvider(["browser", "WECHAT", "ALIPAY"], "ALIPAY")).toBe("ALIPAY")
    expect(preselectedProvider(["browser", "ALIPAY"], "browser")).toBe("browser")
  })

  // The case this function exists for: `password` used to be on the menu, so a
  // profiles.toml written by an older build can still name it.
  test("drops a remembered route the menu no longer offers", () => {
    expect(preselectedProvider(["browser", "WECHAT", "ALIPAY"], "PASSWORD")).toBeUndefined()
  })

  test("no memory means no preselection", () => {
    expect(preselectedProvider(["browser", "ALIPAY"], undefined)).toBeUndefined()
    expect(preselectedProvider(["browser", "ALIPAY"], "")).toBeUndefined()
  })

  // A stored value is just text from a file the user can edit; it must not be
  // returned merely because it looks plausible.
  test("garbage in the file does not become a preselection", () => {
    expect(preselectedProvider(["browser", "ALIPAY"], "feishu")).toBeUndefined()
    expect(preselectedProvider(["browser", "ALIPAY"], "toString")).toBeUndefined()
  })
})
