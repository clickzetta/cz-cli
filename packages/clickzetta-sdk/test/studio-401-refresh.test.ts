import { afterEach, beforeEach, describe, expect, test } from "bun:test"

import { studioRequest } from "../src/studio/client.js"
import { clearTokenCache, connectionTokenSource, staticTokenSource } from "../src/auth/token.js"
import type { AuthToken, ConnectionConfig, StudioConfig, TokenSource, TokenStore } from "../src/types/index.js"

/**
 * A Studio request whose token has expired must rotate the token and retry —
 * the same self-healing `sql` has always had via `ClientOptions.config`.
 *
 * This is a regression lock, not a feature test. `studioRequest` used to pass a
 * token STRING with no way to replace it, so `task` / `job` / `runs` / `schema`
 * turned an expired token into a bare `401 token is invalid` while `sql` on the
 * same profile kept working; PR #84 then hand-patched one more command instead
 * of the shared transport. Contexts now carry a `TokenSource`, so obtaining a
 * credential and being able to rotate it are the same capability.
 */

function memoryStore(initial: AuthToken): TokenStore {
  let current: AuthToken | undefined = initial
  return {
    load: () => current,
    save: (token) => { current = token },
    clear: () => { current = undefined },
  }
}

function oauthToken(now: number, opts: { expired: boolean }): AuthToken {
  return {
    token: "stale-access",
    refreshToken: "refresh-1",
    instanceId: 9,
    userId: 7,
    expireTimeMs: 3_600_000,
    // Past expireTimeMs * EXPIRED_FACTOR when `expired`, comfortably inside it
    // otherwise — the two cases the standard shape handles differently.
    obtainedAt: opts.expired ? now - 3_600_000 : now,
    issuer: "issuer.invalid",
  }
}

function connectionConfig(store: TokenStore): ConnectionConfig {
  return {
    pat: "",
    username: "",
    password: "",
    service: "region.invalid",
    protocol: "https",
    instance: "inst",
    workspace: "ws",
    schema: "public",
    vcluster: "default",
    tokenStore: store,
    cacheKey: "studio-401-test",
  }
}

function studioConfig(tokens: TokenSource): StudioConfig {
  return {
    tokens,
    instanceId: 1,
    workspaceId: 2,
    projectId: 3,
    userId: 7,
    tenantId: 4,
    instanceName: "inst",
    workspaceName: "ws",
    env: "prod",
    baseUrl: "https://region.invalid",
  }
}

const originalFetch = globalThis.fetch
const originalDateNow = Date.now
let now = 2_000_000

/** Records the `x-clickzetta-token` of every Studio call the client makes. */
let studioTokens: string[] = []

beforeEach(() => {
  now = 2_000_000
  Date.now = () => now
  studioTokens = []
  clearTokenCache()
})

afterEach(() => {
  globalThis.fetch = originalFetch
  Date.now = originalDateNow
  clearTokenCache()
})

function stubFetch(opts: { refreshable: boolean }): void {
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(typeof input === "string" || input instanceof URL ? input : input.url)
    if (url.includes("/oauth2/token")) {
      if (!opts.refreshable) {
        return new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 })
      }
      return new Response(
        JSON.stringify({ access_token: "fresh-access", refresh_token: "refresh-2", expires_in: 3600, token_type: "Bearer" }),
        { status: 200, headers: { "content-type": "application/json" } },
      )
    }
    const headers = new Headers(init?.headers as HeadersInit)
    const sent = headers.get("x-clickzetta-token") ?? ""
    studioTokens.push(sent)
    if (sent !== "fresh-access") {
      return new Response(JSON.stringify({ code: 401, message: "token is invalid" }), { status: 401 })
    }
    return new Response(JSON.stringify({ code: 0, data: { ok: true } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    })
  }) as typeof fetch
}

describe("Studio requests authenticate through the context's TokenSource", () => {
  test("a stale credential is refreshed BEFORE the request, so no 401 happens", async () => {
    const store = memoryStore(oauthToken(now, { expired: true }))
    stubFetch({ refreshable: true })

    const resp = await studioRequest(
      studioConfig(connectionTokenSource(connectionConfig(store))),
      "/studio/anything",
      {},
    )

    expect(resp.code).toBe(0)
    // Proactive refresh (EXPIRED_FACTOR) is the primary mechanism: the expired
    // token never reaches the wire. Before contexts carried a source, the token
    // was captured once at context-build time and this request went out stale.
    expect(studioTokens).toEqual(["fresh-access"])
    expect(store.load()?.token).toBe("fresh-access")
  })

  test("a credential the server rejects is rotated and the request retried once", async () => {
    // Not yet expired by the clock, so only the server knows it is dead (early
    // revocation, clock skew). This is what the 401 path is actually for.
    const store = memoryStore(oauthToken(now, { expired: false }))
    stubFetch({ refreshable: true })

    const resp = await studioRequest(
      studioConfig(connectionTokenSource(connectionConfig(store))),
      "/studio/anything",
      {},
    )

    expect(resp.code).toBe(0)
    expect(studioTokens).toEqual(["stale-access", "fresh-access"])
    expect(store.load()?.token).toBe("fresh-access")
  })

  test("a source with no rotation path lets the 401 stand", async () => {
    stubFetch({ refreshable: true })

    await expect(
      studioRequest(
        studioConfig(staticTokenSource({ token: "stale-access", instanceId: 9, userId: 7 })),
        "/studio/anything",
        {},
      ),
    ).rejects.toThrow(/401/)

    // Attempted once: a rejected credential that cannot be replaced is not
    // worth resending, so the retry loop does not burn attempts on it.
    expect(studioTokens).toEqual(["stale-access"])
  })

  test("a dead session fails before issuing the request", async () => {
    const store = memoryStore(oauthToken(now, { expired: true }))
    stubFetch({ refreshable: false })

    await expect(
      studioRequest(studioConfig(connectionTokenSource(connectionConfig(store))), "/studio/anything", {}),
    ).rejects.toThrow(/session expired/i)

    // The source refuses up front, so no doomed request is sent at all.
    expect(studioTokens).toEqual([])
    expect(store.load()).toBeUndefined()
  })
})
