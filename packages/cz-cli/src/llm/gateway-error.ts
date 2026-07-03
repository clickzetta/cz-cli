import { formatBillingError, isBillingError } from "../commands/billing-error.js"
import {
  isClickzettaVirtualKeyQuotaErrorDetail,
  isClickzettaFreeQuotaErrorDetail,
} from "./clickzetta-rotation.js"

/**
 * Consolidated ClickZetta AI-gateway error rewriter.
 *
 * A pure function (no AI-SDK / no opencode deps) consumed by the provider shell
 * (@clickzetta/ai-provider), which calls it when the gateway returns an error.
 *
 * Recognizes four ClickZetta-gateway conditions and rewrites each into an
 * actionable, non-retryable message:
 *   1. Billing (insufficient balance / tenant overdue) → "add funds" URL.
 *   2. API-key quota exhausted (a user-created virtual key ran out) → point to
 *      the quota top-up page.
 *   3. Free complimentary quota exhausted (the auto-provisioned `cz-code_auto_*`
 *      key) → tell the user how to create and switch to their own key.
 *   4. Generic daily-quota exhaustion (429 + "daily limit" / "quota exceeded").
 *
 * Returns `undefined` when no ClickZetta condition matches, leaving the SDK's
 * original error untouched.
 */

export const AI_GATEWAY_QUOTA_URL = "https://aitoken.clickzetta.com/apikey"

export const AI_GATEWAY_API_KEY_QUOTA_MESSAGE =
  `The current API key has run out of quota.\nPlease go to ${AI_GATEWAY_QUOTA_URL} to add quota, or configure another token service source.`

export const AI_GATEWAY_FREE_QUOTA_MESSAGE =
  "Your complimentary token quota has been exhausted.\n" +
  "Create and switch to your own API key, then send your request again:\n" +
  "  cz-cli ai-gateway key create my-key --add-to-llm my-key --use\n" +
  `Or add paid quota at ${AI_GATEWAY_QUOTA_URL}.`

export type GatewayErrorInput = {
  statusCode?: number
  message: string
  responseBody?: string
  code?: string
}

export type GatewayErrorRewrite = {
  message: string
  isRetryable: false
}

export function rewriteClickzettaGatewayError(input: GatewayErrorInput): GatewayErrorRewrite | undefined {
  const message = input.message ?? ""
  const responseBody = input.responseBody ?? ""
  const detail = [message, responseBody].filter((v) => typeof v === "string" && v).join("\n")

  const billingInput = { code: input.code, message }
  if (isBillingError(billingInput)) {
    return { message: formatBillingError(billingInput), isRetryable: false }
  }

  const is429 = input.statusCode === 429

  if (is429 && isClickzettaFreeQuotaErrorDetail(detail)) {
    return { message: AI_GATEWAY_FREE_QUOTA_MESSAGE, isRetryable: false }
  }

  if (is429 && isClickzettaVirtualKeyQuotaErrorDetail(detail) && !isClickzettaFreeQuotaErrorDetail(detail)) {
    return { message: AI_GATEWAY_API_KEY_QUOTA_MESSAGE, isRetryable: false }
  }

  // Generic daily-quota exhaustion: keep the gateway's message but stop retrying,
  // since the quota won't reset within the retry window.
  if (
    is429 &&
    (responseBody.includes("daily token limit") ||
      responseBody.includes("daily limit") ||
      responseBody.includes("quota exceeded"))
  ) {
    return { message, isRetryable: false }
  }

  return undefined
}
