export const CLICKZETTA_PROVIDER_ID = "clickzetta"
export const CLICKZETTA_PROVIDER_NAME = "ClickZetta"
export const CLICKZETTA_PROVIDER_NPM = "@clickzetta/ai-gateway"
export const CLICKZETTA_DEFAULT_GATEWAY_URL = "https://cn-shanghai-alicloud-aimesh.api.clickzetta.com/gateway/v1"

// cz_change: the model catalog is no longer hardcoded here. ClickZetta models are
// discovered at runtime from the gateway's OpenAI-compatible `GET /v1/models`
// endpoint (see the `clickzetta` custom loader in opencode's provider.ts). The
// gateway is the single source of truth; llm.json stores connection info only.

export function isClickzettaGatewayUrl(url: string | undefined) {
  if (typeof url !== "string" || url === "") return false
  try {
    const host = new URL(url).hostname
    return host === "clickzetta.com" || host.endsWith(".clickzetta.com")
  } catch {
    return false
  }
}
