// cz_change: data source for the TUI quota indicator (see tui-quota.tsx).
//
// Two portal endpoints, both authenticated with the profile's portal token:
//   - cash balance: /clickzetta-portal/hornhub/account/billing/account/{accountId}
//   - token quota:  /clickzetta-portal/user/listApiKeys?userName=<name>
//
// The quota half MUST come from the portal route, not the gateway-admin route
// (/llm-gateway-admin/v2/virtual-key/listWithAuth) that `cz-cli ai-gateway key
// list` uses: the complimentary `cz-code_auto_*` key — the one a fresh login
// actually writes into llm.json — is absent from the admin listing but present
// here. Querying the admin route would report "no key" for most users.
//
// Lives in a plain .ts module (no JSX, no @opentui, no solid-js) for two reasons:
// it stays unit-testable under `bun test`, and it can be pre-bundled into a
// sibling .js for the compiled binary. A bundle carrying a second @opentui/core
// trips the platform gate and silently drops the whole plugin, so the renderer
// stays raw .tsx while everything here is bundled — same split as
// tui-title-brand.ts.
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { detectEnv, getToken, toServiceUrl } from "@clickzetta/sdk"
import { resolveConnectionConfig } from "../connection/config.js"
import { getCookieToken } from "../connection/cookie-token.js"
import * as Profile from "../connection/profile-context.js"
import { loadProfiles, readAuthType } from "../connection/profile-store.js"
import { readLlmEntries } from "../llm/native-config.js"

const BILLING_PATH = "/clickzetta-portal/hornhub/account/billing/account"
const API_KEYS_PATH = "/clickzetta-portal/user/listApiKeys"
const CURRENT_USER_PATH = "/clickzetta-portal/user/getCurrentUser"

/**
 * Mirror the TUI's model auto-selection to learn which provider it will display
 * before any session has run.
 *
 * Token quota is charged to the key of the model actually in use, so the
 * indicator has to agree with the provider shown next to the model name. That
 * provider is frequently NOT the launch profile: with nothing pinned, the TUI
 * picks from its recent-model history and then from the first available provider
 * (see the fallbackModel memo in packages/tui/src/context/local.tsx), so a
 * `--profile B` launch can legitimately run against provider A.
 *
 * Kept pure and separate from the state-file read so the ordering is testable.
 */
export function selectDisplayedProvider(input: {
  /** `config.model`, when a model is pinned. */
  configModel?: string
  /** Recent selections, newest first, as persisted in the TUI's model.json. */
  recent?: Array<{ providerID?: unknown; modelID?: unknown }>
  /** Providers and models currently available to the TUI. */
  providers: ReadonlyArray<{ id: string; models: Readonly<Record<string, unknown>> }>
}): string | undefined {
  const valid = (providerID: unknown, modelID: unknown) => {
    if (typeof providerID !== "string" || typeof modelID !== "string") return false
    return input.providers.some((provider) => provider.id === providerID && modelID in provider.models)
  }
  const separator = input.configModel?.indexOf("/") ?? -1
  const configured = separator > 0
    ? { providerID: input.configModel!.slice(0, separator), modelID: input.configModel!.slice(separator + 1) }
    : undefined
  if (configured && valid(configured.providerID, configured.modelID)) return configured.providerID
  for (const item of input.recent ?? []) {
    if (valid(item?.providerID, item?.modelID)) return item.providerID as string
  }
  const first = input.providers[0]
  return first && Object.keys(first.models).length > 0 ? first.id : undefined
}

/**
 * Read the provider ids from the TUI's persisted recent-model list.
 * Best-effort: a missing or malformed file just means no history to consult.
 */
export function readRecentProviders(statePath: string): Array<{ providerID?: unknown; modelID?: unknown }> {
  try {
    const parsed = JSON.parse(readFileSync(join(statePath, "model.json"), "utf-8"))
    if (!isRecord(parsed) || !Array.isArray(parsed.recent)) return []
    return parsed.recent.filter(isRecord)
  } catch {
    return []
  }
}

/** Quota window a virtual key is rate-limited on. */
export type QuotaPeriod = "daily" | "weekly" | "monthly" | "total"

const RATE_LIMIT_PERIOD: Record<string, QuotaPeriod> = {
  quota_pdo: "daily",
  quota_pwo: "weekly",
  quota_pmo: "monthly",
  quota_total: "total",
}

export interface QuotaSnapshot {
  /** Account cash balance, in CNY. */
  cash?: number
  /** Outstanding amount owed, in CNY. Non-zero means requests are at risk. */
  owe?: number
  /** Tokens consumed on the active virtual key within its quota window. */
  used?: number
  /** Token ceiling for that window. */
  limit?: number
  /** Which window `used`/`limit` describe. */
  period?: QuotaPeriod
  /** Alias of the matched virtual key, for diagnostics. */
  alias?: string
}

/**
 * Who and where the session is connected as — the "am I pointed at the right
 * lakehouse" facts, shown alongside the money figures.
 *
 * Everything except `userName` comes straight out of profiles.toml, so the
 * section paints immediately and keeps working with no network at all. `userName`
 * needs a portal round-trip for OAuth profiles (their TOML block carries no
 * username), so it fills in when the snapshot lands and is simply absent until
 * then rather than blocking the rest.
 */
export interface ProfileInfo {
  /** Active profile name, i.e. what `-p` selected or default_profile. */
  profile: string
  /** How that profile authenticates: oauth / pat / password / header. */
  authType?: string
  /** Account (tenant) name — NOT the user; the two differ. */
  accountName?: string
  /** Human user within the account. Resolved from the portal. */
  userName?: string
  /** Region/deployment label parsed off the service host. */
  region?: string
  instance?: string
  workspace?: string
}

type Dict = Record<string, unknown>

function isRecord(value: unknown): value is Dict {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function num(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return undefined
}

/**
 * Read the active profile's identity and connection target from profiles.toml.
 *
 * Synchronous and network-free on purpose: this is the half of the sidebar that
 * should never be missing, so it must not depend on a portal that may be slow,
 * unreachable, or (as measured) not serving a region's host at all.
 *
 * `userName` is deliberately absent here — see fetchProfileUserName.
 */
export function readProfileInfo(): ProfileInfo | undefined {
  const current = Profile.current()
  const profiles = loadProfiles()
  const name = current && profiles[current] ? current : Object.keys(profiles)[0]
  if (!name) return undefined
  const profile = profiles[name]!
  const str = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : undefined)
  const service = str(profile.service)
  // Delegates to readAuthType rather than re-deriving from the raw fields: that is
  // the same precedence (explicit auth_type, else cookie/oauth/pat/password) the
  // rest of the CLI uses to pick a credential, including the `cookie` case a
  // hand-rolled check here would otherwise miss.
  return {
    profile: name,
    authType: readAuthType(name),
    accountName: str(profile.account_name),
    userName: str(profile.username),
    region: service ? detectEnv(service) : undefined,
    instance: str(profile.instance),
    workspace: str(profile.workspace),
  }
}

// Resolved user names, keyed by profile. Identity does not change for the life of
// a session, so this is asked once rather than on every quota refresh.
const userNameCache = new Map<string, string>()

/**
 * Resolve the human user name for the active profile.
 *
 * Only OAuth profiles need this — a password profile's TOML block already carries
 * `username`, which readProfileInfo returns directly. Separate from the quota
 * fetch on purpose: the quota path only resolves a name when it happens to need
 * one for a key lookup, and the sidebar wants it whether or not a key was pinned.
 *
 * Returns undefined rather than throwing: a missing user name should cost one
 * line of the section, never the section itself.
 */
export async function fetchProfileUserName(input: { signal?: AbortSignal } = {}): Promise<string | undefined> {
  const info = readProfileInfo()
  if (!info) return undefined
  if (info.userName) return info.userName
  const cached = userNameCache.get(info.profile)
  if (cached) return cached

  const profiles = loadProfiles()
  const profile = profiles[info.profile]
  if (!profile) return undefined
  try {
    const config = resolveConnectionConfig({
      profile: info.profile,
      ...(typeof profile.service === "string" ? { service: profile.service } : {}),
      ...(profile.protocol === "http" || profile.protocol === "https" ? { protocol: profile.protocol } : {}),
      ...(typeof profile.instance === "string" ? { instance: profile.instance } : {}),
    })
    const token = (await getCookieToken(config)) ?? (await getToken(config))
    const payload = await portalRead(toServiceUrl(config.service, config.protocol), CURRENT_USER_PATH, token.token, {
      method: "POST",
      signal: input.signal,
    })
    if (!isRecord(payload) || !isPortalOk(payload.code) || !isRecord(payload.data)) return undefined
    // `name` is the login handle; accountDisplayName is the tenant and is already
    // covered by accountName. Nothing else from this payload is displayed — it also
    // carries a phone number and an email, which have no place in a status panel.
    const name = typeof payload.data.name === "string" ? payload.data.name.trim() : ""
    if (!name) return undefined
    userNameCache.set(info.profile, name)
    return name
  } catch {
    return undefined
  }
}

// The portal is inconsistent about its success code: the production host answers
// `0`, the dev host answers `200`, and either may arrive as a string. Treat all
// four as success rather than pinning one and silently reading `data: null`.
export function isPortalOk(code: unknown): boolean {
  return code === 0 || code === "0" || code === 200 || code === "200"
}

/**
 * Mask an API key the way the portal reports it: first four and last four
 * characters around a literal `****`. Keys are 32 chars, so this is stable —
 * and it means we never send or log the plaintext key to match on.
 */
export function maskApiKey(apiKey: string): string | undefined {
  if (apiKey.length < 8) return undefined
  return `${apiKey.slice(0, 4)}****${apiKey.slice(-4)}`
}

/**
 * Pick the virtual key matching `apiKey` out of a listApiKeys payload and
 * project the fields the indicator needs.
 *
 * Exported for tests: the shape here (`vapiKeyMasked` / `rateLimitValue` /
 * `usage`, lowercase-a spelling) is the portal's, and differs from the
 * gateway-admin route's `vApiKeyMasked`, so both spellings are accepted.
 */
export function matchKeyUsage(
  payload: unknown,
  apiKey: string,
): Pick<QuotaSnapshot, "used" | "limit" | "period" | "alias"> {
  const masked = maskApiKey(apiKey)
  if (!masked || !isRecord(payload) || !Array.isArray(payload.data)) return {}
  const hit = payload.data.filter(isRecord).find((key) => (key.vapiKeyMasked ?? key.vApiKeyMasked) === masked)
  if (!hit) return {}
  const rateLimitType = typeof hit.rateLimitType === "string" ? hit.rateLimitType : undefined
  const alias = hit.vapiKeyAlias ?? hit.vApiKeyAlias
  return {
    used: num(hit.usage),
    limit: num(hit.rateLimitValue),
    period: rateLimitType ? RATE_LIMIT_PERIOD[rateLimitType] : undefined,
    alias: typeof alias === "string" ? alias : undefined,
  }
}

/**
 * Resolve which ClickZetta LLM entry the indicator should report on.
 *
 * LLM entries and connection Profiles are independent configuration domains.
 * This resolver only selects the LLM/API key; fetchQuotaSnapshot separately uses
 * Profiles as Portal credentials and never treats the entry name as a Profile.
 *
 * Candidates, most to least specific:
 *   1. `providerID` — what the TUI currently has selected, when known.
 *   2. `config.model`'s provider prefix — set by `cz-cli agent llm use`. Often
 *      absent: with no pinned model the TUI auto-selects, so this cannot be the
 *      only source or the indicator stays blank for everyone who never ran `use`.
 *   3. The sole ClickZetta entry, if there is exactly one. Unambiguous by
 *      definition; skipped when several exist rather than guessing a tenant.
 *
 * Returns undefined when nothing resolves to a ClickZetta entry (the user is on
 * anthropic/openai/…), which is the signal to render nothing at all.
 */
export function resolveClickzettaEntry(providerID?: string): { name: string; apiKey: string } | undefined {
  const resolved = classifyClickzettaEntry(providerID)
  return resolved.kind === "clickzetta" ? { name: resolved.name, apiKey: resolved.apiKey } : undefined
}

/**
 * Why this is a three-way answer and not `entry | undefined`.
 *
 * Cash balance belongs to the connection Profile; token quota belongs to the LLM
 * key. Collapsing "not a ClickZetta key" with "user is on another provider" into
 * one `undefined` made fetchQuotaSnapshot bail before it read profiles at all, so
 * ANY failure to pin an LLM entry also silently removed the cash balance — a
 * reading that never depended on the LLM entry in the first place.
 *
 *   - `clickzetta` — a specific ClickZetta key. Report balance and quota.
 *   - `foreign`    — the session is demonstrably on a non-ClickZetta provider
 *                    (anthropic/openai/…), or there is no ClickZetta entry at all.
 *                    Report nothing; a ¥ figure next to a Claude model would name
 *                    money that model is not spending. This is the case the
 *                    original `undefined` was meant for.
 *   - `ambiguous`  — this IS a ClickZetta user, but which key is in play cannot be
 *                    pinned (several entries, none selected or pinned; or the
 *                    matched entry carries no api_key). Report the balance, skip
 *                    the quota — guessing a tenant's key would misreport usage.
 */
export type ClickzettaEntryResolution =
  | { kind: "clickzetta"; name: string; apiKey: string }
  | { kind: "foreign" }
  | { kind: "ambiguous" }

export function classifyClickzettaEntry(providerID?: string): ClickzettaEntryResolution {
  const { llm, model } = readLlmEntries()
  const isClickzetta = (name: string | undefined) => (name ? llm[name]?.provider === "clickzetta" : false)
  const usable = (name: string | undefined): ClickzettaEntryResolution | undefined => {
    if (!name) return undefined
    const entry = llm[name]
    if (entry?.provider !== "clickzetta") return undefined
    // A ClickZetta entry with no key is still a ClickZetta user — quota is
    // unknowable, the balance is not.
    if (!entry.api_key) return { kind: "ambiguous" }
    return { kind: "clickzetta", name, apiKey: entry.api_key }
  }

  const selected = usable(providerID)
  if (selected) return selected

  // An explicit selection that is not a ClickZetta entry ends the search: the
  // provider may come from environment/plugin discovery and need not appear in
  // llm.json, and falling through would report the sole ClickZetta key while the
  // prompt visibly names a different provider.
  if (providerID) return { kind: "foreign" }

  const configured = typeof model === "string" && model.includes("/") ? model.slice(0, model.indexOf("/")) : undefined
  const inferred = usable(configured)
  if (inferred) return inferred

  const clickzetta = Object.entries(llm).filter(([, entry]) => entry.provider === "clickzetta" && entry.api_key)
  if (clickzetta.length === 1) {
    const [name, entry] = clickzetta[0]!
    return { kind: "clickzetta", name, apiKey: entry.api_key! }
  }
  // Several ClickZetta entries and nothing to choose between them is ambiguous,
  // not foreign — as is a pinned model naming a ClickZetta entry we could not use.
  if (clickzetta.length > 1 || isClickzetta(configured)) return { kind: "ambiguous" }
  return { kind: "foreign" }
}

// The portal is method-sensitive per endpoint, and gets them backwards from what
// the URLs suggest: `getCurrentUser` only answers to POST (GET returns error
// code 8888), while `listApiKeys` and the billing account route only answer to
// GET (POST returns 8888). Callers pass the method each endpoint actually wants;
// the default stays GET so the two read routes need no change.
async function portalCall(
  baseUrl: string,
  path: string,
  token: string,
  opts: { method?: "GET" | "POST"; signal?: AbortSignal } = {},
): Promise<unknown> {
  const method = opts.method ?? "GET"
  const response = await fetch(baseUrl + path, {
    method,
    headers: {
      "x-clickzetta-token": token,
      Accept: "application/json",
      ...(method === "POST" ? { "Content-Type": "application/json" } : {}),
    },
    ...(method === "POST" ? { body: "{}" } : {}),
    signal: opts.signal,
  })
  if (!response.ok) throw new Error(`portal ${path} returned ${response.status}`)
  return await response.json()
}

/**
 * Drop the region label from a regional API host: `<region>.api.<root>` →
 * `api.<root>`. Returns undefined when there is no region label to drop.
 *
 * Both reads here are tenant-global — a balance and a tenant's virtual keys are
 * not per-region facts — but only some hosts serve them. Measured with one
 * profile's token against three hosts:
 *
 *   ap-shanghai-tencentcloud.api.clickzetta.com  →  code 8888 "未知异常"
 *   cn-shanghai-alicloud.api.clickzetta.com      →  code 0, correct data
 *   api.clickzetta.com                           →  code 0, correct data
 *
 * So a tencentcloud-region profile could read neither figure and the indicator
 * silently showed nothing. The central host is the honest target for global data,
 * and is preferred here over pinning one region the way pinAlicloudAdminHost does
 * for the AIGW admin routes (see llm/clickzetta-rotation.ts) — that helper had to
 * name a region because it predates knowing the central host answers.
 *
 * Deliberately narrow: it matches only a leading label directly before `api.`, so
 * `uat-api.clickzetta.com` and `dev-api.clickzetta.com` are left alone (verified
 * still working — their label is part of `uat-api`, not a region segment).
 */
export function centralPortalHost(baseUrl: string): string | undefined {
  const stripped = baseUrl.replace(/^(https?:\/\/)[a-z0-9-]+\.(api\.)/i, "$1$2")
  return stripped === baseUrl ? undefined : stripped
}

/**
 * A portal read that tolerates a host which does not serve the route.
 *
 * Tries the profile's OWN host first so every environment that works today keeps
 * its exact behaviour, and only falls back to the central host when the answer is
 * unusable. Ordered this way on purpose: only two of the deployments could be
 * verified first-hand (tencentcloud and uat), so an unconditional rewrite risked
 * breaking singdata / private deployments that were untestable here. The extra
 * round-trip is spent only on the path that was already failing.
 */
async function portalRead(
  baseUrl: string,
  path: string,
  token: string,
  opts: { method?: "GET" | "POST"; signal?: AbortSignal } = {},
): Promise<unknown> {
  let firstError: unknown
  let firstPayload: unknown
  try {
    const payload = await portalCall(baseUrl, path, token, opts)
    if (isRecord(payload) && isPortalOk(payload.code)) return payload
    firstPayload = payload
  } catch (error) {
    if (opts.signal?.aborted) throw error
    firstError = error
  }

  const central = centralPortalHost(baseUrl)
  if (!central) {
    if (firstError) throw firstError
    return firstPayload
  }
  try {
    const payload = await portalCall(central, path, token, opts)
    if (isRecord(payload) && isPortalOk(payload.code)) return payload
    // Neither host produced a usable answer: surface the original host's result so
    // the failure reads as the profile's own, not the fallback's.
    return firstPayload ?? payload
  } catch (error) {
    if (opts.signal?.aborted) throw error
    if (firstError) throw firstError
    if (firstPayload !== undefined) return firstPayload
    throw error
  }
}

/**
 * Fetch balance + quota for the given provider selection without coupling the
 * selected LLM entry to a same-named connection Profile.
 *
 * Cash belongs to the current CLI Profile. Token quota belongs to the selected
 * LLM/API key; Profiles are only credentials for querying Portal, so all locally
 * available Profiles may be checked until the key is found.
 *
 * Returns undefined when the selection is not a ClickZetta entry. Throws on
 * transport/auth failure so the caller can keep showing the previous value
 * rather than replacing a good reading with an error.
 *
 * Token handling goes through the SDK's `getToken`, which owns cache/expiry/
 * refresh/persist. Reading `access_token` out of profiles.toml directly would
 * work for at most an hour (60-minute OAuth TTL) and then start 401-ing.
 */
export async function fetchQuotaSnapshot(
  input: {
    providerID?: string
    signal?: AbortSignal
  } = {},
): Promise<QuotaSnapshot | undefined> {
  // cz_change: only a demonstrably foreign provider suppresses the whole
  // indicator. "Could not pin a ClickZetta key" used to take this same exit,
  // which silently removed the cash balance too — see classifyClickzettaEntry.
  const resolved = classifyClickzettaEntry(input.providerID)
  if (resolved.kind === "foreign") return undefined
  const entry = resolved.kind === "clickzetta" ? resolved : undefined

  const profiles = loadProfiles()
  const current = Profile.current()
  const ordered =
    current && profiles[current]
      ? [current, ...Object.keys(profiles).filter((name) => name !== current)]
      : Object.keys(profiles)
  // Scanning past the current profile only ever serves the quota read (hunting the
  // profile whose portal knows this key). With no key there is nothing to hunt, and
  // continuing would be actively harmful: a later profile returns an empty-but-
  // successful snapshot, which lands in `loaded` and swallows the current profile's
  // real error — turning "the balance read failed" into a silent blank that the
  // caller cannot distinguish from "nothing to show".
  const names = entry ? ordered : ordered.slice(0, 1)
  if (names.length === 0) return {}

  const loaded: Array<{ name: string; billing: Pick<QuotaSnapshot, "cash" | "owe">; usage: Pick<QuotaSnapshot, "used" | "limit" | "period" | "alias"> }> = []
  const errors: unknown[] = []
  for (const name of names) {
    try {
      const snapshot = await fetchProfileSnapshot({
        name,
        profile: profiles[name]!,
        // No pinned key: skip the quota read entirely rather than scan profiles
        // for a key we cannot name. The balance below still resolves.
        apiKey: entry?.apiKey,
        includeBilling: name === current,
        signal: input.signal,
      })
      loaded.push({ name, ...snapshot })
      if (Object.keys(snapshot.usage).length > 0) break
    } catch (error) {
      if (input.signal?.aborted) throw error
      errors.push(error)
    }
  }
  if (loaded.length === 0) throw errors[0]

  return {
    ...(loaded.find((item) => item.name === current)?.billing ?? {}),
    ...(loaded.map((item) => item.usage).find((usage) => Object.keys(usage).length > 0) ?? {}),
  }
}

async function fetchProfileSnapshot(input: {
  name: string
  profile: Record<string, unknown>
  /** Undefined when no ClickZetta key could be pinned — billing still applies. */
  apiKey?: string
  includeBilling: boolean
  signal?: AbortSignal
}) {
  const config = resolveConnectionConfig({
    profile: input.name,
    ...(typeof input.profile.service === "string" ? { service: input.profile.service } : {}),
    ...(input.profile.protocol === "http" || input.profile.protocol === "https"
      ? { protocol: input.profile.protocol }
      : {}),
    ...(typeof input.profile.instance === "string" ? { instance: input.profile.instance } : {}),
  })
  const token = (await getCookieToken(config)) ?? (await getToken(config))
  const baseUrl = toServiceUrl(config.service, config.protocol)
  const accountId = num(input.profile.account_id)
  const profileUserName = typeof input.profile.username === "string" ? input.profile.username.trim() : ""
  const [billing, keys] = await Promise.allSettled([
    !input.includeBilling
      ? Promise.resolve(undefined)
      : accountId === undefined
        ? Promise.reject(new Error("profile has no account_id"))
        : portalRead(baseUrl, `${BILLING_PATH}/${accountId}`, token.token, { signal: input.signal }),
    (async () => {
      // No key to match against — skip the read rather than spend two portal
      // round-trips on a result nothing can consume.
      if (!input.apiKey) return undefined
      // getCurrentUser is a POST route (see portalCall). Resolving the user name
      // lets us pass it through, but listApiKeys ignores the userName value and
      // scopes to the token identity regardless, so a failed/empty lookup still
      // returns the caller's keys — fall back to an empty name rather than bail.
      let userName = profileUserName
      if (!userName) {
        try {
          const currentUser = await portalRead(baseUrl, CURRENT_USER_PATH, token.token, {
            method: "POST",
            signal: input.signal,
          })
          if (
            isRecord(currentUser) &&
            isPortalOk(currentUser.code) &&
            isRecord(currentUser.data) &&
            typeof currentUser.data.name === "string"
          ) {
            userName = currentUser.data.name
          }
        } catch (error) {
          if (input.signal?.aborted) throw error
        }
      }
      return portalRead(baseUrl, `${API_KEYS_PATH}?userName=${encodeURIComponent(userName)}`, token.token, {
        signal: input.signal,
      })
    })(),
  ])
  // Surface a failure only when nothing usable came back. With no api_key the
  // quota half resolves to undefined rather than rejecting, so this reduces to
  // "the billing read failed", which the caller reports by keeping the last value.
  if (keys.status === "rejected" && (!input.includeBilling || billing.status === "rejected")) throw keys.reason
  if (!input.apiKey && input.includeBilling && billing.status === "rejected") throw billing.reason

  const billingData =
    billing.status === "fulfilled" &&
    isRecord(billing.value) &&
    isPortalOk(billing.value.code) &&
    isRecord(billing.value.data)
      ? billing.value.data
      : undefined
  const cash = num(billingData?.cashAmount)
  const owe = num(billingData?.oweAmount)
  return {
    billing: {
      ...(cash !== undefined ? { cash } : {}),
      ...(owe !== undefined ? { owe } : {}),
    },
    usage:
      input.apiKey && keys.status === "fulfilled" && isRecord(keys.value) && isPortalOk(keys.value.code)
        ? matchKeyUsage(keys.value, input.apiKey)
        : {},
  }
}
