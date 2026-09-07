// cz_change: the connection RUNTIME state — what the active profile determines,
// resolved once and handed out whole.
//
// `resolveConnectionConfig` (config.ts) is the INPUT state: a pure merge of profiles.toml,
// the CZ_* layer and CLI arguments, with no I/O and no derivation. This module is the
// runtime state derived from it, and runtime code should see only this: `config` lives in
// a closure here with no getter, and ExecContext types its own `config` as
// `Omit<ConnectionConfig, "instanceId">` so reaching past `ctx.instanceId()` for the raw
// input cache does not compile.
//
// Why methods and not fields: a value that could not be resolved must never become a
// value. Every accessor below returns something already resolved, or the constructor threw
// — there is no field to read a zero off, and so no `?? 0` to write. It is also what lets
// the SCOPE change later without touching a single consumer.
//
// Why it exists: `instanceId` is part of every JobID, and before this module four entry
// points resolved it four different ways — getExecContext had a ladder that threw, while
// getStudioContext / getGatewayContext / getProfileAgentContext each passed a `fallbackId`
// and took whatever came back, which for an OAuth profile is 0. Nothing upstream owned
// "the id is settled", so downstream had to guess: `execInstanceId()` returned
// `config.instanceId ?? 0` and nine call sites put that into `job_id.instance_id`. A JobID
// naming instance 0 is a job the user cannot look up — a wrong answer they cannot see,
// which is worse than an error.
//
// Scope is the PROCESS today, keyed by profile + service + instance. It is meant to become
// per-session (opencode keys the active model per session, and a subagent session runs
// concurrently with its parent, so one process-wide answer cannot express two sessions on
// two tenants). Because consumers only call methods, that change stays inside this file.
import { DEFAULT_CONNECTION, getCurrentUser, toServiceUrl, type Credential, type ConnectionConfig, type TokenSource } from "@clickzetta/sdk"
import { resolveConnectionConfig, type CliArgs } from "./config.js"
import { hasCookieToken } from "./cookie-token.js"
import { resolveInstanceIdByName } from "./instance-id.js"
import * as Profile from "./profile-context.js"
import {
  numericField,
  patchProfileInstanceId,
  patchProfileUserId,
  profileStoreFingerprint,
  readProfileEntry,
} from "./profile-store.js"
import { profileTokenSource } from "./token-source.js"

export type ConnectionContext = {
  /** The profile this context was derived from — the one every consumer must report. */
  profileName(): string | undefined
  service(): string
  /** The instance NAME, i.e. what the profile spells. `instanceId()` is its numeric id. */
  instanceName(): string
  workspace(): string
  /** The resolved input snapshot used to build every client for this context. */
  config(): ConnectionConfig
  /** The authenticated token source selected for this exact snapshot. */
  token(): Promise<Credential>
  tokens(): TokenSource
  baseUrl(): string
  /** Never 0: unresolvable is an error at construction, not a value here. */
  instanceId(): number
  /**
   * Who the profile is, resolved on FIRST CALL and then memoised — not at construction.
   *
   * The asymmetry with `instanceId()` is deliberate and measured: the instance id is part of
   * every JobID, so every consumer needs it, while user and tenant are needed only by the
   * studio/AIGW surface. Resolving them eagerly put a `getCurrentUser` round trip on the SQL
   * path, which had never made that call — it needs the instance id and nothing else.
   *
   * Async because the accessors that matter at the point of use must stay sync: the nine
   * JobID sites read `instanceId()` inline, while every caller of this one is already in an
   * async function.
   */
  identity(): Promise<{ userId: number; tenantId: number; userName?: string }>
  /** Display name, resolved lazily without changing the SQL path. */
  userName(): Promise<string>
}

const cache = new Map<string, Promise<ConnectionContext>>()

/**
 * The runtime context for `args`.
 *
 * One portal round trip at most, then memoised — and the PROMISE is memoised rather than
 * the result, so two callers racing (a command and a plugin, say) share one lookup instead
 * of making two. A rejection is evicted, so the next call retries rather than replaying a
 * transient failure for the life of the process.
 */
export function connectionContext(args: Partial<CliArgs> = {}): Promise<ConnectionContext> {
  const config = resolveConnectionConfig(args)
  const profileName = args.profile ?? Profile.current()
  // Keyed on the profile STORE, not just the profile name — see profileStoreFingerprint:
  // another home is another profile universe, and profiles.toml can change under a
  // long-lived process between two turns of a session.
  // The resolved object is scoped by every input that can affect transport or request
  // routing. In particular, workspace/schema/vcluster must be part of the key now that
  // the immutable config snapshot is exposed to consumers; caching only by instance would
  // return profile A's workspace to a second session that selected another one.
  const key = JSON.stringify([
    profileStoreFingerprint(),
    profileName ?? "",
    config.service,
    config.protocol,
    config.instance,
    config.workspace,
    config.schema,
    config.vcluster,
    config.pat,
    config.username,
    config.password,
    config.customHeaders,
  ])
  const hit = cache.get(key)
  if (hit) return hit
  const pending = derive(config, profileName).catch((err) => {
    cache.delete(key)
    throw err
  })
  cache.set(key, pending)
  return pending
}

// A switch retargets everything the profile determines, so nothing resolved under the
// previous one may survive it. `set()` is the only way the active profile changes after
// startup (profile-context.ts).
Profile.onChange(() => cache.clear())

/** Test-only: drop memoised contexts between tests sharing a process. */
export function clearConnectionContextForTest(): void {
  cache.clear()
}

async function derive(config: ConnectionConfig, profileName: string | undefined): Promise<ConnectionContext> {
  // Resolved once and reused: passing `undefined` to the profile-store helpers would let
  // their writes land on `default_profile` while the config above came from
  // Profile.current(), which prefers CZ_PROFILE. With the two disagreeing, this read the
  // account id off one profile and cached it onto another.
  // A profile entry may be read ONLY when this connection is actually that profile's. A
  // caller can supply --service/--instance/--pat outright (setup, `sql --jdbc-url`, the
  // workspace tests), and `Profile.current()` still resolves to `default_profile` — so
  // reading it unconditionally attributed one connection's identity to another profile's
  // cached ids. Measured: a studio call against an explicit host answered with the default
  // profile's user and tenant.
  //
  // Matching on service AND instance, not just the instance name: the id, the account and the
  // credential are all per-(host, instance), so agreeing on one half proves nothing.
  const candidate = readProfileEntry(profileName)
  // Same HOST: enough to ask the portal with this profile's account, even when --instance,
  // CZ_INSTANCE or --jdbc-url named a different instance on it. An account is per-host.
  //
  // Compared against the profile's EFFECTIVE service, not the raw field: a profile may omit
  // `service` and take the default, and such a profile is still the one this connection came
  // from. Reading the field alone disqualified every default-service profile — measured as a
  // "not listed for this account" failure on a profile that had always worked.
  const profileService = typeof candidate?.service === "string" ? candidate.service : DEFAULT_CONNECTION.service
  const sameService = !!candidate && profileService === config.service
  // Did the instance NAME come from the profile, or from --instance / CZ_INSTANCE /
  // --jdbc-url? Only that — deliberately not the host — because it decides whether a
  // definitive "not listed" is fatal: a name the caller supplied outright contradicts
  // something explicit, while a name the profile carries can still be answered by a
  // credential that knows its own instance.
  const instanceNameFromProfile = typeof candidate?.instance === "string" && candidate.instance === config.instance

  // Same host AND instance: what it takes to treat the profile's CACHED ids as this
  // connection's identity, and to write an answer back onto it. The id, the account and the
  // credential are all per-(host, instance), so agreeing on one half proves nothing — a
  // connection can name the profile's instance on a DIFFERENT host (`--service … --instance
  // <same name>`), and the id there is not this profile's.
  const entryIsThisConnection = sameService && instanceNameFromProfile
  const entry = entryIsThisConnection ? candidate : undefined
  const tokens = profileTokenSource(config)
  const credential = await tokens.get()
  const baseUrl = toServiceUrl(config.service, config.protocol)
  // From the candidate, not `entry`: the lookup only needs the account, which is the host's.
  const accountId = (sameService ? numericField(candidate?.account_id) : undefined) ?? 0

  // Write-back needs the STRICTER test, not just the name: patchProfileInstanceId only writes
  // when absent, so one invocation that resolved an id on another host would pin the profile to
  // it permanently, with no path back.
  const nameIsProfiles = entryIsThisConnection

  let identity: Promise<{ userId: number; tenantId: number; userName?: string }> | undefined
  const resolveIdentityOnce = () => {
    identity ??= resolveUser({ config, baseUrl, tokens, entry, credentialUserId: credential.userId, accountId }).then(
      (resolved) => {
        if (nameIsProfiles && resolved.userId) patchProfileUserId(profileName, resolved.userId)
        return resolved
      },
    )
    return identity
  }
  let userName: Promise<string> | undefined
  const resolveUserName = () => {
    userName ??= resolveIdentityOnce().then(async (resolved) => {
      if (resolved.userName) return resolved.userName
      const user = await getCurrentUser(baseUrl, { tokens, customHeaders: config.customHeaders })
      return user.name
    })
    return userName
  }

  const instanceId = await resolveInstance({
    config,
    baseUrl,
    tokens,
    credentialInstanceId: credential.instanceId,
    isCookieAuth: hasCookieToken(config),
    instanceNameFromProfile,
    accountId,
    // The account id the lookup needs, asked for only if it is going to be used: cached on the
    // profile when a login recorded it, and otherwise from getCurrentUser — which is the same
    // resolution `identity()` performs, memoised, so the studio path does not pay for it twice
    // and the SQL path pays only when nothing on disk could answer.
    fetchAccountId: async () => (await resolveIdentityOnce()).tenantId,
    nameIsProfiles,
  })

  // Cache back for the next process. Writes only when the field is absent, so it can never
  // overwrite a value a login recorded — and only for the profile's OWN instance name, so an
  // --instance override cannot pin the profile to another instance's id.
  if (nameIsProfiles) patchProfileInstanceId(profileName, instanceId)

  // Consumers may keep this object for the lifetime of a session. Freeze the snapshot so
  // one command cannot silently retarget another command that shares the memoised context.
  const snapshot = Object.freeze({
    ...config,
    customHeaders: config.customHeaders ? Object.freeze({ ...config.customHeaders }) : undefined,
  })

  return {
    profileName: () => profileName,
    service: () => config.service,
    instanceName: () => config.instance,
    workspace: () => config.workspace,
    config: () => snapshot,
    token: () => Promise.resolve(credential),
    tokens: () => tokens,
    baseUrl: () => baseUrl,
    instanceId: () => instanceId,
    identity: resolveIdentityOnce,
    userName: resolveUserName,
  }
}

/**
 * Name to numeric id, in one place, with no fallback.
 *
 * The order is by AUTHORITY, not by convenience, and it ends in a throw rather than a
 * value. Every step below is a source that genuinely knows the answer for the case it
 * covers; a step that merely has *a* number is not a step.
 */
async function resolveInstance(input: {
  config: ConnectionConfig
  baseUrl: string
  tokens: ReturnType<typeof profileTokenSource>
  credentialInstanceId: number | undefined
  isCookieAuth: boolean
  instanceNameFromProfile: boolean
  accountId: number
  fetchAccountId: () => Promise<number>
  nameIsProfiles: boolean
}): Promise<number> {
  const { config } = input

  // 1. Already settled: profiles.toml's `instance_id`, --jdbc-url, or an explicit id.
  if (config.instanceId) return config.instanceId

  // 2. Cookie auth answers from the cookie itself — getCookieToken reads the id out of the
  //    token's own JWT payload (or the Instanceid header). Authoritative, because a cookie is
  //    issued FOR one instance, so it ranks above the name lookup below rather than below it.
  //
  //    The same field carries a PAT/password credential's id, which is NOT authoritative — it
  //    is that login's "default" instance and need not be the one the profile names (measured:
  //    a token holding 160812 while its profile named the instance whose id is 160813). That
  //    one waits until the lookup has had its turn, at step 4.
  if (input.isCookieAuth && input.credentialInstanceId) return input.credentialInstanceId

  // 3. Ask the portal by name. The two failure kinds are NOT the same statement and are
  //    kept apart so the throw below can say which happened: a portal that could not be
  //    reached says nothing about which instance the name belongs to, while "this account
  //    does not list it" is a definitive answer.
  let lookupError: unknown
  let notListed = false
  // A profile written before this existed carries no `account_id`; asking the portal for it is
  // what keeps such a profile working, and it is strictly better than what used to happen here
  // — a skipped lookup, then either a failure or an id from the shared OAuth section that may
  // name a different instance.
  const accountId = input.accountId || (await input.fetchAccountId().catch(() => 0))
  const resolved = accountId
    ? await resolveInstanceIdByName(input.baseUrl, input.tokens, accountId, config.instance, {
        customHeaders: config.customHeaders,
        onError: (err) => {
          lookupError = err
        },
        onNotFound: () => {
          notListed = true
        },
      })
    : undefined
  if (resolved) return resolved

  //    A definitive "not listed" contradicts a name the caller supplied — --instance,
  //    CZ_INSTANCE, --jdbc-url — and falling through to a credential's id would silently
  //    run against a DIFFERENT instance than the one named. Fatal, not a fallback.
  //
  //    A name that came from the PROFILE is not fatal here, because the credential's id can
  //    be just as definitive: cookie auth derives it from the cookie's own JWT payload, and
  //    that cookie is scoped to an instance. Failing there would discard an authoritative
  //    answer over a lookup that can also miss for reasons other than ownership — a renamed
  //    instance, or one that is not serviceId 1.
  if (notListed && !input.instanceNameFromProfile) {
    throw new Error(
      `Instance '${config.instance}' is not listed for this account on ${config.service}. ` +
        `Check the name (\`cz-cli profile list\`), or set instance_id in the profile.`,
    )
  }

  // 4. The credential's own id, for the non-cookie case: a PAT/password login response. Less
  //    authoritative than the lookup (see step 2), so it answers only once the lookup could
  //    not. An OAuth token carries none — the shared `[oauth.<id>]` section no longer stores
  //    one.
  //    Warned only when a lookup was ATTEMPTED and could not answer: a profile with no
  //    account_id to ask with is not anomalous, and warning there would put a line on every
  //    command for every such profile.
  if (input.credentialInstanceId) {
    if (lookupError) {
      process.stderr.write(
        `Warning: could not verify the instance id for '${config.instance}' ` +
          `(${lookupError instanceof Error ? lookupError.message : String(lookupError)}); ` +
          `using the credential's ${input.credentialInstanceId}, which may belong to a different instance.\n`,
      )
    }
    return input.credentialInstanceId
  }

  // 5. Nothing knew. Deliberately NO read of the legacy shared `[oauth.<id>]` section here:
  //    one login reaches many profiles on many instances, so its id is wrong for all but
  //    one of them — a warned wrong answer, which is worse than an error.
  throw new Error(
    `Could not determine the instance id for '${config.instance}'.` +
      (!accountId
        ? ` The profile has no account_id to look it up with — run \`cz-cli auth login\` to refresh it, or set instance_id in the profile.`
        : notListed
          ? ` ${config.service} does not list it for this account — check the instance name, re-run \`cz-cli auth login\`, or set instance_id in the profile.`
          : ` The lookup against ${config.service} failed${lookupError ? ` (${lookupError instanceof Error ? lookupError.message : String(lookupError)})` : ""} — this may be transient; retry, or set instance_id in the profile.`),
  )
}

/**
 * Who this profile is, in one place.
 *
 * The cached values come first for the same reason the instance id does — they save a
 * round trip and a login recorded them — and `getCurrentUser` answers when they are
 * absent. `tenantId` is the portal's `accountId`; it is a tenant-global fact, not a
 * per-instance one.
 *
 * This used to happen twice per command in the studio path: getStudioContext and
 * getGatewayContext each called getCurrentUser themselves, while getExecContext read
 * `account_id` out of profiles.toml — two ways to answer one question, which is how they
 * came to disagree about which profile they were answering for.
 */
async function resolveUser(input: {
  config: ConnectionConfig
  baseUrl: string
  tokens: ReturnType<typeof profileTokenSource>
  entry: ReturnType<typeof readProfileEntry>
  credentialUserId: number | undefined
  accountId: number
}): Promise<{ userId: number; tenantId: number; userName?: string }> {
  // Both cached: trust them and make no call. A login wrote them from this same portal, and
  // getExecContext has always resolved the instance with the cached `account_id` — so this is
  // the existing contract, not a new trust. It is also what lets a warm profile reach the SQL
  // path with no portal call at all — the studio and gateway entry points still fetch the
  // user's display NAME, which is theirs to want, not this chain's.
  //
  // Either missing: call, and prefer what the portal says over the half we had. The cache
  // never overrides a live answer — it only avoids asking.
  const cachedUser = numericField(input.entry?.user_id) ?? input.credentialUserId ?? 0
  if (cachedUser && input.accountId) return { userId: cachedUser, tenantId: input.accountId }

  const user = await getCurrentUser(input.baseUrl, {
    tokens: input.tokens,
    customHeaders: input.config.customHeaders,
  })
  const userId = cachedUser || numericField(user.id) || 0
  const tenantId = input.accountId || user.accountId
  // No fallback to 0 for either: a studio call under tenant 0 reads nothing and says
  // nothing about why, and a JobID under user 0 is not attributable.
  if (!userId) {
    throw new Error(
      `Could not determine the user id for '${input.config.service}' — run \`cz-cli auth login\` to refresh the profile.`,
    )
  }
  if (!tenantId) {
    throw new Error(
      `Could not determine the account id for '${input.config.service}' — run \`cz-cli auth login\` to refresh the profile.`,
    )
  }
  return { userId, tenantId, userName: user.name }
}
