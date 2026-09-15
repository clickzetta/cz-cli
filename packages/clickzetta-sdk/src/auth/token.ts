import type { AuthToken, ConnectionConfig, Credential, TokenSource } from "../types/index.js"
import { loginWithPat, loginWithPassword } from "./login.js"
import { refreshAccessToken } from "./oauth.js"
import { toServiceUrl } from "../config/region.js"
import { ClickZettaError, InterfaceError } from "../types/errors.js"

const EXPIRED_FACTOR = 0.8

// In-memory token cache, keyed by cacheKey(config). A Map (not a single slot)
// so distinct profiles/instances never evict or shadow each other.
const cache = new Map<string, AuthToken>()
/**
 * In-flight fetches, keyed by cacheKey(config). When multiple callers race for
 * the SAME key we coalesce them onto one login call (matches the Python
 * connector's mutex). Keying by cacheKey — not a single module global — stops a
 * concurrent fetch for profile A from handing A's token to a caller for
 * profile B (which has a different config/store/refresh token).
 */
const pendingFetches = new Map<string, Promise<AuthToken>>()

export function isTokenExpired(token: AuthToken): boolean {
  if (!token.expireTimeMs || token.expireTimeMs === 0) return false
  const elapsed = Date.now() - token.obtainedAt
  return elapsed > token.expireTimeMs * EXPIRED_FACTOR
}

// Cache identity for a config. OAuth logins carry no pat/username, so the
// legacy `instance:pat|username` key collapses to `instance:` and collides
// across distinct OAuth logins on the same instance. cz-cli supplies an
// explicit `cacheKey` (the profile's [oauth.<id>] pointer) to disambiguate;
// PAT/password configs keep the legacy key.
function cacheKey(config: ConnectionConfig): string {
  if (config.cacheKey) return `oauth:${config.cacheKey}`
  return `${config.instance}:${config.pat || config.username}`
}

/** True when the config has NO credentials to perform a fresh portal login
 *  (pure OAuth profile). Such a profile can only refresh via its refresh token;
 *  when that fails the only recovery is an interactive `cz-cli auth login`. */
function hasLoginCredentials(config: ConnectionConfig): boolean {
  return Boolean(config.pat || (config.username && config.password))
}

async function fetchToken(config: ConnectionConfig): Promise<AuthToken> {
  const baseUrl = toServiceUrl(config.service, config.protocol)
  return config.pat
    ? await loginWithPat(baseUrl, config.pat, config.instance)
    : await loginWithPassword(baseUrl, config.username, config.password, config.instance)
}

/** OAuth `error` codes that mean the refresh token itself is dead — retrying or
 *  re-fetching won't help; only an interactive re-login recovers. Distinct from
 *  transient failures (network, 5xx) which must NOT trigger a credential-less
 *  login dead-end. */
const REFRESH_TOKEN_DEAD = new Set(["invalid_grant", "invalid_token", "invalid_request"])

/** Raised when an OAuth session cannot be refreshed and there are no fallback
 *  credentials to re-login with. Carries an actionable message so callers show
 *  "run cz-cli auth login" instead of a generic AUTH_FAILED. */
function sessionExpiredError(cause?: unknown): InterfaceError {
  const detail = cause instanceof Error && cause.message ? ` (${cause.message})` : ""
  return new InterfaceError(
    `OAuth session expired and could not be refreshed${detail}. Run \`cz-cli auth login <name>\` to sign in again.`,
    { code: "SESSION_EXPIRED" },
  )
}

/**
 * Rotate an expired OAuth token via `/oauth2/token`. On success the rotated
 * refresh token replaces the old one (requirement 5.3) so the next refresh
 * uses the latest value.
 *
 * On failure the recovery depends on WHY and on whether the config has
 * credentials:
 *   - refresh token dead (invalid_grant/…) + no credentials (pure OAuth) →
 *     throw SESSION_EXPIRED telling the user to re-login. We must NOT attempt a
 *     password login with empty credentials (it wastes ~6s of retries and ends
 *     in a misleading "Login failed").
 *   - credentials present (PAT/password) → fall back to a full login (it can
 *     genuinely re-authenticate; requirement 5.4).
 *   - other failure with no credentials → propagate the store's error. A durable
 *     store marks an ambiguous exchange uncertain and must not replay it.
 * The shared tokenStore.clear() is a documented no-op, so we don't rely on it.
 */
async function refreshOrLogin(
  config: ConnectionConfig,
  previous: AuthToken,
  refreshTokenValue: string,
): Promise<{ token: AuthToken; rotated: boolean }> {
  // OAuth `/oauth2/token` is served ONLY by the issuer that minted the refresh
  // token (persisted on the token as `issuer`), NOT the region business host in
  // `config.service` — sending the refresh there returns `invalid_grant`. Fall
  // back to config.service only when issuer is absent (legacy tokens /
  // non-OAuth), preserving prior behavior.
  const baseUrl = previous.issuer
    ? toServiceUrl(previous.issuer, config.protocol)
    : toServiceUrl(config.service, config.protocol)
  try {
    const request = async (): Promise<AuthToken> => {
      const oauth = await refreshAccessToken(baseUrl, refreshTokenValue)
      return {
        token: oauth.accessToken,
        refreshToken: oauth.refreshToken ?? refreshTokenValue,
        instanceId: previous.instanceId,
        userId: previous.userId,
        expireTimeMs: oauth.expiresInMs,
        obtainedAt: Date.now(),
        // Carry the issuer forward so the NEXT rotation also targets it.
        ...(previous.issuer ? { issuer: previous.issuer } : {}),
      }
    }
    const token = config.tokenStore ? await config.tokenStore.refresh(previous, request) : await request()
    return { rotated: true, token }
  } catch (err) {
    // This connection's entry only. `clearTokenCache()` here used to evict EVERY
    // cacheKey in the process, so one slow or unreachable issuer dropped every
    // profile's cached access token in a long-lived TUI or `mcp serve` — and the new
    // request deadline makes that reachable on a merely slow network.
    cache.delete(cacheKey(config))
    config.tokenStore?.clear()
    const code = err instanceof ClickZettaError ? err.code : undefined
    const refreshDead = typeof code === "string" && REFRESH_TOKEN_DEAD.has(code)
    if (hasLoginCredentials(config)) {
      // PAT/password present → a full login can genuinely re-authenticate. `rotated: false`
      // because no refresh token was spent: this identity stands on its own.
      return { token: await fetchToken(config), rotated: false }
    }
    // Pure OAuth profile: no credentials to log in with.
    if (refreshDead) throw sessionExpiredError(err)
    // The store decides whether recovery is safe. In particular an uncertain
    // exchange must stay terminal rather than retrying its single-use grant.
    throw err
  }
}

export async function getToken(config: ConnectionConfig): Promise<AuthToken> {
  return acquireToken(config, false)
}

/**
 * Drop this config's cached token and obtain a fresh one, bypassing BOTH the
 * in-memory cache and the "unexpired persisted token" shortcut. Used by the 401
 * retry path (client.ts) and exec's retry: the server just rejected a token the
 * client still considers valid (early revocation, clock skew), so reusing a
 * not-yet-expired persisted token would hand back the same rejected value and
 * loop. `force` drives the rotate/login path instead. Concurrent callers for
 * the same key are still coalesced.
 */
export async function forceRefreshToken(
  config: ConnectionConfig,
  /**
   * The token value the server rejected. Inside the lock it is the only way to tell
   * "a peer already rotated, take its token" from "the token on disk is the very one
   * that just failed" — so the caller that HAS it passes it, rather than this
   * function recovering it from cache state and quietly depending on that caller
   * having populated the cache first.
   */
  rejected?: string,
): Promise<AuthToken> {
  const key = cacheKey(config)
  const rejectedToken = rejected ?? cache.get(key)?.token
  cache.delete(key)
  return acquireToken(config, true, rejectedToken)
}

async function acquireToken(config: ConnectionConfig, force: boolean, rejected?: string): Promise<AuthToken> {
  const key = cacheKey(config)
  if (!force) {
    const cached = cache.get(key)
    if (cached && !isTokenExpired(cached)) return cached
  }
  for (;;) {
    const inflight = pendingFetches.get(key)
    if (!inflight) break
    const joined = await inflight
    if (!force || rejected === undefined || joined.token !== rejected) return joined
    // Another forced waiter may have started the replacement while we awaited
    // the same unforced fetch. Join that replacement instead of spawning one each.
  }

  // Reaching here means any in-memory token for this key is expired/absent (or
  // a forced refresh). A persisted token (requirement 9) decides what happens
  // next: an unexpired persisted token is reused with no network call
  // (requirement 9.3) — UNLESS forced, in which case we always rotate so a
  // server-rejected-but-not-yet-expired token can't be handed back. An expired
  // one with a refresh token feeds the refresh path (requirement 9.4).
  const store = config.tokenStore
  let candidate = !force ? cache.get(key) : undefined
  // DISK WINS over an expired in-memory copy. The memory cache is a fast path for
  // an unexpired access token and nothing more; the refresh token must come from
  // the store, because a peer process may have rotated it since this process last
  // looked, and rotating an already-rotated refresh token is what the server
  // answers with `invalid_grant`. Reading the store only when memory was empty is
  // exactly the bug: a long-lived process (an agent session, `mcp serve`) held its
  // own stale copy for as long as it ran and refreshed from that.
  if (store) {
    const loaded = store.load()
    if (loaded) {
      if (!force && !isTokenExpired(loaded)) {
        cache.set(key, loaded)
        return loaded
      }
      candidate = refreshSource(loaded, candidate)
    }
  }
  const fetch = (async () => {
    const token = store
      ? await rotateExclusively(config, store, key, force, rejected, candidate)
      : (await rotate(config, candidate)).token
    cache.set(key, token)
    return token
  })()
  pendingFetches.set(key, fetch)
  try {
    return await fetch
  } finally {
    if (pendingFetches.get(key) === fetch) pendingFetches.delete(key)
  }
}

/**
 * Storage contention is reported by code so the SDK stays independent of the
 * CLI's SQLite implementation.
 */
function isLockContended(err: unknown): boolean {
  return (err as { code?: unknown } | undefined)?.code === "LOCK_CONTENDED"
}

/** Coalesce local work; the store owns durable cross-process refresh admission. */
async function rotateExclusively(
  config: ConnectionConfig,
  store: NonNullable<ConnectionConfig["tokenStore"]>,
  key: string,
  force: boolean,
  rejected: string | undefined,
  candidate: AuthToken | undefined,
): Promise<AuthToken> {
  try {
    return await store.withLock(async () => {
      const outcome = await rotateUnderLock(config, store, key, force, rejected, candidate)
      // An adopted token is already on disk, by definition; rewriting it would only
      // churn the file.
      if (outcome.adopted) return outcome.token
      // The refresh store has already persisted a rotated result. This write is
      // its legacy profile projection, conditional so it cannot replace a new login.
      const condition = outcome.from ? { expected: outcome.from } : undefined
      if (store.save(outcome.token, condition)) return outcome.token
      const peer = store.load()
      if (peer && !isTokenExpired(peer) && usableAfterRejection(peer, force, rejected)) {
        cache.set(key, peer)
        return peer
      }
      throw new InterfaceError("Could not persist the OAuth credentials. Check the profile store before retrying.", {
        code: "OAUTH_STATE_UNAVAILABLE",
      })
    })
  } catch (err) {
    if (!isLockContended(err)) throw err
    const fresh = store.load()
    // The same predicate `rotateUnderLock` uses, deliberately rather than incidentally:
    // with `force` and no known rejected value there is nothing to compare against, so a
    // token on disk cannot be shown to differ from the one the server just refused —
    // returning it would walk straight back into the same 401. An earlier version wrote
    // `!force || fresh.token !== rejected`, which is true whenever `rejected` is
    // undefined and would have done exactly that.
    if (fresh && !isTokenExpired(fresh) && usableAfterRejection(fresh, force, rejected)) {
      cache.set(key, fresh)
      return fresh
    }
    // Exclusion is about not spending a single-use credential twice. With no refresh
    // token to spend, the critical section is a plain portal login — idempotent, nothing
    // at stake — so refusing it because a peer holds the lock would fail a path that
    // previously just logged in. Reachable with a pat or password behind an `oauth`
    // pointer whose section is gone, which is what `auth logout --keep-profiles` leaves.
    const source = refreshSource(fresh, candidate)
    if (!source?.refreshToken) {
      const { token } = await rotate(config, source)
      // Persisted here too. `store.save` moved inside the withLock callback, which this
      // branch never reached — so without this the login lands in memory only and every
      // process re-logs in, where before this change it was written once.
      if (!store.save(token))
        throw new InterfaceError("Could not persist the login credentials.", { code: "OAUTH_STATE_UNAVAILABLE" })
      return token
    }
    throw err
  }
}

/**
 * The refresh critical section: everything here runs while THIS process holds the
 * local queue. Cross-process exclusion of single-use refresh tokens is enforced
 * by TokenStore.refresh's durable claim, including after process crashes.
 *
 * It re-reads the store first, because the wait for the lock is precisely the
 * window in which a peer may have finished its own rotation. When it has, its
 * result is taken and no network call happens at all — which is what turns N
 * concurrent cz-cli processes into one rotation instead of N competing ones, each
 * invalidating the next one's refresh token.
 *
 * `adopted` distinguishes a token taken from the store from one this process
 * minted, so the caller knows whether there is anything to persist.
 */
async function rotateUnderLock(
  config: ConnectionConfig,
  store: NonNullable<ConnectionConfig["tokenStore"]>,
  key: string,
  force: boolean,
  rejected: string | undefined,
  candidate: AuthToken | undefined,
): Promise<{ token: AuthToken; adopted: boolean; from?: AuthToken }> {
  const fresh = store.load()
  if (fresh && !isTokenExpired(fresh)) {
    // Unforced: an unexpired token on disk is simply the answer.
    // Forced: only if it is NOT the token the server just rejected — otherwise a
    // peer's untouched token would be handed straight back into the same 401.
    if (usableAfterRejection(fresh, force, rejected)) {
      cache.set(key, fresh)
      return { token: fresh, adopted: true }
    }
  }
  // `from` is what was on disk when this rotation began — the compare value for the
  // conditional save. Deliberately the STORE's copy, not `candidate`: the condition asks
  // whether the slot has moved since we looked at it.
  //
  // Only when a refresh token was actually spent. A fall-through to a full portal login
  // (`refreshOrLogin` with credentials present, or a legacy token without a refresh
  // token) mints an independent identity. The real store's clear() is a no-op, so
  // comparing against an empty slot would reject that new login.
  const source = refreshSource(fresh, candidate)
  const outcome = await rotate(config, source)
  return outcome.rotated
    ? { token: outcome.token, adopted: false, from: fresh }
    : { token: outcome.token, adopted: false }
}

/**
 * May a token found in the store be handed back as-is?
 *
 * Unforced: yes — an unexpired token is simply the answer. Forced: only when it can be
 * SHOWN to differ from the one the server rejected, which needs that value; without it,
 * handing the disk token back risks returning the very token that just 401'd.
 */
function usableAfterRejection(fresh: AuthToken, force: boolean, rejected: string | undefined): boolean {
  return !force || (rejected !== undefined && fresh.token !== rejected)
}

/**
 * Which copy supplies the refresh token.
 *
 * "Disk wins" is about the refresh token specifically, not about the whole record:
 * the store's value is newer than anything this process holds, and spending an
 * already-rotated one is what a reuse-detecting server answers by killing the whole
 * token family. But a section written by an older version can parse into a perfectly
 * valid `AuthToken` with NO `refreshToken` (`refresh_token` is optional in
 * `parseOAuthEntry`). Preferring it unconditionally would discard a usable refresh
 * token held in memory and fall through to a full login — on a pure-OAuth profile
 * that is `loginWithPassword` with empty credentials, the ~6 s of retries ending in
 * a misleading "Login failed" that `refreshOrLogin` exists to avoid.
 *
 * So: the store's copy, unless it cannot rotate and the other one can.
 */
function refreshSource(fromStore: AuthToken | undefined, inMemory: AuthToken | undefined): AuthToken | undefined {
  if (fromStore?.refreshToken) return fromStore
  if (inMemory?.refreshToken) return inMemory
  return fromStore ?? inMemory
}

/**
 * Rotate via the refresh token when there is one (requirement 5.1); legacy tokens
 * without one always re-login (requirement 5.5).
 */
async function rotate(
  config: ConnectionConfig,
  candidate: AuthToken | undefined,
): Promise<{ token: AuthToken; rotated: boolean }> {
  if (!candidate?.refreshToken) return { token: await fetchToken(config), rotated: false }
  // Whether a refresh token was actually SPENT has to come from here rather than from the
  // input: `refreshOrLogin` may fall through to a full portal login when the refresh token
  // is dead, and it clears the store on the way. A conditional write is only right for the
  // rotation case — conditioning a fresh login on the pre-rotation slot rejects a write
  // that has nothing to conflict with, and the login would survive in memory only.
  return refreshOrLogin(config, candidate, candidate.refreshToken)
}

/**
 * The standard source: an OAuth/PAT/password connection whose token is cached,
 * refreshed proactively when stale, and rotated on demand. `get`/`rotate` are
 * the existing `getToken`/`forceRefreshToken` engine — single-flight and
 * persistence come with them.
 */
/**
 * Whether this connection has anything to authenticate or rotate WITH: a persisted
 * token to refresh, or credentials to log in with. False means every recovery path
 * would drive a login with empty values — ~6 s of retries ending in a misleading
 * "Login failed" that hides the error the server actually sent.
 *
 * An `oauth = "<id>"` pointer attaches a store whether or not its `[oauth.<id>]`
 * section still exists, so the store is asked for a token rather than for its
 * existence. Exported because callers outside the transport (a command deciding
 * whether a 401 is worth retrying) need the same answer, and a second copy of this
 * predicate is exactly what drifts.
 */
export function isRotatable(config: ConnectionConfig): boolean {
  return Boolean(config.tokenStore?.load()) || hasLoginCredentials(config)
}

export function connectionTokenSource(config: ConnectionConfig): TokenSource {
  return {
    async get(): Promise<Credential> {
      return toCredential(await getToken(config))
    },
    async rotate(rejected: Credential): Promise<Credential | undefined> {
      if (!isRotatable(config)) return undefined
      // A concurrent request may already have rotated this connection while this
      // one was in flight; its 401 is then about a credential we have already
      // replaced. Hand back the current one instead of rotating again, so N
      // parallel requests cost one rotation rather than N.
      const current = toCredential(await getToken(config))
      if (current.token !== rejected.token) return current
      // Throws SESSION_EXPIRED when the refresh token is dead and there are no
      // credentials to fall back on — a terminal answer, not a missing path.
      return toCredential(await forceRefreshToken(config, rejected.token))
    },
  }
}

/**
 * A credential supplied verbatim by the caller: a token minted moments ago by a
 * login flow, a profile `[agent]` block, or a cookie session. There is no
 * rotation path, so `rotate` reports that rather than pretending — which is how
 * "this identity cannot self-heal" is expressed now that no request carries a
 * flag for it.
 */
export function staticTokenSource(credential: Credential): TokenSource {
  return {
    get: async () => credential,
    rotate: async () => undefined,
  }
}

/** Unauthenticated endpoint (health probes, public metadata). */
export function anonymous(): TokenSource {
  return staticTokenSource({ token: "", instanceId: 0, userId: 0 })
}

function toCredential(token: AuthToken): Credential {
  // 0 when the token carries none: the connection is the authoritative source now (see
  // ConnectionConfig.instanceId), and a Credential's copy is only a convenience for the
  // standalone-SDK login path that still has one.
  return { token: token.token, instanceId: token.instanceId ?? 0, userId: token.userId }
}

export function clearTokenCache(): void {
  cache.clear()
}
