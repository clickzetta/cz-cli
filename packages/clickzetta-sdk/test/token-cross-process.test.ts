import { afterEach, beforeEach, expect, test } from "bun:test"

import { clearTokenCache, connectionTokenSource, forceRefreshToken, getToken } from "../src/auth/token.js"
import { request } from "../src/client.js"
import type { AuthToken, ConnectionConfig, TokenStore } from "../src/types/index.js"

/**
 * SDK coordination tests with an in-process store: reload peer results, coalesce
 * forced requests and stop on terminal storage errors. These fakes do not prove
 * cross-process exclusion; the CLI suite exercises real SQLite and subprocesses.
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

function oauthToken(overrides: Partial<AuthToken> = {}): AuthToken {
  return {
    token: "access-1",
    refreshToken: "refresh-1",
    userId: 7,
    expireTimeMs: 900_000,
    obtainedAt: now,
    issuer: "api.clickzetta.com",
    ...overrides,
  }
}

/** A store whose backing value a test can rewrite to play the peer process. */
function peerStore(initial: AuthToken, opts: { onLock?: () => void } = {}) {
  let current: AuthToken | undefined = initial
  const store: TokenStore = {
    load: () => current,
    save: (token) => {
      current = token
      return true
    },
    clear: () => {
      current = undefined
    },
    refresh: (_previous, request) => request(),
    withLock: async (critical) => {
      // Whatever the peer did while we queued for the lock has landed by the time
      // the critical section starts.
      opts.onLock?.()
      return critical()
    },
  }
  return {
    store,
    peerWrites: (token: AuthToken) => {
      current = token
    },
    get current() {
      return current
    },
  }
}

function config(store: TokenStore): ConnectionConfig {
  return {
    pat: "",
    username: "",
    password: "",
    service: "dev-api.clickzetta.com",
    protocol: "https",
    instance: "inst",
    workspace: "",
    schema: "public",
    vcluster: "default",
    tokenStore: store,
    cacheKey: "sess",
  }
}

/** Records every refresh_token sent to /oauth2/token and answers with a rotation. */
function stubRefresh() {
  const sent: string[] = []
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input))
    if (!url.pathname.endsWith("/oauth2/token")) throw new Error(`unexpected call: ${url.pathname}`)
    const params = new URLSearchParams(String(init?.body ?? ""))
    const used = params.get("refresh_token") ?? ""
    sent.push(used)
    return new Response(
      JSON.stringify({
        access_token: `access-after-${used}`,
        refresh_token: `rotated-from-${used}`,
        expires_in: 900,
        token_type: "Bearer",
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    )
  }) as typeof fetch
  return sent
}

test("an expired in-memory token does not supply the refresh token — the store does", async () => {
  const peer = peerStore(oauthToken())
  const cfg = config(peer.store)

  // Prime this process's in-memory cache with refresh-1, the way a long-lived
  // process (agent session, `mcp serve`) holds one for as long as it runs.
  globalThis.fetch = (async () => {
    throw new Error("no network expected while unexpired")
  }) as typeof fetch
  expect((await getToken(cfg)).token).toBe("access-1")

  // A peer rotates. refresh-1 is now spent server-side; refresh-2 is what works.
  peer.peerWrites(oauthToken({ token: "access-2", refreshToken: "refresh-2", obtainedAt: now }))
  now += 800_000 // past 0.8 * 900_000 → both copies read as expired

  const sent = stubRefresh()
  const refreshed = await getToken(cfg)

  // The bug this pins: refreshing with refresh-1 is what the server answers with
  // invalid_grant, and it is what a memory-first read would have sent.
  expect(sent).toEqual(["refresh-2"])
  expect(refreshed.token).toBe("access-after-refresh-2")
})

test("a peer that rotates while we wait for the lock costs zero network calls", async () => {
  const stale = oauthToken({ obtainedAt: now - 800_000 })
  // The peer's rotation lands during the lock wait, not before it: seeding it
  // earlier would pass on the outer read alone and prove nothing about the lock.
  const peer = peerStore(stale, {
    onLock: () =>
      peer.peerWrites(oauthToken({ token: "access-fresh", refreshToken: "refresh-fresh", obtainedAt: now })),
  })

  const sent = stubRefresh()
  const token = await getToken(config(peer.store))

  expect(sent).toEqual([])
  expect(token.token).toBe("access-fresh")
})

test("the rotation happens inside the store's lock, and its result is persisted there", async () => {
  let insideLock = 0
  let sawFetchInsideLock = false
  let current: AuthToken | undefined = oauthToken({ obtainedAt: now - 800_000 })
  const store: TokenStore = {
    load: () => current,
    save: (token) => {
      current = token
      return true
    },
    clear: () => {
      current = undefined
    },
    refresh: (_previous, request) => request(),
    withLock: async (critical) => {
      insideLock += 1
      try {
        return await critical()
      } finally {
        insideLock -= 1
      }
    },
  }
  globalThis.fetch = (async () => {
    sawFetchInsideLock = insideLock > 0
    return new Response(
      JSON.stringify({ access_token: "access-2", refresh_token: "refresh-2", expires_in: 900, token_type: "Bearer" }),
      { status: 200, headers: { "content-type": "application/json" } },
    )
  }) as typeof fetch

  await getToken(config(store))

  expect(sawFetchInsideLock).toBe(true)
  expect(current?.refreshToken).toBe("refresh-2")
})

test("the rotated token is persisted BEFORE the lock is released", async () => {
  // A peer that takes the lock the instant we release it must find the ROTATED
  // token, not the one we started from. Persisting after release leaves a window in
  // which the peer spends a refresh token we have already rotated — which on a
  // server that treats refresh reuse as a breach revokes the whole family, i.e.
  // signs every process out at once.
  let current: AuthToken | undefined = oauthToken({ obtainedAt: now - 800_000 })
  let onDiskAtRelease: string | undefined
  const store: TokenStore = {
    load: () => current,
    save: (token) => {
      current = token
      return true
    },
    clear: () => {
      current = undefined
    },
    refresh: (_previous, request) => request(),
    withLock: async (critical) => {
      const result = await critical()
      onDiskAtRelease = current?.refreshToken
      return result
    },
  }
  stubRefresh()

  await getToken(config(store))

  expect(onDiskAtRelease).toBe("rotated-from-refresh-1")
})

test("a 401 on a token a peer has replaced adopts the peer's token, without refreshing", async () => {
  // The case where this process kept using an access token while a peer rotated: the
  // server rejects it, and recovery must come off disk. Refreshing here would send
  // OUR refresh token, which the peer's rotation already spent.
  const peer = peerStore(oauthToken())
  const cfg = config(peer.store)
  const source = connectionTokenSource(cfg)

  globalThis.fetch = (async () => {
    throw new Error("no network expected")
  }) as typeof fetch
  const held = await source.get()
  expect(held.token).toBe("access-1")

  peer.peerWrites(oauthToken({ token: "access-peer", refreshToken: "refresh-peer", obtainedAt: now }))
  const sent = stubRefresh()

  const recovered = await source.rotate(held)

  expect(sent).toEqual([])
  expect(recovered?.token).toBe("access-peer")
})

test("a stored section with no refresh_token does not discard one held in memory", async () => {
  // `refresh_token` is optional in a persisted section, so an older version's entry
  // parses as a valid token that cannot rotate. Letting it win would fall through to a
  // full login — on a pure-OAuth profile, a password login with empty credentials.
  let current: AuthToken | undefined = oauthToken()
  const store: TokenStore = {
    load: () => current,
    save: (token) => {
      current = token
      return true
    },
    clear: () => {
      current = undefined
    },
    refresh: (_previous, request) => request(),
    withLock: (critical) => critical(),
  }
  const cfg = config(store)

  globalThis.fetch = (async () => {
    throw new Error("no network expected while unexpired")
  }) as typeof fetch
  await getToken(cfg) // memory now holds refresh-1

  // The section loses its refresh_token (legacy shape) and both copies expire.
  const { refreshToken: _dropped, ...withoutRefresh } = oauthToken({ obtainedAt: now })
  current = withoutRefresh as AuthToken
  now += 800_000

  const sent = stubRefresh()
  await getToken(cfg)

  expect(sent).toEqual(["refresh-1"])
})

test("a refresh that times out is a coded error, and evicts only this connection", async () => {
  // The deadline exists so a hung issuer cannot hold the cross-process lock. Its
  // rejection is a DOMException, which carries no OAuth code and no request id, and
  // the failure path used to wipe EVERY profile's cached token on the way out.
  const peerA = peerStore(oauthToken({ obtainedAt: now - 800_000 }))
  // This store serves its token exactly once, so the second read can only be answered
  // from the in-memory cache. That is what makes the eviction's SCOPE observable:
  // with a store that keeps answering, a process-wide wipe is indistinguishable from
  // a scoped one, because the reload silently succeeds.
  let served = false
  const otherToken = oauthToken({ token: "access-other", refreshToken: "refresh-other" })
  const otherStore: TokenStore = {
    load: () => (served ? undefined : ((served = true), otherToken)),
    save: () => true,
    clear: () => {},
    refresh: (_previous, request) => request(),
    withLock: (critical) => critical(),
  }
  const otherCfg = { ...config(otherStore), cacheKey: "other-session" }

  globalThis.fetch = (async () => {
    throw new Error("no network expected while unexpired")
  }) as typeof fetch
  expect((await getToken(otherCfg)).token).toBe("access-other") // cached in memory

  globalThis.fetch = (async () => {
    const err = new Error("The operation timed out")
    err.name = "TimeoutError"
    throw err
  }) as typeof fetch

  await expect(getToken(config(peerA.store))).rejects.toThrow(/timed out after 30s \(requestId=/)

  // The unrelated session's cached token survived: reading it makes no network call,
  // which the stub above would turn into a timeout.
  expect((await getToken(otherCfg)).token).toBe("access-other")
})

/** A store that cannot establish exclusion, the way cz-cli's reports it. */
function contendedStore(current: () => AuthToken | undefined): TokenStore {
  return {
    load: current,
    save: () => true,
    clear: () => {},
    refresh: (_previous, request) => request(),
    withLock: () =>
      Promise.reject(Object.assign(new Error("another process holds the lock"), { code: "LOCK_CONTENDED" })),
  }
}

test("losing the lock to a peer takes the peer's token instead of rotating", async () => {
  // The dangerous fallback: running the rotation anyway spends a refresh token the peer
  // may be spending right now, and every waiter surrenders at the same deadline, so it
  // arrives as a herd. A peer holding the lock is a peer doing this work — its result is
  // the first thing to try.
  //
  // The peer's write has to land BETWEEN our read and our failed acquire: seeding it
  // earlier means the pre-lock fast path answers and the contended branch is never
  // reached, which is what a first version of this test did.
  const stale = oauthToken({ obtainedAt: now - 800_000 })
  const peerResult = oauthToken({ token: "access-peer", refreshToken: "refresh-peer", obtainedAt: now })
  let reads = 0
  const sent = stubRefresh()

  const token = await getToken(config(contendedStore(() => (++reads === 1 ? stale : peerResult))))

  expect(reads).toBeGreaterThan(1) // the re-read after losing the lock happened
  expect(sent).toEqual([])
  expect(token.token).toBe("access-peer")
})

test("losing the lock with nothing usable on disk reports contention, and spends no refresh token", async () => {
  const stale = oauthToken({ obtainedAt: now - 800_000 })
  const sent = stubRefresh()

  await expect(getToken(config(contendedStore(() => stale)))).rejects.toThrow(/holds the lock/)

  // The point of the whole exercise: the refresh token was NOT spent.
  expect(sent).toEqual([])
})

test("a forced refresh with no known rejected value does not hand back the disk token", async () => {
  // `force` means the server refused what we held. Without the rejected value there is
  // nothing to compare against, so a token on disk cannot be shown to differ from it —
  // returning it walks straight back into the same 401. An earlier version of this
  // predicate was true whenever `rejected` was undefined.
  const onDisk = oauthToken({ token: "access-1", obtainedAt: now })
  const sent = stubRefresh()

  await expect(forceRefreshToken(config(contendedStore(() => onDisk)))).rejects.toThrow(/holds the lock/)
  expect(sent).toEqual([])
})

test.each(["LOCK_CONTENDED", "OAUTH_REFRESH_PENDING", "OAUTH_REFRESH_UNCERTAIN", "OAUTH_STATE_UNAVAILABLE"])(
  "%s stops the request retry loop",
  async (code) => {
    // The token source already waited its whole budget for the peer, so retrying the
    // request waits that budget again and learns nothing — MAX_RETRIES turned one bounded
    // wait into several.
    //
    // The contention has to surface from INSIDE the retry loop to test anything: the first
    // `tokens.get()` happens before the loop, so a source that throws immediately escapes
    // without the terminal-code check ever running. A first version of this test did that
    // and passed with the code removed from the terminal set.
    let gets = 0
    const source = {
      get: async () => {
        gets += 1
        if (gets === 1) return { token: "t", instanceId: 1, userId: 1 }
        throw Object.assign(new Error("held elsewhere"), { code })
      },
      rotate: async () => undefined,
    }
    // 500 is retryable, so attempt 2 re-resolves the credential and meets the contention.
    globalThis.fetch = (async () => new Response("boom", { status: 500 })) as typeof fetch

    await expect(request({ baseUrl: "https://example.invalid", tokens: source }, "GET", "/x")).rejects.toThrow(
      /held elsewhere/,
    )

    // Exactly one retry reached the contention and stopped there; retrying would have
    // called get() once per remaining attempt, each after a backoff.
    expect(gets).toBe(2)
  },
)

test("a plain login is not refused for a contended lock — there is nothing single-use at stake", async () => {
  // Exclusion protects a single-use refresh token. A pat/password login is idempotent, and
  // refusing it because a peer holds the lock regresses a path that used to just log in
  // (reachable via an `oauth` pointer whose section is gone, as `auth logout
  // --keep-profiles` leaves it).
  let logins = 0
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input))
    if (url.pathname === "/clickzetta-portal/user/loginSingle") {
      logins += 1
      return new Response(
        JSON.stringify({ code: 0, data: { token: "fresh", userId: 7, instanceId: 9, expireTimeMs: 900_000 } }),
        { status: 200 },
      )
    }
    throw new Error(`unexpected ${url.pathname}`)
  }) as typeof fetch

  const cfg = { ...config(contendedStore(() => undefined)), pat: "the-pat" }
  const token = await getToken(cfg)

  expect(logins).toBe(1)
  expect(token.token).toBe("fresh")
})

test("a login taken on the contended fallback is persisted, not kept in memory only", async () => {
  // `store.save` lives inside the withLock callback now, and this branch never reaches it.
  // Without an explicit save the login lands in memory only and every process re-logs in,
  // where before this change it was written once.
  let saved: AuthToken | undefined
  const store: TokenStore = {
    load: () => undefined,
    save: (token) => {
      saved = token
      return true
    },
    clear: () => {},
    refresh: (_previous, request) => request(),
    withLock: () => Promise.reject(Object.assign(new Error("held elsewhere"), { code: "LOCK_CONTENDED" })),
  }
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({ code: 0, data: { token: "fresh", userId: 7, instanceId: 9, expireTimeMs: 900_000 } }),
      { status: 200 },
    )) as typeof fetch

  await getToken({ ...config(store), pat: "the-pat" })

  expect(saved?.token).toBe("fresh")
})

test("forced waiters share one replacement when an unforced fetch returns their rejected token", async () => {
  // The single-flight join sits upstream of `usableAfterRejection`, so a `force` call that
  // lands while an UNFORCED fetch is in flight used to return whatever that fetch resolved
  // to — including the peer's unexpired token, which can be the very one the server just
  // refused. That is a 401 loop, reached without ever consulting the guard.
  const shared = oauthToken({ token: "access-shared", refreshToken: "refresh-shared", obtainedAt: now })
  let release: (() => void) | undefined
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  let loads = 0
  const store: TokenStore = {
    // First read (pre-lock) sees it expired, so the fetch is entered; inside the lock it
    // looks unexpired, so the unforced fetch adopts it.
    load: () => (++loads === 1 ? { ...shared, obtainedAt: now - 800_000 } : shared),
    save: () => true,
    clear: () => {},
    refresh: (_previous, request) => request(),
    withLock: async (critical) => {
      await gate
      return critical()
    },
  }
  const cfg = config(store)
  const sent = stubRefresh()

  const unforced = getToken(cfg)
  await Promise.resolve()
  // Arrives while the unforced fetch is parked inside withLock, and names the shared token
  // as the one that was rejected.
  const forced = Array.from({ length: 5 }, () => forceRefreshToken(cfg, "access-shared"))
  release!()

  expect((await unforced).token).toBe("access-shared")
  const rotated = await Promise.all(forced)
  expect(rotated.every((token) => token.token !== "access-shared")).toBe(true)
  expect(new Set(rotated.map((token) => token.token)).size).toBe(1)
  expect(sent).toEqual(["refresh-shared"])
})

test("a rotation cannot clobber a separately replaced profile token", async () => {
  // A separate login may replace the profile while a refresh is in flight. The
  // legacy projection must not overwrite it; this fake tests that projection only.
  // Actual one-time refresh claims are covered by the CLI subprocess suite.
  let current: AuthToken | undefined = oauthToken({ obtainedAt: now - 800_000 })
  const store: TokenStore = {
    load: () => current,
    save: (token, condition) => {
      if (condition && condition.expected?.token !== current?.token) return false
      current = token
      return true
    },
    clear: () => {
      current = undefined
    },
    refresh: (_previous, request) => request(),
    withLock: (critical) => critical(),
  }
  globalThis.fetch = (async () => {
    // The peer finishes its own rotation while our request is in flight.
    current = oauthToken({ token: "access-peer", refreshToken: "refresh-peer", obtainedAt: now })
    return new Response(
      JSON.stringify({
        access_token: "access-ours",
        refresh_token: "refresh-ours",
        expires_in: 900,
        token_type: "Bearer",
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    )
  }) as typeof fetch

  const token = await getToken(config(store))

  // Our write was refused, and the peer's token is what everyone now uses.
  expect(current?.token).toBe("access-peer")
  expect(token.token).toBe("access-peer")
})

test("a fresh login is written unconditionally — there is no prior token to conflict with", async () => {
  // `refreshOrLogin` falls through to a portal login when the refresh token is dead, and
  // clears the store on the way. Conditioning that write on the pre-rotation slot would
  // reject it for a conflict that does not exist, leaving the login in memory only.
  let current: AuthToken | undefined = oauthToken({ obtainedAt: now - 800_000 })
  const store: TokenStore = {
    load: () => current,
    save: (token, condition) => {
      if (condition && condition.expected?.token !== current?.token) return false
      current = token
      return true
    },
    clear: () => {},
    refresh: (_previous, request) => request(),
    withLock: (critical) => critical(),
  }
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input))
    if (url.pathname.endsWith("/oauth2/token")) {
      return new Response(JSON.stringify({ error: "invalid_grant" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      })
    }
    return new Response(
      JSON.stringify({ code: 0, data: { token: "login-access", userId: 7, instanceId: 9, expireTimeMs: 900_000 } }),
      { status: 200 },
    )
  }) as typeof fetch

  const token = await getToken({ ...config(store), pat: "the-pat" })

  expect(token.token).toBe("login-access")
  expect(current?.token).toBe("login-access")
})
