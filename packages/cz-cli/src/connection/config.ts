import { DEFAULT_CONNECTION, InterfaceError, type ConnectionConfig } from "@clickzetta/sdk"
import { explicitAuthType, getProfileConfig, invalidAuthType, invalidAuthTypeMessage, makeProfileTokenStore, readProfileEntry, type AuthType } from "./profile-store.js"
import { ConnectionEnv } from "./env.js"
import * as Profile from "./profile-context.js"
import { parseJdbcUrl } from "./jdbc.js"

export interface CliArgs {
  pat?: string
  username?: string
  password?: string
  service?: string
  protocol?: string
  instance?: string
  workspace?: string
  schema?: string
  vcluster?: string
  jdbcUrl?: string
  profile?: string
}

export function resolveConnectionConfig(cliArgs: Partial<CliArgs> = {}): ConnectionConfig {
  // Profile.current() is the single semantic source for "which profile is
  // active" (CZ_PROFILE, falling back to profiles.toml's default_profile) — see
  // its own docstring in profile-context.ts. This used to re-derive the CZ_PROFILE
  // half here directly and let the `default_profile` half happen only as a side
  // effect of getProfileConfig/readProfileEntry being called with `undefined`,
  // which is a second, easy-to-miss place that formula could drift from
  // Profile.current()'s (see commands/workspace.ts's history for exactly that).
  const profileName = cliArgs.profile ?? Profile.current()
  const profileCfg = getProfileConfig(profileName) ?? (profileName ? undefined : getProfileConfig())
  const ambient = ConnectionEnv.read()
  const jdbcCfg = cliArgs.jdbcUrl ? parseJdbcUrl(cliArgs.jdbcUrl) : undefined

  const cfg: ConnectionConfig = { ...DEFAULT_CONNECTION }

  // Lowest precedence first. The INHERITED layer sits below the profile on
  // purpose: those variables are this process's own expansion of a possibly
  // different profile, so a profile that omits `schema` must land on its default
  // rather than adopt what we injected for the previous one. The user's own
  // variables stay above the profile, which is the override layer they document.
  applyNonAuth(cfg, ambient.inherited)
  applyNonAuth(cfg, profileCfg)
  applyNonAuth(cfg, ambient.user)
  applyNonAuth(cfg, jdbcCfg)

  const nonAuthKeys = ["service", "protocol", "instance", "workspace", "schema", "vcluster"] as const
  for (const key of nonAuthKeys) {
    const val = cliArgs[key]
    if (val !== undefined && val !== null) {
      cfg[key] = val
    }
  }
  cfg.protocol = normalizeProtocol(cfg.protocol)

  // Auth priority: --pat > CZ_PAT > profile pat > --username/--password > JDBC > env > profile
  //
  // A profile may carry SEVERAL credentials at once (a pat AND an `oauth = "<id>"`
  // pointer AND username/password). Which one wins was previously an emergent
  // property of two independent decisions — this function setting cfg.pat, and
  // getToken() consulting config.tokenStore before fetchToken() — so a profile
  // with both a pat and a stored OAuth token silently authenticated as the OAuth
  // identity while cfg.pat sat there unused.
  //
  // `auth_type` resolves that: when set on the profile it SELECTS one credential
  // and the profile's other credential fields are ignored. It only ever arbitrates
  // between a profile's OWN fields — an explicit per-invocation credential
  // (--pat / CZ_PAT / --username+--password) still outranks it, since that is the
  // user speaking now rather than a stored preference.
  const profileEntry = readProfileEntry(profileName)
  // A present-but-invalid `auth_type` is a hard error, not a fallback. profiles.toml
  // is hand-editable, so `auth_type = "passwrod"` is a realistic typo; ignoring it
  // would silently restore the ambiguous precedence this field removes and could
  // authenticate as a different identity than the user pinned. Fail where the
  // credential is chosen — `profile list` deliberately still renders so the user can
  // see the bad value and fix it.
  const invalid = invalidAuthType(profileEntry)
  if (invalid !== undefined) {
    throw new InterfaceError(invalidAuthTypeMessage(profileName, invalid), { code: "INVALID_AUTH_TYPE" })
  }
  const pinnedAuth = explicitAuthType(profileEntry)
  // Absent `auth_type` → no pin, and every branch below behaves exactly as it did
  // before this field existed. Old profiles are untouched.
  const pinAllows = (type: AuthType) => pinnedAuth === undefined || pinnedAuth === type

  const credential = pickCredential({ cliArgs, ambient, jdbc: jdbcCfg, profile: profileCfg, pinAllows })
  if (credential.kind === "pat") cfg.pat = credential.pat
  if (credential.kind === "password") {
    cfg.username = credential.username
    cfg.password = credential.password
  }

  // Propagate customHeaders from profile (highest priority: env headers could override if needed)
  if (profileCfg?.customHeaders && Object.keys(profileCfg.customHeaders).length > 0) {
    cfg.customHeaders = { ...profileCfg.customHeaders, ...cfg.customHeaders }
  }

  // A pinned non-cookie `auth_type` must drop the Cookie header. Every
  // token-acquiring call site is hardcoded as `getCookieToken() ?? getToken()`, so
  // a lingering cookie outranks the pinned credential regardless of what cfg's
  // other fields say. This runs AFTER every merge on purpose: applyNonAuth already
  // copied the profile's headers into cfg above, so filtering only the profile's
  // copy would leave the cookie in place via cfg. Only the Cookie key goes — the
  // rest of the headers are transport config, not credentials.
  if (pinnedAuth !== undefined && pinnedAuth !== "cookie" && cfg.customHeaders) {
    const kept = Object.entries(cfg.customHeaders).filter(([key]) => key.toLowerCase() !== "cookie")
    cfg.customHeaders = kept.length > 0 ? Object.fromEntries(kept) : undefined
  }

  // Attach a profile-backed OAuth token store so callers routing through this
  // function (exec.ts, studio-context.ts) get cross-process persistence
  // (requirement 9.3, 9.7). The OAuth token represents the user's own login,
  // so the slot is keyed by INSTANCE ONLY (not pat/username): removing or
  // rotating a pat must not orphan the persisted token (requirement 9.6/11.6).
  // The store is self-keyed — the SDK calls load/save/clear on it without
  // re-deriving a key — so this key need not mirror token.ts's in-memory key.
  //
  // BUT never attach it when the caller supplied an EXPLICIT per-invocation
  // credential (--pat / CZ_PAT, or --username+--password). getToken() consults
  // the store before fetchToken(), so an attached store would return a cached
  // OAuth token and silently shadow the credential the user just passed —
  // violating the documented auth priority (--pat > CZ_PAT > …) and defeating
  // PAT rotation. Skipping the store also stops the PAT-exchanged token from
  // being persisted. Profile-level and pure-OAuth flows still attach it.
  //
  // "Explicit" is now decided by the credential's SOURCE rather than by which
  // fields happen to be set. An INHERITED credential — one we expanded into the
  // env ourselves — is not the user speaking, so it must not suppress the store:
  // treating it as explicit is what let a stale injection outrank the profile's
  // own OAuth login.
  //
  // A "flag" password credential needs one more check than that, though:
  // pickCredential enters the flag tier as soon as EITHER --username or
  // --password is set, then fills the other half from a lower tier (profile,
  // env, JDBC) — that is what makes `--username alice` against a profile-stored
  // password keep working. Tagging that result explicit on source alone would
  // suppress the token store on a credential that is only HALF the user
  // speaking now; the stored OAuth login the other half came from is exactly
  // what should stay attached. Only a pair supplied ENTIRELY by flags — or, for
  // pat, the single flag/env value — is unambiguously "not the profile's".
  //
  // Same reasoning excludes an env-sourced password PAIR: unlike CZ_PAT (a
  // single value, unambiguously the user's), CZ_USERNAME+CZ_PASSWORD have never
  // been treated as explicit here, and there is no flag-style "half from the
  // profile" case to protect for env — so credential.source === "env" is only
  // explicit for a pat.
  //
  // Keying off source has one more consequence, confirmed intentional: an
  // explicit `--username`/`--password` pair that LOSES the priority tier to a
  // profile pat (no auth_type pin) is tagged source: "profile", not "flag" —
  // pickCredential picked the profile's credential, the flags did not win.
  // Consistent with "only the credential that's actually speaking suppresses
  // the store", that profile pat still attaches the store exactly as it would
  // with no credential flag at all (see the profile-level-pat test above) —
  // the flags losing the tier means they are not the ones authenticating, so
  // they should not be the ones deciding whether a stored OAuth login stays
  // reachable either.
  const explicitCredential =
    (credential.source === "env" && credential.kind === "pat") ||
    (credential.source === "flag" &&
      (credential.kind === "pat" || Boolean(cliArgs.username && cliArgs.password)))
  // Attach the OAuth token store when the profile can carry an OAuth login:
  // either it has an instance (the common case) OR it has an `oauth = "<id>"`
  // pointer to a shared [oauth.<id>] token. The old `cfg.instance`-only gate
  // dropped the store for accounts with NO instance (userinfo instanceList
  // empty) — the token was persisted but unreadable, so a genuinely logged-in
  // user was reported as "no credentials". The OAuth token is keyed by the
  // profile pointer, not by instance, so instance must not gate it.
  //
  // A profile that pins a NON-oauth `auth_type` must not get the store either:
  // this is the half that made the ambiguity silent. cfg.pat could be set from a
  // profile pat while the store still handed getToken() a stored OAuth token,
  // which it prefers. Withholding the store is what makes `auth_type = "pat"`
  // (or "password"/"cookie") actually select that credential instead of merely
  // labelling it.
  //
  // The gate is the profile's OAuth IDENTITY — an `oauth = "<id>"` pointer (or a
  // not-yet-migrated legacy inline subtable) — never `cfg.instance`. An instance
  // says nothing about whether the user ever ran `cz-cli login`, so the old
  // `cfg.instance || hasOAuthPointer` gate attached the store to pure
  // username/password and pat profiles too. There the store had nothing to LOAD,
  // but `save` still ran: getToken persists whatever it obtained, so a plain
  // password login's JWT was written into a freshly minted `[oauth.cz<random>]`
  // section. Those sections are the accumulating junk — a non-OAuth credential's
  // token filed under an OAuth id that nothing durably owns.
  const oauthPointer = profileEntry?.oauth
  const hasOAuthPointer = typeof oauthPointer === "string" && oauthPointer.length > 0
  // Pre-migration profiles carry the token as an inline `[profiles.<n>.oauth.<k>]`
  // object. That IS an OAuth identity, so it still gets the store.
  const hasLegacyInlineOAuth =
    typeof oauthPointer === "object" && oauthPointer !== null && !Array.isArray(oauthPointer)
  if ((hasOAuthPointer || hasLegacyInlineOAuth) && !explicitCredential && pinAllows("oauth")) {
    // No oauthId passed: the store resolves the shared-token id from this
    // profile's `oauth = "<id>"` pointer (or a legacy inline subtable).
    cfg.tokenStore = makeProfileTokenStore(profileName)
    // Disambiguate the in-memory token cache per OAuth login. Without this the
    // SDK cache key collapses to `instance:` for OAuth profiles (no pat/user)
    // and collides across distinct logins on the same instance. The shared
    // [oauth.<id>] pointer is that stable identity.
    if (hasOAuthPointer) cfg.cacheKey = oauthPointer
  }

  return cfg
}

/** Where the selected credential came from, in descending precedence. */
type CredentialSource = "flag" | "env" | "profile" | "inherited" | "jdbc"

type Credential =
  | { kind: "pat"; source: CredentialSource; pat: string }
  | { kind: "password"; source: CredentialSource; username: string; password: string }
  | { kind: "none"; source: "default" }

/**
 * Choose ONE credential, as a group.
 *
 * A credential is an identity, not a bag of fields: a username from one source
 * and a password from another authenticate as nobody. The old code set
 * `cfg.pat` / `cfg.username` / `cfg.password` from independent priority chains,
 * which is how a profile's instance ended up paired with a username we had
 * injected for a different profile ("Login failed: 没有这样的用户").
 *
 * The tier order is the one this function has always had — flag pat, user's
 * `CZ_PAT`, profile pat, flag username/password, JDBC, user's `CZ_USERNAME`
 * pair, profile pair — with one tier ADDED at the bottom: a credential we
 * expanded into the environment ourselves ranks below the profile, because it is
 * OUR value rather than the user's (see connection/env.ts). This is a
 * provenance fix, not a re-litigation of flag-versus-profile.
 *
 * One precedence change DOES fall out of it, though: the old `getEnvConfig()`
 * this replaced only populated `username`/`password` at all when the env held
 * `CZ_PAT` OR a COMPLETE `CZ_USERNAME`+`CZ_PASSWORD` pair — a lone
 * `CZ_USERNAME` with no `CZ_PASSWORD` returned non-auth fields only, so
 * `envUsername` in the old flag-tier merge was empty and fell through to the
 * profile's username. `ConnectionEnv.read()` carries no such gate:
 * `ambient.user.username` is populated whenever `CZ_USERNAME` is set, whole or
 * half. So `CZ_USERNAME=envuser` (no `CZ_PASSWORD`) plus `--password p`
 * against a profile storing `username = "profileuser"` now merges to
 * `envuser`/`p` instead of falling through to `profileuser`/`p`. Accepted as
 * more consistent with this file's own documented `env > profile` layering
 * (the flag tier's username lookup already prefers `ambient.user.username`
 * over the profile at that same line), not reverted.
 */
function pickCredential(input: {
  cliArgs: Partial<CliArgs>
  ambient: ConnectionEnv.Ambient
  jdbc: Partial<ConnectionConfig> | undefined
  profile: Partial<ConnectionConfig> | undefined
  pinAllows: (type: AuthType) => boolean
}): Credential {
  if (input.cliArgs.pat) return { kind: "pat", source: "flag", pat: input.cliArgs.pat }
  if (input.ambient.user.pat) return { kind: "pat", source: "env", pat: input.ambient.user.pat }
  if (input.pinAllows("pat") && input.profile?.pat) {
    return { kind: "pat", source: "profile", pat: input.profile.pat }
  }

  // A flag that supplies only half of the pair still selects the flag tier; the
  // missing half is filled from the tiers below, which is how
  // `--username alice` against a profile that stores the password keeps working.
  if (input.cliArgs.username !== undefined || input.cliArgs.password !== undefined) {
    const username =
      input.cliArgs.username ||
      input.jdbc?.username ||
      input.ambient.user.username ||
      (input.pinAllows("password") ? input.profile?.username : undefined) ||
      input.ambient.inherited.username
    const password =
      input.cliArgs.password ||
      input.jdbc?.password ||
      input.ambient.user.password ||
      (input.pinAllows("password") ? input.profile?.password : undefined) ||
      input.ambient.inherited.password
    if (username && password) return { kind: "password", source: "flag", username, password }
  }

  if (input.jdbc?.username && input.jdbc.password) {
    return { kind: "password", source: "jdbc", username: input.jdbc.username, password: input.jdbc.password }
  }

  if (input.ambient.user.username && input.ambient.user.password) {
    return { kind: "password", source: "env", username: input.ambient.user.username, password: input.ambient.user.password }
  }

  if (input.pinAllows("password") && input.profile?.username && input.profile.password) {
    return { kind: "password", source: "profile", username: input.profile.username, password: input.profile.password }
  }

  if (input.ambient.inherited.pat) return { kind: "pat", source: "inherited", pat: input.ambient.inherited.pat }
  if (input.ambient.inherited.username && input.ambient.inherited.password) {
    return {
      kind: "password",
      source: "inherited",
      username: input.ambient.inherited.username,
      password: input.ambient.inherited.password,
    }
  }

  return { kind: "none", source: "default" }
}

function applyNonAuth(target: ConnectionConfig, src: Partial<ConnectionConfig> | undefined): void {
  if (!src) return
  if (src.service) target.service = src.service
  if (src.protocol) target.protocol = normalizeProtocol(src.protocol)
  if (src.instance) target.instance = src.instance
  if (src.workspace) target.workspace = src.workspace
  if (src.schema) target.schema = src.schema
  if (src.vcluster) target.vcluster = src.vcluster
  if (src.customHeaders && Object.keys(src.customHeaders).length > 0) {
    target.customHeaders = { ...target.customHeaders, ...src.customHeaders }
  }
}

function normalizeProtocol(value?: string): string {
  if (!value) return "https"
  const lower = value.toLowerCase().replace(/:\/\/$/, "")
  if (lower === "http") return "http"
  return "https"
}
