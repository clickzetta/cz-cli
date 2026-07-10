const INSUFFICIENT_BALANCE_CODE = "CZLH-60029"
const GATEWAY_BILLING_CODES = new Set(["GATEWAY_TENANT_OVERDUE", "GATEWAY_TENANT_OVER_QUOTA"])
const INSUFFICIENT_BALANCE_RE = /insufficient account balance|overdue payments|job submission is currently restricted/i
const GATEWAY_BILLING_RE = /\[G2\]\s*Tenant (?:overdue|over quota)\b|Tenant (?:overdue|over quota)\b|GATEWAY_TENANT_OVERDUE|GATEWAY_TENANT_OVER_QUOTA/i
const VIRTUAL_KEY_QUOTA_EXHAUSTED_PATTERN = /virtual key\s+\w+\s+quota exceeded/i
const VIRTUAL_KEY_NAME_PATTERN = /virtual key\s+['"]([^'"]+)['"]/i
const FREE_ALIAS_PREFIX = "cz-code_auto_"

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

function isBillingError(input: { code?: string; message?: string }) {
  const message = input.message ?? ""
  return input.code === INSUFFICIENT_BALANCE_CODE
    || (input.code ? GATEWAY_BILLING_CODES.has(input.code) : false)
    || INSUFFICIENT_BALANCE_RE.test(message)
    || GATEWAY_BILLING_RE.test(message)
}

function clickzettaQuotaVirtualKeyName(detail?: string | null) {
  if (typeof detail !== "string") return undefined
  return VIRTUAL_KEY_NAME_PATTERN.exec(detail)?.[1]
}

function isClickzettaVirtualKeyQuotaErrorDetail(detail?: string | null) {
  return typeof detail === "string" && VIRTUAL_KEY_QUOTA_EXHAUSTED_PATTERN.test(detail) && !!clickzettaQuotaVirtualKeyName(detail)
}

function isClickzettaFreeQuotaErrorDetail(detail?: string | null) {
  return isClickzettaVirtualKeyQuotaErrorDetail(detail) && clickzettaQuotaVirtualKeyName(detail)?.startsWith(FREE_ALIAS_PREFIX) === true
}

function parseGatewayBody(responseBody?: string) {
  if (!responseBody) return {}
  try {
    const parsed = JSON.parse(responseBody)
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {}
    return {
      code: typeof parsed.code === "string" ? parsed.code : undefined,
      message: typeof parsed.message === "string" ? parsed.message : undefined,
    }
  } catch {
    return {}
  }
}

function formatBillingError(input: { code?: string; message?: string }) {
  const message = input.message ?? ""
  if (!isBillingError(input)) return message
  const accountsUrl = process.env.CZ_ACCOUNTS_URL?.trim()
  if (!accountsUrl) return "Insufficient account balance."
  return `Insufficient account balance. Please visit ${accountsUrl.replace(/\/+$/, "")} to add funds.`
}

export function rewriteClickzettaGatewayError(input: GatewayErrorInput): GatewayErrorRewrite | undefined {
  const message = input.message ?? ""
  const responseBody = input.responseBody ?? ""
  const parsedBody = parseGatewayBody(responseBody)
  const detail = [message, parsedBody.message, responseBody].filter((value) => typeof value === "string" && value).join("\n")

  if (isBillingError({ code: input.code ?? parsedBody.code, message: parsedBody.message ?? message })) {
    return {
      message: formatBillingError({ code: input.code ?? parsedBody.code, message: parsedBody.message ?? message }),
      isRetryable: false,
    }
  }

  const is429 = input.statusCode === 429
  if (is429 && isClickzettaFreeQuotaErrorDetail(detail)) {
    return { message: AI_GATEWAY_FREE_QUOTA_MESSAGE, isRetryable: false }
  }

  if (is429 && isClickzettaVirtualKeyQuotaErrorDetail(detail) && !isClickzettaFreeQuotaErrorDetail(detail)) {
    return { message: AI_GATEWAY_API_KEY_QUOTA_MESSAGE, isRetryable: false }
  }

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
