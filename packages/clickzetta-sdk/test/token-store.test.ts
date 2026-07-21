import { afterEach, beforeEach, describe, expect, test } from "bun:test"

import { clearTokenCache, forceRefreshToken, getToken } from "../src/auth/token.js"
import type { AuthToken, ConnectionConfig, TokenStore } from "../src/types/index.js"

/**
 * Task 8.1 — TokenStore persistence integration
 * (Requirements 9.1, 9.3, 9.4, 9.5, 9.7; Properties 8, 9, 10).
 *
 * These tests exercise the *public* token seam (`getToken` / `clearTokenCache`)
 * with an injected in-memory fake `TokenStore`. Only `globalThis.fetch` and the
 * clock (`Date.now`) are stubbed — real `login.ts` / `oauth.ts` / `token.ts`
 * run. No business logic is mocked.
 *
 * Expiry is driven deterministically by the fake clock `now` (see
 * token-refresh.test.ts for the mechanics): `isTokenExpired` compares
 * `Date.now() - token.obtainedAt` against `token.expireTimeMs * 0.8`.
 */

const originalFetch = globalThis.fetch
const originalDateNow = Date.now
let now = 1_000_000

beforeEach(() => {
  now = 1_000_000
  Date.now = () => now
})

afterEach(() => {
  globalThis.fetch = originalFetch
  Date.now = originalDateNow
  clearTokenCache()
})

function config(store?: TokenStore): ConnectionConfig {
  return {
    pat: "",
    username: "user",
    password: "pass",
    service: "dev-api.clickzetta.com",
    protocol: "https",
    instance: "inst",
    workspace: "",
    schema: "public",
    vcluster: "default",
    tokenStore: store,
  }
}

/**
 * A minimal in-memory TokenStore that records how often save/clear/load were
 * called so tests can assert persistence interactions.
 */
interface FakeStore extends TokenStore {
  current: AuthToken | undefined
  loadCount: number
  saveCount: number
  clearCount: number
  saved: AuthToken[]
}

function makeStore(seed?: AuthToken): FakeStore {
  const store: FakeStore = {
    current: seed,
    loadCount: 0,
    saveCount: 0,
    clearCount: 0,
    saved: [],
    load() {
      this.loadCount += 1
      return this.current
    },
    save(token: AuthToken) {
      this.saveCount += 1
      this.saved.push(token)
      this.current = token
    },
    clear() {
      this.clearCount += 1
      this.current = undefined
    },
  }
  return store
}

interface TokenResult {
  body: Record<string, unknown>
  status?: number
}

interface StubCalls {
  login: number
  tokenGrants: string[]
  refreshTokensSent: Array<string | null>
  tokenHosts: string[]
}

function buildFetch(handlers: {
  login: () => Record<string, unknown>
  token: (params: URLSearchParams) => TokenResult
}): StubCalls {
  const calls: StubCalls = { login: 0, tokenGrants: [], refreshTokensSent: [], tokenHosts: [] }
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input))
    if (url.pathname === "/clickzetta-portal/user/loginSingle" && init?.method === "POST") {
      calls.login += 1
      return new Response(JSON.stringify({ code: 0, data: handlers.login() }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    }
    if (url.pathname === "/clickzetta-hornhub/oauth2/token" && init?.method === "POST") {
      const params = new URLSearchParams(String(init.body))
      const grant = params.get("grant_type") ?? ""
      calls.tokenGrants.push(grant)
      calls.tokenHosts.push(url.host)
      if (grant === "refresh_token") calls.refreshTokensSent.push(params.get("refresh_token"))
      const result = handlers.token(params)
      return new Response(JSON.stringify(result.body), {
        status: result.status ?? 200,
        headers: { "content-type": "application/json" },
      })
    }
    return new Response("not found", { status: 404 })
  }) as typeof fetch
  return calls
}

describe("token store persistence (getToken)", () => {
  test("persisted-and-valid: reuses persisted token without any HTTP call [Property 8 / Req 9.3]", async () => {
    const persisted: AuthToken = {
      token: "persisted-access",
      refreshToken: "persisted-refresh",
      instanceId: 9,
      userId: 7,
      expireTimeMs: 900_000,
      obtainedAt: now, // fresh → not expired
    }
    const store = makeStore(persisted)
    let fetchCalls = 0
    globalThis.fetch = (async () => {
      fetchCalls += 1
      return new Response("not found", { status: 404 })
    }) as typeof fetch

    clearTokenCache() // empty memory cache
    const token = await getToken(config(store))

    expect(token.token).toBe("persisted-access")
    expect(token.refreshToken).toBe("persisted-refresh")
    expect(fetchCalls).toBe(0)
    expect(store.loadCount).toBeGreaterThanOrEqual(1)
  })

  test("persisted-but-expired: refreshes via persisted refresh token and saves rotated value [Property 9 / Req 9.4]", async () => {
    const persisted: AuthToken = {
      token: "old-access",
      refreshToken: "r1",
      instanceId: 9,
      userId: 7,
      expireTimeMs: 900_000,
      obtainedAt: 0, // elapsed 1_000_000 > 720_000 → expired
    }
    const store = makeStore(persisted)
    const calls = buildFetch({
      login: () => ({
        token: "legacy",
        authorizationCode: "auth-code",
        userId: 7,
        instanceId: 9,
        expireTime: 999,
      }),
      token: (params) => {
        expect(params.get("grant_type")).toBe("refresh_token")
        return {
          body: {
            access_token: "new-access",
            refresh_token: "r2",
            token_type: "Bearer",
            expires_in: 900,
          },
        }
      },
    })

    clearTokenCache()
    const token = await getToken(config(store))

    expect(calls.refreshTokensSent).toEqual(["r1"])
    expect(calls.login).toBe(0) // no portal login on refresh path
    expect(token.token).toBe("new-access")
    expect(token.refreshToken).toBe("r2")
    // store.save was called with the rotated refresh token.
    expect(store.saveCount).toBeGreaterThanOrEqual(1)
    expect(store.current?.refreshToken).toBe("r2")
    expect(store.current?.token).toBe("new-access")
  })

  test("refresh failure: clears store then performs full portal login [Req 9.5]", async () => {
    const persisted: AuthToken = {
      token: "old-access",
      refreshToken: "r1",
      instanceId: 9,
      userId: 7,
      expireTimeMs: 900_000,
      obtainedAt: 0, // expired
    }
    const store = makeStore(persisted)
    const calls = buildFetch({
      login: () => ({
        token: "legacy",
        authorizationCode: "auth-code",
        userId: 7,
        instanceId: 9,
        expireTime: 999,
      }),
      token: (params) => {
        if (params.get("grant_type") === "refresh_token") {
          return { body: { error: "invalid_grant" }, status: 400 }
        }
        return {
          body: {
            access_token: "login-access",
            refresh_token: "login-refresh",
            token_type: "Bearer",
            expires_in: 900,
          },
        }
      },
    })

    clearTokenCache()
    const token = await getToken(config(store))

    expect(calls.tokenGrants).toContain("refresh_token")
    expect(store.clearCount).toBeGreaterThanOrEqual(1)
    expect(calls.login).toBe(1) // fell back to full login
    expect(token.token).toBe("login-access")
    // store ends cleared-or-overwritten by the new login token.
    expect(store.current?.token).toBe("login-access")
  })

  test("save after fresh login: empty store gets save called with the OAuth token [Req 9.1]", async () => {
    const store = makeStore(undefined)
    const calls = buildFetch({
      login: () => ({
        token: "legacy",
        authorizationCode: "auth-code",
        userId: 7,
        instanceId: 9,
        expireTime: 999,
      }),
      token: () => ({
        body: {
          access_token: "fresh-access",
          refresh_token: "fresh-refresh",
          token_type: "Bearer",
          expires_in: 900,
        },
      }),
    })

    clearTokenCache()
    const token = await getToken(config(store))

    expect(calls.login).toBe(1)
    expect(token.token).toBe("fresh-access")
    expect(store.saveCount).toBeGreaterThanOrEqual(1)
    expect(store.current?.token).toBe("fresh-access")
    expect(store.current?.refreshToken).toBe("fresh-refresh")
  })

  test("backward compat: no tokenStore behaves as before, in-memory cache only [Property 10 / Req 9.7]", async () => {
    const calls = buildFetch({
      login: () => ({
        token: "legacy",
        authorizationCode: "auth-code",
        userId: 7,
        instanceId: 9,
        expireTime: 999,
      }),
      token: () => ({
        body: {
          access_token: "access-1",
          refresh_token: "refresh-1",
          token_type: "Bearer",
          expires_in: 900,
        },
      }),
    })

    const cfg = config(undefined)
    const first = await getToken(cfg)
    expect(first.token).toBe("access-1")
    expect(calls.login).toBe(1)

    // Second call within validity window → served from memory, no new login.
    const second = await getToken(cfg)
    expect(second.token).toBe("access-1")
    expect(calls.login).toBe(1)
  })

  // Regression: OAuth `/oauth2/token` is served ONLY by the issuer host recorded
  // on the token (issuer), NOT the region business host in config.service.
  // Sending the refresh to config.service returns invalid_grant and silently
  // drops the user to a broken "logged out" state every hour.
  test("refresh targets the token's issuer, not config.service", async () => {
    const persisted: AuthToken = {
      token: "old-access",
      refreshToken: "r1",
      instanceId: 9,
      userId: 7,
      expireTimeMs: 900_000,
      obtainedAt: 0, // expired
      issuer: "api.clickzetta.com", // OAuth issuer host
    }
    const store = makeStore(persisted)
    const calls = buildFetch({
      login: () => ({ token: "should-not-login", authorizationCode: "x", userId: 7, instanceId: 9, expireTime: 999 }),
      token: () => ({
        body: { access_token: "new-access", refresh_token: "r2", token_type: "Bearer", expires_in: 900 },
      }),
    })

    // config.service is the REGION host — must NOT be where refresh is sent.
    const cfg = { ...config(store), service: "ap-shanghai-tencentcloud.api.clickzetta.com" }
    const token = await getToken(cfg)

    expect(token.token).toBe("new-access")
    expect(calls.tokenGrants).toContain("refresh_token")
    expect(calls.tokenHosts).toContain("api.clickzetta.com")
    expect(calls.tokenHosts).not.toContain("ap-shanghai-tencentcloud.api.clickzetta.com")
    expect(calls.login).toBe(0) // refreshed, never fell back to full login
    // The rotated token carries the issuer forward for the next refresh.
    expect(token.issuer).toBe("api.clickzetta.com")
    expect(store.saved.at(-1)?.issuer).toBe("api.clickzetta.com")
  })

  // D — cacheKey collision: two OAuth profiles on the SAME instance (both with
  // empty pat/username) must NOT share the in-memory cache. Distinct config
  // .cacheKey values keep them independent; without it both key to `instance:`.
  test("two OAuth configs on the same instance don't share the cache when cacheKey differs", async () => {
    const tokenA: AuthToken = { token: "A", refreshToken: "ra", instanceId: 1, userId: 1, expireTimeMs: 900_000, obtainedAt: now }
    const tokenB: AuthToken = { token: "B", refreshToken: "rb", instanceId: 1, userId: 2, expireTimeMs: 900_000, obtainedAt: now }
    globalThis.fetch = (async () => new Response("not found", { status: 404 })) as typeof fetch

    const cfgA: ConnectionConfig = { ...config(makeStore(tokenA)), instance: "shared", cacheKey: "oauth-a" }
    const cfgB: ConnectionConfig = { ...config(makeStore(tokenB)), instance: "shared", cacheKey: "oauth-b" }

    expect((await getToken(cfgA)).token).toBe("A")
    // Without per-cacheKey isolation this would wrongly return "A".
    expect((await getToken(cfgB)).token).toBe("B")
  })

  // F — forceRefreshToken must bypass the "unexpired persisted token" shortcut:
  // the server rejected a token the client still thinks is valid (early
  // revocation / skew), so returning the persisted value again would loop.
  test("forceRefreshToken rotates even when the persisted token isn't expired yet", async () => {
    const persisted: AuthToken = {
      token: "still-valid-but-rejected",
      refreshToken: "r1",
      instanceId: 9,
      userId: 7,
      expireTimeMs: 900_000,
      obtainedAt: now, // NOT expired
      issuer: "api.clickzetta.com",
    }
    const store = makeStore(persisted)
    const calls = buildFetch({
      login: () => ({ token: "x", authorizationCode: "x", userId: 7, instanceId: 9, expireTime: 999 }),
      token: () => ({ body: { access_token: "rotated", refresh_token: "r2", token_type: "Bearer", expires_in: 900 } }),
    })

    const cfg = { ...config(store), cacheKey: "oauth-force" }
    const token = await forceRefreshToken(cfg)

    expect(token.token).toBe("rotated") // did NOT return the unexpired persisted token
    expect(calls.tokenGrants).toContain("refresh_token")
  })

  // C — a pure OAuth profile (no pat/username/password) whose refresh token is
  // dead must throw an actionable SESSION_EXPIRED, NOT attempt a password login.
  test("dead refresh token on a credential-less OAuth profile throws SESSION_EXPIRED (no password login)", async () => {
    const persisted: AuthToken = {
      token: "old", refreshToken: "dead", instanceId: 9, userId: 7,
      expireTimeMs: 900_000, obtainedAt: 0, issuer: "api.clickzetta.com",
    }
    const store = makeStore(persisted)
    const calls = buildFetch({
      login: () => ({ token: "should-not-be-called", authorizationCode: "x", userId: 7, instanceId: 9, expireTime: 999 }),
      token: () => ({ status: 400, body: { error: "invalid_grant", error_description: "expired" } }),
    })

    // Pure OAuth: no pat/username/password.
    const cfg: ConnectionConfig = { ...config(store), username: "", password: "", pat: "", cacheKey: "oauth-dead" }
    await expect(getToken(cfg)).rejects.toThrow(/SESSION_EXPIRED|session expired|auth login/i)
    expect(calls.login).toBe(0) // never attempted a portal password login
  })

  // C — a TRANSIENT refresh failure (network/5xx) on a credential-less profile
  // must rethrow the original error (retryable), not dead-end in a login.
  test("transient refresh failure on OAuth profile rethrows, doesn't dead-end in login", async () => {
    const persisted: AuthToken = {
      token: "old", refreshToken: "r1", instanceId: 9, userId: 7,
      expireTimeMs: 900_000, obtainedAt: 0, issuer: "api.clickzetta.com",
    }
    const store = makeStore(persisted)
    const calls = buildFetch({
      login: () => ({ token: "x", authorizationCode: "x", userId: 7, instanceId: 9, expireTime: 999 }),
      token: () => ({ status: 503, body: { error: "server_error", error_description: "upstream" } }),
    })

    const cfg: ConnectionConfig = { ...config(store), username: "", password: "", pat: "", cacheKey: "oauth-transient" }
    await expect(getToken(cfg)).rejects.toThrow()
    expect(calls.login).toBe(0) // did not attempt a password login on a transient error
  })
})
