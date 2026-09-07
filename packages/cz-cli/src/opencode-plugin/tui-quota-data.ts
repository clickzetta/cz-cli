// cz_change: data source for the TUI quota indicator (see tui-quota.tsx).
//
// Two halves, from two places, on two cadences:
//
//   - cash balance, from the portal:
//     /clickzetta-portal/hornhub/account/billing/account/{accountId}, authenticated
//     with the current profile's portal token. Money moves slowly, so this is read
//     on the busy -> idle edge of a turn.
//   - token quota, from the AI gateway's own response headers: the provider publishes it
//     on the step's provider metadata, opencode carries it onto the step-finish part
//     (see UPSTREAM-PATCHES.md patch 13), and readHeaderQuota below reads it back out of
//     the TUI's state store. Nothing to poll and nothing to age — a reading is attached
//     to the assistant message that produced it.
//
// The quota half used to be a second portal call, /clickzetta-portal/user/listApiKeys.
// It was retired because the header source is strictly better for this display: it
// needs no portal token and no ownership of the key, it reports EVERY configured
// period rather than one, and it is current as of the request that just finished
// instead of whenever the last poll landed. The one thing it cannot do is answer for
// a gateway that does not send the headers (cn-shanghai-alicloud, as of 2026-09-01),
// where the token rows are simply absent and the balance row still paints.
//
// Lives in a plain .ts module (no JSX, no @opentui, no solid-js) for two reasons:
// it stays unit-testable under `bun test`, and it can be pre-bundled into a
// sibling .js for the compiled binary. A bundle carrying a second @opentui/core
// trips the platform gate and silently drops the whole plugin, so the renderer
// stays raw .tsx while everything here is bundled — same split as
// tui-title-brand.ts.
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { toServiceUrl } from "@clickzetta/sdk"
import { resolveConnectionConfig } from "../connection/config.js"
import * as Profile from "../connection/profile-context.js"
import { deriveAuthType, explicitAuthType, loadProfiles } from "../connection/profile-store.js"
// Re-exported, not redefined: tui-quota-runtime.ts publishes these to the .tsx renderer,
// and commands/ai-gateway.ts needs the same answer — see llm/clickzetta-entry.ts.
import { classifyClickzettaEntry, resolveClickzettaEntry } from "../llm/clickzetta-entry.js"
export { classifyClickzettaEntry, resolveClickzettaEntry } from "../llm/clickzetta-entry.js"
export type { ClickzettaEntryResolution } from "../llm/clickzetta-entry.js"
import type { ClickzettaQuota, ClickzettaQuotaPeriod } from "../llm/gateway-error.js"
import { profileTokenSource } from "../connection/token-source.js"

const BILLING_PATH = "/clickzetta-portal/hornhub/account/billing/account"
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

/** Quota window a virtual key is rate-limited on. The gateway's own vocabulary. */
export type QuotaPeriod = ClickzettaQuotaPeriod

export interface QuotaSnapshot {
  /** Account cash balance, in CNY. */
  cash?: number
  /** Outstanding amount owed, in CNY. Non-zero means requests are at risk. */
  owe?: number
  /**
   * Token allowance per configured period, newest reading from the gateway's
   * response headers. A key with both a lifetime and a daily cap reports both.
   */
  quotas?: ClickzettaQuota[]
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
  /** How that profile authenticates: oauth / pat / password / cookie. */
  authType?: string
  /** Account (tenant) name — NOT the user; the two differ. */
  accountName?: string
  /** Human user within the account. Resolved from the portal. */
  userName?: string
  /** Deployment environment (dev/sit/uat/prod), when the host names one. */
  env?: string
  /** Cloud region segment, for a regional host that names one instead of an env. */
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
 * Deployment environment and cloud region for a service host — two DIFFERENT
 * facts, kept apart on purpose. A `dev-api.`/`sit-api.`/`uat-api.` host or a
 * central host names an environment (`dev`/`sit`/`uat`/`prod`); a regional host
 * like `cn-shanghai-alicloud.api.clickzetta.com` names a region instead, and IS
 * production — collapsing the two into one label would print a region name
 * under a heading that invites reading it as "not prod", which is the more
 * consequential half of "am I pointed at the right lakehouse" for that host.
 * Each is undefined when the host doesn't match a recognizable shape.
 *
 * Deliberately NOT `@clickzetta/sdk`'s `detectEnv`: that function ends with an
 * unconditional `return "prod"` for anything it doesn't recognize (private
 * deployments, custom domains, `localhost`), which is a reasonable default for
 * picking a service URL shape but would be a FABRICATED fact if rendered in this
 * panel. Showing an invented "prod" for a deployment that may not be prod is
 * worse than showing nothing, so this mirrors detectEnv's pattern list but drops
 * the catch-all.
 */
function knownEnv(service: string): string | undefined {
  const host = service.replace(/^https?:\/\//, "").split("/")[0] ?? ""
  if (host.startsWith("dev-api.")) return "dev"
  if (host.startsWith("sit-api.")) return "sit"
  if (host.startsWith("uat-api.")) return "uat"
  if (host === "api.clickzetta.com" || host === "api.singdata.com") return "prod"
  return undefined
}

function knownRegion(service: string): string | undefined {
  const host = service.replace(/^https?:\/\//, "").split("/")[0] ?? ""
  const match = host.match(/^([^.]+)\.api\.(clickzetta|singdata)\.com$/)
  return match ? match[1] : undefined
}

/**
 * Which profile a session-scoped panel may speak for — the ONE place that rule lives.
 *
 * Substitute the first TOML profile only when NOTHING is pinned (`current === undefined`,
 * which Profile.current() documents as "no profile configured"). A `current` that names a
 * profile absent from the file — a stale CZ_PROFILE, a deleted default_profile — resolves to
 * undefined, because silently swapping in another row would attribute one tenant's identity,
 * and one tenant's MONEY, to a session pointed somewhere else.
 *
 * Extracted because it was stated twice, byte for byte, in readProfileInfo and
 * fetchQuotaSnapshot — and collapsing the profile walk had already dropped it from the
 * balance half once, which is exactly how a rule with a security consequence goes missing.
 */
function panelProfileName(
  current: string | undefined,
  profiles: Record<string, unknown>,
): string | undefined {
  if (current === undefined) return Object.keys(profiles)[0]
  return profiles[current] ? current : undefined
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
  // Only substitute the first TOML profile when NOTHING is pinned (current ===
  // undefined, i.e. genuinely unconfigured — Profile.current()'s own docs say to
  // treat that as "no profile configured"). A current that names a profile absent
  // from the file (stale CZ_PROFILE, deleted profile) must render nothing rather
  // than silently swap in a different tenant's identity — this panel's whole job
  // is telling the user which lakehouse they're pointed at.
  const name = panelProfileName(current, profiles)
  if (!name) return undefined
  const profile = profiles[name]!
  const str = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : undefined)
  const service = str(profile.service)
  // explicitAuthType ?? deriveAuthType is readAuthType's own body (profile-store
  // .ts), applied to the `profile` entry already in hand rather than having
  // readAuthType(name) look it up by name and re-read+re-parse profiles.toml a
  // third time in this function. Same precedence (explicit auth_type, else
  // cookie/oauth/pat/password) the rest of the CLI uses to pick a credential,
  // including the `cookie` case a hand-rolled check here would otherwise miss.
  return {
    profile: name,
    authType: explicitAuthType(profile) ?? deriveAuthType(profile),
    accountName: str(profile.account_name),
    userName: str(profile.username),
    env: service ? knownEnv(service) : undefined,
    region: service ? knownRegion(service) : undefined,
    instance: str(profile.instance),
    workspace: str(profile.workspace),
  }
}

// Resolved user names, keyed by profile. Identity does not change for the life of
// a session, so this is asked once rather than on every quota refresh.
const userNameCache = new Map<string, string>()

/** Test-only: clear the user-name cache between tests sharing a process. */
export function clearUserNameCacheForTest(): void {
  userNameCache.clear()
}

/**
 * POST getCurrentUser and pull out the login handle, or undefined on any failure
 * or an envelope that doesn't carry one.
 *
 * `name` is the login handle; `accountDisplayName` is the tenant and is already
 * covered by `accountName` elsewhere. Nothing else from this payload is used — it
 * also carries a phone number and an email, which have no place in a status panel.
 *
 * `fetchProfileUserName`'s only caller now — fetchProfileSnapshot stopped needing a user
 * name when the token half moved to response headers. The four-part envelope check (record /
 * isPortalOk / record data / string name) stays here rather than inline because that shape
 * is the portal's, not this function's, and it was written once for two callers.
 */
async function readCurrentUserName(
  baseUrl: string,
  token: string,
  signal: AbortSignal | undefined,
): Promise<string | undefined> {
  try {
    const payload = await portalRead(baseUrl, CURRENT_USER_PATH, token, { method: "POST", signal })
    if (!isRecord(payload) || !isPortalOk(payload.code) || !isRecord(payload.data)) return undefined
    const name = typeof payload.data.name === "string" ? payload.data.name.trim() : ""
    return name || undefined
  } catch (error) {
    if (signal?.aborted) throw error
    return undefined
  }
}

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
 *
 * Tagged with the profile it resolved for (not a bare string) so a caller can
 * detect a profile switch that happened while this was in flight — composing a
 * later profile's identity with an earlier profile's user name would misattribute
 * a real person to the wrong tenant, worse than the row simply being absent.
 */
export async function fetchProfileUserName(
  input: { signal?: AbortSignal } = {},
): Promise<{ profile: string; name: string } | undefined> {
  const info = readProfileInfo()
  if (!info) return undefined
  if (info.userName) return { profile: info.profile, name: info.userName }
  const cached = userNameCache.get(info.profile)
  if (cached) return { profile: info.profile, name: cached }

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
    // Resolve through the shared source so an expired token refreshes here too,
    // instead of the indicator silently going blank (this file kept its own
    // fetch for host probing and cancellation, but not its own credential).
    const credential = await profileTokenSource(config).get()
    const name = await readCurrentUserName(toServiceUrl(config.service, config.protocol), credential.token, input.signal)
    if (!name) return undefined
    userNameCache.set(info.profile, name)
    return { profile: info.profile, name }
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


/** Just enough of an assistant message and a step-finish part to find a quota reading. */
export type QuotaMessage = { role?: unknown; id?: unknown; providerID?: unknown }
export type QuotaPart = { type?: unknown; metadata?: unknown }

/**
 * The token quota the gateway last reported, read out of the TUI's own state store.
 *
 * The provider publishes it as `providerMetadata.clickzetta.quota`, opencode carries that
 * onto the step-finish part, and the part reaches this process through the same event
 * pipeline every message travels — so the reading is simply attached to the assistant
 * message that produced it. Same shape as upstream's Context section, which finds the last
 * assistant message and reads `tokens` off it
 * (packages/tui/src/feature-plugins/sidebar/context.tsx).
 *
 * Attribution needs no credential: quota is charged to the key that served the request, and
 * the message names its own `providerID`. Passing `providerID` restricts the search to the
 * provider on screen, so a reading from a model the user has since switched away from is
 * not painted under the new one.
 *
 * Newest first, and only a step that FINISHED reports — a turn aborted mid-stream has no
 * step-finish part, which is the honest answer rather than a stale one.
 */
export function readHeaderQuota(input: {
  messages: ReadonlyArray<QuotaMessage>
  parts: (messageID: string) => ReadonlyArray<QuotaPart>
  providerID?: string
}): ClickzettaQuota[] | undefined {
  for (let i = input.messages.length - 1; i >= 0; i--) {
    const message = input.messages[i]
    if (!message || message.role !== "assistant" || typeof message.id !== "string") continue
    if (input.providerID !== undefined && message.providerID !== input.providerID) continue
    const parts = input.parts(message.id)
    for (let j = parts.length - 1; j >= 0; j--) {
      const quota = quotaFromPart(parts[j])
      if (quota) return quota
    }
  }
  return undefined
}

/** `metadata.clickzetta.quota` off a step-finish part, validated: it crossed a wire as JSON. */
function quotaFromPart(part: QuotaPart | undefined): ClickzettaQuota[] | undefined {
  if (!part || part.type !== "step-finish" || !isRecord(part.metadata)) return undefined
  const clickzetta = part.metadata.clickzetta
  if (!isRecord(clickzetta) || !Array.isArray(clickzetta.quota)) return undefined
  const quotas = clickzetta.quota.filter(
    (item): item is ClickzettaQuota => isRecord(item) && typeof item.periodCode === "string",
  )
  return quotas.length > 0 ? quotas : undefined
}

// The portal is method-sensitive per endpoint, and gets them backwards from what
// the URLs suggest: `getCurrentUser` only answers to POST (GET returns error
// code 8888), while the billing account route only answers to GET (POST returns
// 8888). Callers pass the method each endpoint actually wants; the default stays
// GET so the billing read needs no change.
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
 * Deliberately narrow two ways. First, it matches only a leading label directly
 * before `api.`, so `uat-api.clickzetta.com` and `dev-api.clickzetta.com` are left
 * alone (verified still working — their label is part of `uat-api`, not a region
 * segment). Second, the root itself is pinned to `clickzetta.com`/`singdata.com` —
 * the only two measured — rather than matching ANY `<label>.api.<anything>`.
 * `service` comes from profiles.toml, which a private/enterprise deployment can
 * point at its own domain; matching unconditionally would send that profile's
 * portal token to a host the tenant never configured and may not control.
 */
export function centralPortalHost(baseUrl: string): string | undefined {
  const stripped = baseUrl.replace(/^(https?:\/\/)[a-z0-9-]+\.(api\.(?:clickzetta|singdata)\.com)(?=\/|$)/i, "$1$2")
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
 *
 * A host observed NOT to serve a given ROUTE (`unservedHost`, keyed by
 * `baseUrl + path`, not by host alone) skips straight to the central host on
 * every later call for that same route: the controller refreshes on every
 * busy→idle edge — once per agent turn — so without this a session on such a
 * profile pays double the portal requests for as long as it runs, not once
 * while the fallback is discovered. Keyed per-route rather than per-host
 * because the two routes this module reads (billing, getCurrentUser) are
 * independent endpoints — a region host observed to fail one is not proof it
 * fails the other, and a coarser host-wide key would stop asking a route that
 * host actually serves.
 *
 * Promotion requires TWO CONSECUTIVE proven business-code failures on that
 * route, never a bare transport/auth error. One such response is not enough:
 * a business code (the measured case is `8888` "未知异常", a generic
 * server-side error) is not proof the host doesn't serve the route either —
 * it's exactly what a healthy region host can answer during a backend blip.
 * A single SUCCESSFUL direct read resets the strike count before the
 * threshold is reached, so the two failures must be consecutive to count as
 * "observed" rather than merely accumulate over the session. This raises the
 * bar to promote but does not add an expiry: once the threshold is reached,
 * the route is skipped for the rest of the process exactly as a single
 * failure used to trigger, same as before — this only makes a lone transient
 * blip insufficient to cause it.
 */
const unservedHostStrikes = new Map<string, number>()
const UNSERVED_HOST_THRESHOLD = 2
const unservedHostKey = (baseUrl: string, path: string) => `${baseUrl}\n${path}`

/** Test-only: clear the unserved-host memory between tests sharing a process. */
export function clearUnservedHostForTest(): void {
  unservedHostStrikes.clear()
}

async function portalRead(
  baseUrl: string,
  path: string,
  token: string,
  opts: { method?: "GET" | "POST"; signal?: AbortSignal } = {},
): Promise<unknown> {
  const central = centralPortalHost(baseUrl)
  const routeKey = unservedHostKey(baseUrl, path)
  const skipDirect = central !== undefined && (unservedHostStrikes.get(routeKey) ?? 0) >= UNSERVED_HOST_THRESHOLD
  let firstError: unknown
  let firstPayload: unknown
  if (!central || !skipDirect) {
    try {
      const payload = await portalCall(baseUrl, path, token, opts)
      if (isRecord(payload) && isPortalOk(payload.code)) {
        // A successful direct read resets the strike count: the failures must
        // be CONSECUTIVE to count as "observed", not merely accumulate over
        // the life of the session.
        unservedHostStrikes.delete(routeKey)
        return payload
      }
      firstPayload = payload
    } catch (error) {
      if (opts.signal?.aborted) throw error
      firstError = error
    }
  }

  if (!central) {
    if (firstError) throw firstError
    return firstPayload
  }
  try {
    const payload = await portalCall(central, path, token, opts)
    if (isRecord(payload) && isPortalOk(payload.code)) {
      // Strike only on a proven business-code failure (firstPayload set), never
      // on a bare transport/auth error (firstError) — a network blip is not
      // evidence the host doesn't serve the route. A skipped direct attempt
      // (skipDirect) already carries the prior strikes forward untouched.
      if (firstPayload !== undefined) {
        unservedHostStrikes.set(routeKey, (unservedHostStrikes.get(routeKey) ?? 0) + 1)
      }
      return payload
    }
    // Neither host produced a usable answer. Prefer surfacing the ORIGINAL host's
    // result so the failure reads as the profile's own, not the fallback's — but
    // only when the first attempt actually answered with something (firstPayload
    // set). If it instead THREW (transport/auth failure a different host cannot
    // fix), that error must win: swallowing it into this unusable payload would
    // turn a rejection fetchQuotaSnapshot needs (to keep showing the last good
    // snapshot) into a resolved-but-empty one that overwrites it.
    if (firstPayload !== undefined) return firstPayload
    if (firstError) throw firstError
    return payload
  } catch (error) {
    if (opts.signal?.aborted) throw error
    if (firstError) throw firstError
    if (firstPayload !== undefined) return firstPayload
    throw error
  }
}

/**
 * Fetch the account cash balance for the current connection Profile.
 *
 * Only the balance: token quota comes from readHeaderQuota, off the gateway's own
 * response headers. That split removed a whole mechanism from this function — it
 * used to walk every locally configured Profile hunting the one whose portal knew
 * the selected virtual key, because an LLM entry and a Profile are independent
 * configuration domains and only some Profile's portal could answer for the key.
 * The headers answer for the key directly, so the balance needs exactly one
 * Profile: the current one, which is whose money it is.
 *
 * Returns undefined when the selection is a demonstrably foreign provider, so the
 * whole indicator stays out of a non-ClickZetta user's sidebar. Throws on
 * transport/auth failure so the caller can keep showing the previous value rather
 * than replacing a good reading with an error.
 *
 * The credential comes from `profileTokenSource(config).get()`, the one seam that owns
 * cache/expiry/refresh/persist — reading `access_token` out of profiles.toml directly
 * would bypass all four — good for at most an hour (the 60-minute OAuth TTL) and 401 after
 * that (fetchProfileUserName's note says the same).
 */
export async function fetchQuotaSnapshot(
  input: {
    providerID?: string
    signal?: AbortSignal
  } = {},
): Promise<QuotaSnapshot | undefined> {
  // cz_change: only a demonstrably foreign provider suppresses the whole
  // indicator. "Could not pin a ClickZetta key" must not take this exit — that
  // would silently remove the cash balance too, which does not depend on the key.
  if (classifyClickzettaEntry(input.providerID).kind === "foreign") return undefined

  const profiles = loadProfiles()
  const current = Profile.current()
  // Same policy as readProfileInfo, and for the same reason: substitute the first
  // TOML profile ONLY when nothing is pinned (genuinely unconfigured). A `current`
  // that names a profile absent from the file — stale CZ_PROFILE, or a
  // default_profile pointing at a deleted profile — must report no balance rather
  // than silently bill a DIFFERENT tenant's account to the user. The pre-header
  // version of this function got that right by a different route (it gated the
  // billing read on `name === current` in two places); collapsing the profile walk
  // dropped both gates, so it is spelled out here.
  const name = panelProfileName(current, profiles)
  if (!name) return {}

  return fetchProfileSnapshot({ name, profile: profiles[name]!, signal: input.signal })
}

async function fetchProfileSnapshot(input: {
  name: string
  profile: Record<string, unknown>
  signal?: AbortSignal
}): Promise<QuotaSnapshot> {
  const config = resolveConnectionConfig({
    profile: input.name,
    ...(typeof input.profile.service === "string" ? { service: input.profile.service } : {}),
    ...(input.profile.protocol === "http" || input.profile.protocol === "https"
      ? { protocol: input.profile.protocol }
      : {}),
    ...(typeof input.profile.instance === "string" ? { instance: input.profile.instance } : {}),
  })
  const accountId = num(input.profile.account_id)
  // No account_id means the profile cannot name whose balance to read. Report
  // nothing rather than throwing: the caller treats a rejection as "keep the last
  // good value", which for a profile that can never answer would pin a stale
  // balance from a different account forever.
  if (accountId === undefined) return {}
  const credential = await profileTokenSource(config).get()
  const payload = await portalRead(
    toServiceUrl(config.service, config.protocol),
    `${BILLING_PATH}/${accountId}`,
    credential.token,
    { signal: input.signal },
  )
  const data = isRecord(payload) && isPortalOk(payload.code) && isRecord(payload.data) ? payload.data : undefined
  const cash = num(data?.cashAmount)
  const owe = num(data?.oweAmount)
  return {
    ...(cash !== undefined ? { cash } : {}),
    ...(owe !== undefined ? { owe } : {}),
  }
}
