// cz_change: AI-gateway host/URL resolution for ClickZetta profiles.
//
// Extracted from the former llm/clickzetta-rotation.ts when the automatic
// free-quota key rotation was removed. Only the host-resolution halves survived
// — they were never rotation-specific: `ai-gateway.ts` needs pinAlicloudAdminHost
// for every virtual-key admin call, and inferAiGatewayUrl derives a gateway URL
// for profiles that predate `aimeshEndpointBaseUrl`.
//
// Quota-exhaustion *detection* lives in @clickzetta/clickzetta-ai-gateway's
// gateway-error.ts, which carries its own copies of the alias/regex helpers and
// turns a 429 into an actionable message. Nothing here fires network calls.

/**
 * Derive an AI-gateway base URL from a profile's service host, for profiles
 * without an explicit `aimeshEndpointBaseUrl`. Returns undefined when the host
 * maps to no known gateway, which callers treat as "not a ClickZetta gateway".
 */
export function inferAiGatewayUrl(profile: { service?: string; instance?: string }): string | undefined {
  if (!profile.service) return undefined
  const base = profile.service.replace(/\/+$/, "")
  if (/\/gateway(\/|$)/.test(base)) return base
  const host = base.replace(/^https?:\/\//, "").split("/")[0] ?? ""
  if (host.startsWith("uat-")) return "https://uat-aimesh.clickzetta.com"
  if (host.startsWith("dev-") || host.startsWith("localhost") || host.startsWith("0.0.0.0"))
    return "https://dev-aimesh.clickzetta.com"
  if (host.endsWith("singdata.com")) return "https://ap-southeast-1-aws-aimesh.api.singdata.com"
  if (host.endsWith("clickzetta-inc.com") || host.endsWith("kuaishou.com")) return base
  if (host.endsWith("clickzetta.com") && !host.includes(".api.clickzetta.com")) return base
  if (host.endsWith("clickzetta.com")) return "https://cn-shanghai-alicloud-aimesh.api.clickzetta.com"
  return undefined
}

/**
 * The AIGW virtual-key admin routes (`/llm-gateway-admin/*`) are only served
 * by the Shanghai alicloud portal host — other alicloud regions (e.g. Beijing
 * `cn-beijing-alicloud.api.clickzetta.com`) return 404 "Can not find suitable
 * response". Virtual keys themselves are tenant-global, so for any
 * `cn-<region>-alicloud.api.clickzetta.com` host we pin admin calls to the
 * Shanghai host regardless of region. Non-alicloud hosts are left untouched.
 */
export function pinAlicloudAdminHost(baseUrl: string): string {
  return baseUrl.replace(
    /^(https?:\/\/)cn-[^.]+-alicloud\.api\.clickzetta\.com/,
    "$1cn-shanghai-alicloud.api.clickzetta.com",
  )
}

/** The one admin host inside the mainland `clickzetta.com` partition. */
const CN_ADMIN_HOST = "cn-shanghai-alicloud.api.clickzetta.com"

/**
 * The host to send AIGW virtual-key admin calls to.
 *
 * Broader than {@link pinAlicloudAdminHost}: that one only rewrites
 * `cn-*-alicloud` hosts, so a **tencentcloud** profile sailed through untouched
 * and the admin route answered "Can not find healthy upstream" — verified against
 * the live gateway, where `ap-shanghai-tencentcloud.api.clickzetta.com` fails and
 * `cn-shanghai-alicloud.api.clickzetta.com` returns the key id for the same token.
 * Virtual keys are tenant-global, so redirecting across regions is safe.
 *
 * Scoped to the mainland partition on purpose. Every other partition
 * (`singdata.com` intl, `clickzetta-inc.com`, dev/uat/localhost) keeps its own
 * host: rewriting those to a `clickzetta.com` host would cross a partition
 * boundary, where the token is not even valid. Their admin routes are left as-is,
 * which is the pre-existing behavior — this function does not claim to fix them.
 */
export function aigwAdminHost(baseUrl: string): string {
  const host = baseUrl.replace(/^https?:\/\//, "").split("/")[0] ?? ""
  // Leave non-production hosts alone: dev/uat/local portals serve their own admin
  // routes, and there is no mainland-production equivalent to redirect them to.
  if (/^(dev-|uat-|localhost|0\.0\.0\.0|127\.0\.0\.1)/.test(host)) return baseUrl
  if (!host.endsWith(".clickzetta.com")) return baseUrl
  return baseUrl.replace(/^(https?:\/\/)[^/]+/, `$1${CN_ADMIN_HOST}`)
}
