import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test"

import type { AuthToken, ConnectionConfig } from "../src/types/index.js"

/**
 * We mock the login + region modules BEFORE importing token.ts so
 * the module picks up our stubs. This verifies that N concurrent
 * `getToken` callers coalesce onto a single login call.
 *
 * `mock.module` registrations persist for the rest of the process and would
 * otherwise leak into later test files (e.g. login-oauth.test.ts would import
 * the never-resolving `loginWithPassword` stub below and time out). We capture
 * the real modules first and re-register them in `afterAll` to isolate the leak.
 */

const realLogin = { ...(await import("../src/auth/login.js")) }
const realRegion = { ...(await import("../src/config/region.js")) }

let loginCalls = 0
let loginResolver: ((t: AuthToken) => void) | undefined

mock.module("../src/auth/login.js", () => ({
  loginWithPat: async (): Promise<AuthToken> => {
    loginCalls += 1
    return await new Promise<AuthToken>((resolve) => {
      loginResolver = resolve
    })
  },
  loginWithPassword: async (): Promise<AuthToken> => {
    loginCalls += 1
    return await new Promise<AuthToken>((resolve) => {
      loginResolver = resolve
    })
  },
}))

mock.module("../src/config/region.js", () => ({
  toServiceUrl: (_service: string, _protocol: string) => "https://test.invalid",
}))

// Import AFTER mocks are registered.
const { getToken, clearTokenCache, forceRefreshToken } = await import(
  "../src/auth/token.js"
)

// Restore the real modules so the leak does not break later test files.
afterAll(() => {
  mock.module("../src/auth/login.js", () => realLogin)
  mock.module("../src/config/region.js", () => realRegion)
})

function freshConfig(seed: number): ConnectionConfig {
  return {
    pat: `pat-${seed}`,
    username: "",
    password: "",
    service: "dev-api.clickzetta.com",
    protocol: "https",
    instance: `instance-${seed}`,
    workspace: "",
    schema: "public",
    vcluster: "default",
  }
}

describe("token mutex (pendingFetch)", () => {
  beforeEach(() => {
    clearTokenCache()
    loginCalls = 0
    loginResolver = undefined
  })

  test("10 concurrent getToken calls trigger exactly 1 login", async () => {
    const config = freshConfig(1)
    const promises = Array.from({ length: 10 }, () => getToken(config))

    // Wait a microtask so all 10 are queued and share pendingFetch.
    await Promise.resolve()
    expect(loginCalls).toBe(1)
    expect(loginResolver).toBeDefined()

    const token: AuthToken = {
      token: "tok-abc",
      instanceId: 1,
      userId: 1,
      expireTimeMs: 3_600_000,
      obtainedAt: Date.now(),
    }
    loginResolver!(token)

    const results = await Promise.all(promises)
    for (const r of results) {
      expect(r.token).toBe("tok-abc")
    }
    expect(loginCalls).toBe(1)
  })

  test("forceRefreshToken invalidates cache and yields a new token", async () => {
    const config = freshConfig(2)

    // Seed the cache with an initial token.
    const first = getToken(config)
    await Promise.resolve()
    loginResolver!({
      token: "tok-1",
      instanceId: 1,
      userId: 1,
      expireTimeMs: 3_600_000,
      obtainedAt: Date.now(),
    })
    const t1 = await first
    expect(t1.token).toBe("tok-1")
    expect(loginCalls).toBe(1)

    // forceRefreshToken should drop the cache and call login again.
    const refreshing = forceRefreshToken(config)
    await Promise.resolve()
    expect(loginCalls).toBe(2)
    loginResolver!({
      token: "tok-2",
      instanceId: 1,
      userId: 1,
      expireTimeMs: 3_600_000,
      obtainedAt: Date.now(),
    })
    const t2 = await refreshing
    expect(t2.token).toBe("tok-2")
  })
})
