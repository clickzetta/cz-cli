// cz-cli's seam onto @clickzetta/ai-gateway for everything that interprets the AIGW
// wire format: the error classifier this file is named for, and now the response-header
// quota reader plus its cross-process store. Prefer importing from here over reaching
// into the package directly.
//
// Not the ONLY seam: llm/clickzetta-provider.ts re-exports normalizeClickzettaGatewayUrl
// from "@clickzetta/ai-gateway/url", and callers that need the URL normalizer take it
// from there. Two seams because they are two concerns — that file owns "which provider
// package and endpoint", this one owns "what the gateway's responses mean" — but if a
// third appears, collapse them.
// Three narrow subpaths, not the root `@clickzetta/ai-gateway` barrel. The barrel's
// first import is `createOpenAICompatible` from "@ai-sdk/openai-compatible", and
// tui-quota-data.ts reaches this file from tui-quota-runtime.ts, which build.ts
// pre-bundles with no `external` — so importing the barrel here inlined the whole
// openai-compatible provider into an asset that only needs node:fs and node:crypto.
export {
  rewriteClickzettaGatewayError,
  clickzettaGatewayCode,
  isClickzettaBillingCode,
  parseGatewayBody,
  TENANT_OVER_QUOTA_MESSAGE,
  FREE_KEY_EXHAUSTED_MESSAGE,
  KEY_QUOTA_EXHAUSTED_MESSAGE,
  clickzettaKeyAlias,
  type GatewayErrorCode,
  type GatewayErrorInput,
  type GatewayErrorRewrite,
} from "@clickzetta/ai-gateway/gateway-error"

export {
  parseClickzettaQuota,
  formatClickzettaQuota,
  type ClickzettaQuota,
  type ClickzettaQuotaPeriod,
} from "@clickzetta/ai-gateway/quota"

