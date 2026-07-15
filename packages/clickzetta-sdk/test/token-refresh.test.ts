import { afterEach, beforeEach, describe, expect, test } from "bun:test"

import { clearTokenCache, getToken } from "../src/auth/token.js"
import type { ConnectionConfig } from "../src/types/index.js"

/**
 * Task 5.1 — token 续期测试 (Requirements 5.1, 5.3, 5.4, 5.5; Property 5).
 *
 * These tests exercise the *public* token seam (`getToken` / `clearTokenCache`)
 * and only stub `globalThis.fetch` and the clock (`Date.now`). No business
 * logic is mocked — real `login.ts` / `oauth.ts` / `token.ts` run.
 *
 * How expiry is driven deterministically (no real waiting):
 *   `isTokenExpired` compares `Date.now() - token.obtainedAt` against
 *   `token.expireTimeMs * EXPIRED_FACTOR` (0.8). We stub `Date.now` with a
 *   fake clock `now`. The cached token's `obtainedAt` is frozen at the value
 *   of `now` when it was fetched; advancing `now` past `expireTimeMs * 0.8`
 *   makes the cached token expired on the next `getToken` call.
 *
 * The refresh behavior under test is implemented in Task 5.2, so the
 * refresh-path assertions are expected to FAIL until then (red state).
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
  test("Scenario A: expired token with refreshToken refreshes instead of full login", async () => {
    let refreshCount = 0
    const calls = buildFetch({
      login: () => ({
        token: "legacy",
        authorizationCode: "auth-code-1",
        userId: 7,
        instanceId: 9,
        expireTime: 999,
      }),
      token: (params) => {
        if (params.get("grant_type") === "authorization_code") {
          return {
            body: {
              access_token: "access-1",
              refresh_token: "refresh-1",
              token_type: "Bearer",
              expires_in: 900,
            },
          }
        }
        // grant_type=refresh_token → rotate
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

    const cfg = config()
    const first = await getToken(cfg)
    expect(first.token).toBe("access-1")
    expect(first.refreshToken).toBe("refresh-1")
    expect(calls.login).toBe(1)

    // Advance past expiry: 0.8 * 900000 = 720000ms.
    now += 800_000

    const second = await getToken(cfg)
    // The refresh endpoint must be hit with the cached refresh token...
    expect(calls.tokenGrants).toContain("refresh_token")
    expect(calls.refreshTokensSent).toEqual(["refresh-1"])
    // ...and NO new portal login should happen on the refresh path.
    expect(calls.login).toBe(1)
    expect(second.token).toBe("access-2")
    expect(second.refreshToken).toBe("refresh-2")
  })

  test("Scenario B: subsequent refresh uses the latest rotated refresh token", async () => {
    let refreshCount = 0
    const calls = buildFetch({
      login: () => ({
        token: "legacy",
        authorizationCode: "auth-code-1",
        userId: 7,
        instanceId: 9,
        expireTime: 999,
      }),
      token: (params) => {
        if (params.get("grant_type") === "authorization_code") {
          return {
            body: {
              access_token: "access-1",
              refresh_token: "refresh-1",
              token_type: "Bearer",
              expires_in: 900,
            },
          }
        }
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

    const cfg = config()
    await getToken(cfg) // access-1 / refresh-1

    now += 800_000
    const second = await getToken(cfg) // refresh-1 → access-2 / refresh-2
    expect(second.refreshToken).toBe("refresh-2")

    now += 800_000
    const third = await getToken(cfg) // refresh-2 → access-3 / refresh-3
    expect(third.refreshToken).toBe("refresh-3")

    // Each refresh used the most recently rotated refresh token.
    expect(calls.refreshTokensSent).toEqual(["refresh-1", "refresh-2"])
    expect(calls.login).toBe(1)
  })

  test("Scenario C: refresh failure (invalid_grant) clears cache and falls back to full login", async () => {
    let loginPhase = 0
    const calls = buildFetch({
      login: () => {
        loginPhase += 1
        return {
          token: "legacy",
          authorizationCode: `auth-code-${loginPhase}`,
          userId: 7,
          instanceId: 9,
          expireTime: 999,
        }
      },
      token: (params) => {
        if (params.get("grant_type") === "refresh_token") {
          return { body: { error: "invalid_grant" }, status: 400 }
        }
        // authorization_code exchange, vary per login phase
        return {
          body: {
            access_token: `access-p${loginPhase}`,
            refresh_token: `refresh-p${loginPhase}`,
            token_type: "Bearer",
            expires_in: 900,
          },
        }
      },
    })

    const cfg = config()
    const first = await getToken(cfg)
    expect(first.token).toBe("access-p1")
    expect(calls.login).toBe(1)

    now += 800_000
    const second = await getToken(cfg)
    // A refresh was attempted...
    expect(calls.tokenGrants).toContain("refresh_token")
    // ...and after it failed, a full portal login was performed as fallback.
    expect(calls.login).toBe(2)
    expect(second.token).toBe("access-p2")
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
