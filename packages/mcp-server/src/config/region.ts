/**
 * region.ts — line-by-line port of cz-mcp-server/cz_mcp/core/region_config.py
 *
 * Provides region id enumeration, alias lookup, and service URL → region
 * inference. The TS copy keeps the alias table byte-for-byte identical to
 * the Python source so CLI overrides behave the same.
 */

// region_config.py:12-38 — Region enum
export const Region = {
  DEV: "dev",
  SIT: "sit",
  UAT: "uat",
  CN_SHANGHAI_ALICLOUD: "cn-shanghai-alicloud",
  AP_SOURCE_1_ALICLOUD: "ap-southeast-1-alicloud",
  AP_SHANGHAI_TENCENTCLOUD: "ap-shanghai-tencentcloud",
  AP_BEIJING_TENCENTCLOUD: "ap-beijing-tencentcloud",
  AP_GUANGZHOU_TENCENTCLOUD: "ap-guangzhou-tencentcloud",
  AP_SOURCE_1_AWS: "ap-southeast-1-aws",
  KUAISHOU: "kuaishou",
  KUAISHOU_SGP: "kuaishou-sgp",
  GAOTU: "gaotu-ap-beijing-tencentcloud",
} as const

export type RegionId = (typeof Region)[keyof typeof Region]

// region_config.py:41-94 — alias table (entries ordered to match Python)
export const REGION_ALIASES: Record<string, string> = {
  // 测试环境
  "dev": Region.DEV,
  "sit": Region.SIT,
  "uat": Region.UAT,
  "开发": Region.DEV,
  "开发环境": Region.DEV,
  "验收": Region.UAT,
  "验收环境": Region.UAT,
  // 阿里云
  "aliyun": Region.CN_SHANGHAI_ALICLOUD,
  "阿里云": Region.CN_SHANGHAI_ALICLOUD,
  "阿里云环境": Region.CN_SHANGHAI_ALICLOUD,
  "阿里云上海": Region.CN_SHANGHAI_ALICLOUD,
  "华东2": Region.CN_SHANGHAI_ALICLOUD,
  "华东2（上海）": Region.CN_SHANGHAI_ALICLOUD,
  [Region.CN_SHANGHAI_ALICLOUD]: Region.CN_SHANGHAI_ALICLOUD,
  // 腾讯云
  "tencent": Region.AP_SHANGHAI_TENCENTCLOUD,
  "腾讯云": Region.AP_SHANGHAI_TENCENTCLOUD,
  "腾讯云环境": Region.AP_SHANGHAI_TENCENTCLOUD,
  "腾讯云上海": Region.AP_SHANGHAI_TENCENTCLOUD,
  "华东地区（上海）": Region.AP_SHANGHAI_TENCENTCLOUD,
  "腾讯云北京": Region.AP_BEIJING_TENCENTCLOUD,
  "华北地区（北京）": Region.AP_BEIJING_TENCENTCLOUD,
  "腾讯云广州": Region.AP_GUANGZHOU_TENCENTCLOUD,
  "华南地区（广州）": Region.AP_GUANGZHOU_TENCENTCLOUD,
  [Region.AP_SHANGHAI_TENCENTCLOUD]: Region.AP_SHANGHAI_TENCENTCLOUD,
  [Region.AP_BEIJING_TENCENTCLOUD]: Region.AP_BEIJING_TENCENTCLOUD,
  [Region.AP_GUANGZHOU_TENCENTCLOUD]: Region.AP_GUANGZHOU_TENCENTCLOUD,
  // AWS
  "aws新加坡": Region.AP_SOURCE_1_AWS,
  [Region.AP_SOURCE_1_AWS]: Region.AP_SOURCE_1_AWS,
  [Region.AP_SOURCE_1_ALICLOUD]: Region.AP_SOURCE_1_ALICLOUD,
  "阿里云新加坡": Region.AP_SOURCE_1_ALICLOUD,
  "亚马逊云": Region.AP_SOURCE_1_AWS,
  // 快手 — Region.KUAISHOU === "kuaishou" so the ["kuaishou"] entry
  // covers Region.KUAISHOU as well; same for KUAISHOU_SGP / GAOTU below.
  "kuaishou": Region.KUAISHOU,
  "快手": Region.KUAISHOU,
  "kuaishou-sgp": Region.KUAISHOU_SGP,
  "快手新加坡": Region.KUAISHOU_SGP,
  // 高途
  "gaotu": Region.GAOTU,
  "gaotu-ap-beijing-tencentcloud": Region.GAOTU,
  "高途": Region.GAOTU,
  "高途环境": Region.GAOTU,
}

/**
 * region_config.py:97-103 — look up an alias (case-insensitive), returning
 * `default` when the alias is unknown or empty.
 */
export function getRegionByAlias(
  alias: string | undefined | null,
  defaultValue?: string,
): string | undefined {
  if (!alias) return defaultValue
  const region = REGION_ALIASES[alias.toLowerCase()]
  if (!region) return defaultValue
  return region
}

/**
 * region_config.py:106-116 — normalise a service URL/host for comparison.
 */
function normalizeServiceHost(serviceUrl: string): string {
  if (!serviceUrl) return ""
  let value = serviceUrl.trim().toLowerCase()
  if (!value.includes("://")) {
    value = `https://${value}`
  }
  try {
    const parsed = new URL(value)
    let host = parsed.hostname || parsed.pathname
    if (host.includes("/")) host = host.split("/", 1)[0]!
    return host.trim().replace(/\/+$/, "")
  } catch {
    // URL parse failure — fall back to the raw host string
    return value.replace(/^https?:\/\//, "").split("/", 1)[0]!.trim()
  }
}

/**
 * region_config.py:119-137 — match a service URL against the region table.
 * The Python version reads cz_mcp/config/config.ini [URL]; the TS copy
 * receives the parsed table (or null to skip the lookup). When omitted it
 * returns `defaultValue` so callers can opt in to the config-backed form
 * from a separate helper.
 */
export function getRegionByServiceUrl(
  serviceUrl: string,
  urlTable?: Record<string, string> | null,
  defaultValue?: string,
): string | undefined {
  const targetHost = normalizeServiceHost(serviceUrl)
  if (!targetHost || !urlTable) return defaultValue
  for (const [regionKey, configuredUrl] of Object.entries(urlTable)) {
    const configuredHost = normalizeServiceHost(configuredUrl)
    if (configuredHost && configuredHost === targetHost) {
      return regionKey
    }
  }
  return defaultValue
}

/**
 * region_config.py:140-147 — derive a cloud provider code from a region id.
 */
export function getRegionCodeByCregionId(cregionId: string): string | undefined {
  if (!cregionId) return undefined
  if (cregionId === "dev" || cregionId === "sit" || cregionId === "uat") {
    return "alicloud"
  }
  const parts = cregionId.split("-")
  return parts.length > 0 ? parts[parts.length - 1]!.toUpperCase() : undefined
}

/**
 * region_config.py:150-162 — list all region ids.
 */
export function getAvailableRegions(): Record<string, { name: string }> {
  const out: Record<string, { name: string }> = {}
  for (const value of Object.values(Region)) {
    out[value] = { name: value }
  }
  return out
}

/**
 * region_config.py:165-209 — description text shown to LLM tool callers.
 */
export function getRegionDescription(): string {
  return [
    "The region id parameter only needs to be passed when the user explicitly requests to use or switch environments in their query.",
    " - E.g.: Could you check the failed scheduling tasks of the studio in Alibaba Cloud's Shanghai region?",
    "Region/Environment configuration. Available options(region_id: description):",
    "",
    "Test Environments:",
    "  - dev: Development environment (开发环境)",
    "  - sit: System Integration Test environment (稳定SIT测试环境)",
    "  - uat: User Acceptance Test environment (验收环境)",
    "",
    "Alibaba Cloud (阿里云):",
    "  - cn-shanghai-alicloud: 华东2（上海）Aliases: aliyun, 阿里云上海, 阿里云环境, 华东2",
    "",
    "Alibaba Cloud (阿里云新加坡):",
    "  - ap-southeast-1-alicloud: 新加坡 Aliases: 阿里云新加坡, aliyun singapore",
    "",
    "Tencent Cloud (腾讯云):",
    "  - ap-shanghai-tencentcloud: 华东地区（上海）Aliases: tencent, 腾讯云, 腾讯云环境",
    "  - ap-beijing-tencentcloud: 华北地区（北京）Aliases: 腾讯云北京, 华北地区（北京）",
    "  - ap-guangzhou-tencentcloud: 华南地区（广州）Aliases: 腾讯云广州, 华南地区（广州）",
    "",
    "AWS (亚马逊云):",
    "  - ap-southeast-1-aws: 新加坡 Aliases: aws新加坡, 亚马逊云, aws singapore",
    "",
    "Kuaishou (快手):",
    "  - kuaishou: 快手环境 Aliases: 快手, kuaishou",
    "  - kuaishou-sgp: 快手新加坡 Aliases: 快手新加坡, kuaishou-sgp",
    "",
    "Gaotu (高途):",
    "  - gaotu-ap-beijing-tencentcloud: 高途环境 Aliases: 高途, 高途环境, gaotu",
    "",
    "Usage:",
    "  You can use either the official region_id.",
    "  Examples: 'cn-shanghai-alicloud' refer to Alibaba Cloud Shanghai.",
    "",
    "Priority: If specified, this takes highest priority over header values.",
  ].join("\n")
}
