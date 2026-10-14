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
  jdbc?: string
  /** Compatibility with existing programmatic callers. CLI arguments use jdbc. */
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
  // A profile the caller NAMED but that does not exist is a typo, and it used to
  // pass silently: the entry read as undefined, every field fell back to env or
  // defaults, and the user was told "Authentication required. Run cz-cli auth
  // login" — sending them to re-authenticate over a misspelled name. The
  // NO_PROFILE gate cannot catch this; it only asks whether profiles.toml has any
  // [profiles.*] at all. `profile use <name>` has always reported this correctly,
  // so the connection path now uses the same code.
  // Deliberately only the EXPLICIT argument, not Profile.current():
  //   - CZ_PROFILE is the CLI's own channel, and run-cli.ts checks it there for the
  //     commands that connect. Throwing on it here would also hit the callers that
  //     merely read a config — the TUI quota sidebar, gateway-prompt, agent-mcp,
  //     studio-context — where an inherited stale value should degrade, not throw.
  //   - a stale `default_profile` is the tool's own bookkeeping, not a user typo, and
  //     wants a different message; it stays out of scope rather than being reported
  //     as if the caller had named it.
  const requestedProfile = cliArgs.profile
  if (requestedProfile && !readProfileEntry(requestedProfile)) {
    throw new InterfaceError(
      `Profile '${requestedProfile}' not found in ~/.clickzetta/profiles.toml. Run \`cz-cli profile list\` to see the configured profiles.`,
      { code: "PROFILE_NOT_FOUND" },
    )
  }
  const profileCfg = getProfileConfig(profileName) ?? (profileName ? undefined : getProfileConfig())
  const ambient = ConnectionEnv.read()
  const overrides = resolveConnectionOverrides(cliArgs)

  const cfg: ConnectionConfig = { ...DEFAULT_CONNECTION }

  // Lowest precedence first. The INHERITED layer sits below the profile on
  // purpose: those variables are this process's own expansion of a possibly
  // different profile, so a profile that omits `schema` must land on its default
  // rather than adopt what we injected for the previous one. The user's own
  // variables stay above the profile, which is the override layer they document.
  applyNonAuth(cfg, ambient.inherited)
  applyNonAuth(cfg, profileCfg)
  applyNonAuth(cfg, ambient.user)
  applyNonAuth(cfg, overrides)
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

  const credential = pickCredential({ overrides, ambient, profile: profileCfg, pinAllows })
  if (credential.kind === "pat") cfg.pat = credential.pat
  if (credential.kind === "password") {
    cfg.username = credential.username
    cfg.password = credential.password
  }

  // Propagate customHeaders from profile (highest priority: env headers could override if needed)
  if (profileCfg?.customHeaders && Object.keys(profileCfg.customHeaders).length > 0) {
    cfg.customHeaders = { ...profileCfg.customHeaders, ...cfg.customHeaders }
  }

  // Explicit credentials include JDBC fields and user-owned env pairs (also
  // how CLI credentials reach agent children). A pair completed from the
  // profile remains profile-dependent. Only the credential that WON may
  // suppress the profile's persisted OAuth login or cookie.
  const explicitCredential =
    credential.source === "env" ||
    (credential.source === "flag" &&
      (credential.kind === "pat" || Boolean(overrides.username && overrides.password)))
  if ((explicitCredential || (pinnedAuth !== undefined && pinnedAuth !== "cookie")) && cfg.customHeaders) {
    const kept = Object.entries(cfg.customHeaders).filter(([key]) => key.toLowerCase() !== "cookie")
    cfg.customHeaders = kept.length > 0 ? Object.fromEntries(kept) : undefined
  }

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
    // Profiles sharing an OAuth store also share its stable cache identity;
    // distinct OAuth logins must not collide merely by instance name.
    if (hasOAuthPointer) cfg.cacheKey = oauthPointer
  }

  return cfg
}

/**
 * The invocation's own fields, before profile or environment defaults.
 * Share this boundary with env propagation so JDBC values retain the same
 * precedence in native handlers, execute(), and agent children.
 */
export function resolveConnectionOverrides(args: Partial<CliArgs>): Partial<ConnectionConfig> {
  if (args.jdbc !== undefined && args.jdbcUrl !== undefined && args.jdbc !== args.jdbcUrl) {
    throw new InterfaceError("Conflicting jdbc and jdbcUrl connection arguments.", { code: "INVALID_ARGUMENTS" })
  }
  const jdbc = args.jdbc ?? args.jdbcUrl
  const parsed = jdbc === undefined ? {} : parseJdbcUrl(jdbc)
  if (!parsed) {
    // Never echo the URL: it may contain a password.
    throw new InterfaceError("Invalid --jdbc. Expected jdbc:clickzetta://<instance>.<service>/<workspace>?schema=<schema>.", {
      code: "INVALID_ARGUMENTS",
    })
  }
  const overrides = { ...parsed }
  for (const key of ["service", "protocol", "instance", "workspace", "schema", "vcluster", "pat", "username", "password"] as const) {
    const value = args[key]
    // Empty connection fields are absent; credentials remain byte-for-byte.
    if (value && (key === "password" || value.trim())) overrides[key] = value
  }
  return overrides
}

/** Source of the credential selected by pickCredential. */
type CredentialSource = "flag" | "env" | "profile" | "inherited"

type Credential =
  | { kind: "pat"; source: CredentialSource; pat: string }
  | { kind: "password"; source: CredentialSource; username: string; password: string }
  | { kind: "none"; source: "default" }

/**
 * Select one credential group. Preserve PAT precedence over password auth;
 * password overrides have already merged flags over JDBC. A partial explicit
 * pair can be completed from user env or the selected profile, but inherited
 * credentials remain below the profile.
 */
function pickCredential(input: {
  overrides: Partial<ConnectionConfig>
  ambient: ConnectionEnv.Ambient
  profile: Partial<ConnectionConfig> | undefined
  pinAllows: (type: AuthType) => boolean
}): Credential {
  if (input.overrides.pat) return { kind: "pat", source: "flag", pat: input.overrides.pat }
  if (input.ambient.user.pat) return { kind: "pat", source: "env", pat: input.ambient.user.pat }
  if (input.pinAllows("pat") && input.profile?.pat) {
    return { kind: "pat", source: "profile", pat: input.profile.pat }
  }

  // A flag that supplies only half of the pair still selects the flag tier; the
  // missing half is filled from the tiers below, which is how
  // `--username alice` against a profile that stores the password keeps working.
  if (input.overrides.username !== undefined || input.overrides.password !== undefined) {
    const username =
      input.overrides.username ||
      input.ambient.user.username ||
      (input.pinAllows("password") ? input.profile?.username : undefined) ||
      input.ambient.inherited.username
    const password =
      input.overrides.password ||
      input.ambient.user.password ||
      (input.pinAllows("password") ? input.profile?.password : undefined) ||
      input.ambient.inherited.password
    if (username && password) return { kind: "password", source: "flag", username, password }
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
  if (src.service) {
    // Instance ids are scoped to a service, even when the instance name matches.
    if (src.service !== target.service) target.instanceId = undefined
    target.service = src.service
  }
  if (src.protocol) target.protocol = normalizeProtocol(src.protocol)
  if (src.instance) {
    // The id travels WITH the name. A layer that carries its own id wins; a layer that
    // names the SAME instance without one leaves the id alone; only a layer naming a
    // DIFFERENT instance clears it, because a numeric id is meaningless for another
    // instance and getExecContext must resolve the right one.
    //
    // The distinction is not academic: ConnectionEnv has no CZ_INSTANCE_ID, so an exported
    // CZ_INSTANCE arrives with instanceId undefined. Clearing unconditionally meant anyone
    // who exports CZ_INSTANCE — even naming the profile's own instance — paid a
    // serviceInstanceList round trip on every single command, forever.
    const changed = src.instance !== target.instance
    target.instance = src.instance
    if (src.instanceId !== undefined) target.instanceId = src.instanceId
    else if (changed) target.instanceId = undefined
  }
  // Deliberately no `else if (src.instanceId)`: an id without a name is not a state worth
  // carrying. Every path that reaches a job requires config.instance first (exec.ts), so the
  // id would be unusable, and the only way to produce the combination is hand-editing a
  // profile that already cannot run a command.
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
