import { afterEach, beforeEach, describe, expect, test } from "bun:test"

import { clearTokenCache, getToken } from "../src/auth/token.js"
import type { AuthToken, ConnectionConfig, TokenStore } from "../src/types/index.js"

/**
 * Task 5.1 — token refresh tests (Requirements 5.1, 5.3, 5.4, 5.5; Property 5).
 *
 * These tests exercise the *public* token seam (`getToken` / `clearTokenCache`)
 * and only stub `globalThis.fetch` and the clock (`Date.now`). No business
 * logic is mocked — real `login.ts` / `oauth.ts` / `token.ts` run.
 *
 * The refresh path is reached with an OAuth token that carries a
 * `refreshToken`. Such a token is ONLY minted by the browser OAuth login
 * (`loginWithBrowser`) and persisted via a `TokenStore` — PAT / username-
 * password logins are plain credential exchanges and never carry an OAuth
 * refresh token (they must not send `oauthLoginParam`; that contaminated
 * non-OAuth portals with business error 5014). So the refresh scenarios seed a
 * persisted OAuth token through an in-memory `TokenStore` rather than a portal
 * login that echoes an `authorizationCode`.
 *
 * How expiry is driven deterministically (no real waiting):
 *   `isTokenExpired` compares `Date.now() - token.obtainedAt` against
 *   `token.expireTimeMs * EXPIRED_FACTOR` (0.8). We stub `Date.now` with a
 *   fake clock `now`. The cached token's `obtainedAt` is frozen at the value
 *   of `now` when it was fetched; advancing `now` past `expireTimeMs * 0.8`
 *   makes the cached token expired on the next `getToken` call.
 */

/** Minimal in-memory TokenStore seam for seeding the persisted OAuth token. */
function memoryStore(initial?: AuthToken): TokenStore {
  let current = initial
  return {
    load: () => current,
    save: (token) => { current = token },
    clear: () => { current = undefined },
  }
}

/** A persisted OAuth token as produced by `loginWithBrowser`, frozen at `now`. */
function seededOAuthToken(now: number): AuthToken {
  return {
    token: "access-1",
    refreshToken: "refresh-1",
    instanceId: 9,
    userId: 7,
    expireTimeMs: 900_000,
    obtainedAt: now,
  }
}

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

function config(): ConnectionConfig {
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
  }
}

interface TokenResult {
  body: Record<string, unknown>
  status?: number
}

interface StubCalls {
  login: number
  tokenGrants: string[]
  refreshTokensSent: Array<string | null>
}

/**
 * Install a `globalThis.fetch` stub driven by two handlers and return a
 * counters object so tests can assert which endpoints were hit and with what.
 *   - `login()` returns the `data` field for /clickzetta-portal/user/loginSingle
 *   - `token(params)` returns the body/status for /oauth2/token
 */
function buildFetch(handlers: {
  login: () => Record<string, unknown>
  token: (params: URLSearchParams) => TokenResult
}): StubCalls {
  const calls: StubCalls = { login: 0, tokenGrants: [], refreshTokensSent: [] }
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

describe("token refresh (getToken)", () => {
  test("Scenario A: expired OAuth token with refreshToken refreshes instead of full login", async () => {
    let refreshCount = 0
    const calls = buildFetch({
      login: () => ({ token: "legacy", userId: 7, instanceId: 9, expireTime: 999 }),
      token: (params) => {
        // Only refresh_token grants happen here; a full login would not.
        expect(params.get("grant_type")).toBe("refresh_token")
        refreshCount += 1
        return {
          body: {
            access_token: `access-${refreshCount + 1}`,
            refresh_token: `refresh-${refreshCount + 1}`,
            token_type: "Bearer",
            expires_in: 900,
          },
        }
      },
    })

    // Seed a persisted OAuth token (as loginWithBrowser would) so the refresh
    // path is driven by tokenStore, not a password login.
    const cfg: ConnectionConfig = { ...config(), tokenStore: memoryStore(seededOAuthToken(now)) }
    const first = await getToken(cfg)
    expect(first.token).toBe("access-1")
    expect(first.refreshToken).toBe("refresh-1")
    // The seeded token was reused with no network call.
    expect(calls.login).toBe(0)
    expect(calls.tokenGrants.length).toBe(0)

    // Advance past expiry: 0.8 * 900000 = 720000ms.
    now += 800_000

    const second = await getToken(cfg)
    // The refresh endpoint must be hit with the cached refresh token...
    expect(calls.tokenGrants).toEqual(["refresh_token"])
    expect(calls.refreshTokensSent).toEqual(["refresh-1"])
    // ...and NO portal login should happen on the refresh path.
    expect(calls.login).toBe(0)
    expect(second.token).toBe("access-2")
    expect(second.refreshToken).toBe("refresh-2")
  })

  test("Scenario B: subsequent refresh uses the latest rotated refresh token", async () => {
    let refreshCount = 0
    const calls = buildFetch({
      login: () => ({ token: "legacy", userId: 7, instanceId: 9, expireTime: 999 }),
      token: () => {
        refreshCount += 1
        return {
          body: {
            access_token: `access-${refreshCount + 1}`,
            refresh_token: `refresh-${refreshCount + 1}`,
            token_type: "Bearer",
            expires_in: 900,
          },
        }
      },
    })

    const cfg: ConnectionConfig = { ...config(), tokenStore: memoryStore(seededOAuthToken(now)) }
    await getToken(cfg) // seeded access-1 / refresh-1

    now += 800_000
    const second = await getToken(cfg) // refresh-1 → access-2 / refresh-2
    expect(second.refreshToken).toBe("refresh-2")

    now += 800_000
    const third = await getToken(cfg) // refresh-2 → access-3 / refresh-3
    expect(third.refreshToken).toBe("refresh-3")

    // Each refresh used the most recently rotated refresh token.
    expect(calls.refreshTokensSent).toEqual(["refresh-1", "refresh-2"])
    expect(calls.login).toBe(0)
  })

  test("Scenario C: refresh failure (invalid_grant) with credentials falls back to full login", async () => {
    const calls = buildFetch({
      // Fallback portal login is a plain password exchange: legacy token, no
      // authorizationCode, no refreshToken.
      login: () => ({ token: "relogin-token", userId: 7, instanceId: 9, expireTime: 900_000 }),
      token: (params) => {
        // The refresh token is dead; only refresh_token grants reach here.
        expect(params.get("grant_type")).toBe("refresh_token")
        return { body: { error: "invalid_grant" }, status: 400 }
      },
    })

    // Seeded OAuth token, but the config also carries username/password so the
    // dead refresh can fall back to a genuine re-login.
    const cfg: ConnectionConfig = { ...config(), tokenStore: memoryStore(seededOAuthToken(now)) }
    const first = await getToken(cfg)
    expect(first.token).toBe("access-1")
    expect(calls.login).toBe(0)

    now += 800_000
    const second = await getToken(cfg)
    // A refresh was attempted...
    expect(calls.tokenGrants).toEqual(["refresh_token"])
    // ...and after it failed, a full portal login was performed as fallback.
    expect(calls.login).toBe(1)
    expect(second.token).toBe("relogin-token")
    expect(second.refreshToken).toBeUndefined()
  })

  test("Scenario D: expired legacy token (no refreshToken) re-logs in, never calls /oauth2/token", async () => {
    const calls = buildFetch({
      // No authorizationCode → legacy token path, AuthToken has no refreshToken.
      login: () => ({
        token: "legacy-token",
        userId: 7,
        instanceId: 9,
        expireTime: 900_000,
      }),
      token: () => ({ body: { error: "should_not_be_called" }, status: 400 }),
    })

    const cfg = config()
    const first = await getToken(cfg)
    expect(first.token).toBe("legacy-token")
    expect(first.refreshToken).toBeUndefined()
    expect(calls.login).toBe(1)

    // Advance past expiry: 0.8 * 900000 = 720000ms.
    now += 800_000
    const second = await getToken(cfg)
    // No OAuth refresh attempt for a legacy token...
    expect(calls.tokenGrants.length).toBe(0)
    // ...just a fresh full login.
    expect(calls.login).toBe(2)
    expect(second.token).toBe("legacy-token")
  })
})
