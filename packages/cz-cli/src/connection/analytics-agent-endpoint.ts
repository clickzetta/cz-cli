import { toServiceUrl } from "@clickzetta/sdk"

/**
 * Service base URL to Analytics Agent base URL overrides.
 *
 * Keep this separate from the region-to-service mapping: a service host and an
 * Analytics Agent host are related, but they are not interchangeable. Add a
 * complete Analytics Agent URL here when an environment does not expose the
 * conventional `/clickzetta-campaign-data` path.
 */
export const ANALYTICS_AGENT_ENDPOINTS: Record<string, string> = {
  "dev-api.clickzetta.com": "https://dev-api.clickzetta.com/clickzetta-campaign-data",
  "uat-api.clickzetta.com": "https://uat-api.clickzetta.com/clickzetta-campaign-data",
  "cn-shanghai-alicloud.api.clickzetta.com": "https://api.clickzetta.com/clickzetta-campaign-data",
  "cn-north-1-aws.api.clickzetta.com": "https://api.clickzetta.com/clickzetta-campaign-data",
  "ap-shanghai-tencentcloud.api.clickzetta.com": "https://api.clickzetta.com/clickzetta-campaign-data",
  "ap-beijing-tencentcloud.api.clickzetta.com": "https://api.clickzetta.com/clickzetta-campaign-data",
  "ap-guangzhou-tencentcloud.api.clickzetta.com": "https://api.clickzetta.com/clickzetta-campaign-data",
  "ap-southeast-1-alicloud.api.singdata.com": "https://ap-southeast-1-alicloud.api.singdata.com/clickzetta-campaign-data",
  "ap-southeast-1-aws.api.singdata.com": "https://ap-southeast-1-alicloud.api.singdata.com/clickzetta-campaign-data"
}

export function inferAnalyticsAgentEndpoint(service: string, protocol?: string): string | undefined {
  const normalized = normalizeServiceBase(service, protocol)
  if (!normalized) return undefined

  const override = ANALYTICS_AGENT_ENDPOINTS[normalized]
  if (override) return override

  return `${toServiceUrl(service, normalizeProtocol(protocol))}/clickzetta-campaign-data`
}

function normalizeServiceBase(value: string, protocol?: string): string | undefined {
  const raw = value.trim()
  if (!raw) return undefined

  try {
    const url = new URL(raw.includes("://") ? raw : `${normalizeProtocol(protocol)}://${raw}`)
    return `${url.host}${url.pathname.replace(/\/+$/, "")}`.toLowerCase()
  } catch {
    return undefined
  }
}

function normalizeProtocol(value?: string): "http" | "https" {
  return value?.toLowerCase().replace(/:\/\/$/, "") === "http" ? "http" : "https"
}
