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
