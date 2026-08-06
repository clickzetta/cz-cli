/**
 * Classify AI-gateway errors by the gateway's OWN error code.
 *
 * The AIGW pass-through API documents a fixed code table (see
 * https://www.yunqi.tech/documents/aigw_pass_through_code) and states that
 * `code` — not the message text — is the field callers should branch on. This
 * module does exactly that: parse `code` out of the error body and look up the
 * advice for it. There is no second vocabulary; the code IS the classification.
 *
 * What used to be here, and why it is gone: a set of regexes matched the 429
 * virtual-key-quota body text and split the result by the key alias found in it,
 * with no code behind either decision. That has been replaced by the real code
 * the gateway sends for an exhausted key — `GATEWAY_TOO_MANY_REQUESTS`, observed
 * live and NOT in the documented table — plus its own `virtualApiKeyAlias=` field,
 * which is structured metadata the gateway emits on every error, not prose.
 */
const INSUFFICIENT_BALANCE_CODE = "CZLH-60029"
const OVERDUE_CODE = "GATEWAY_TENANT_OVERDUE"
const OVER_QUOTA_CODE = "GATEWAY_TENANT_OVER_QUOTA"
/**
 * Sent when a virtual key's own token allowance is spent. Absent from the
 * documented code table, but it is what the live gateway returns — verified
 * against cn-shanghai with an exhausted key:
 *
 *   429 {"error":{"code":"GATEWAY_TOO_MANY_REQUESTS","message":"[G2] Too many
 *   request. path=…, virtualApiKeyAlias=cz-code_auto_vmhmdkcc, tenantId=1,
 *   detail=Virtual key total quota exceeded: limit is 10000000 tokens …"}}
 *
 * Distinct from the tenant-level codes above: this is one key's ceiling, not the
 * account's balance or its billing-cycle cap.
 */
const KEY_QUOTA_CODE = "GATEWAY_TOO_MANY_REQUESTS"

/**
 * Complimentary keys are provisioned with this alias prefix and a fixed grant.
 * Their allowance cannot be raised, so the only way forward is a key of the
 * user's own — which is why the alias has to be read, not just the code.
 */
const FREE_ALIAS_PREFIX = "cz-code_auto_"

/**
 * The gateway stamps `virtualApiKeyAlias=<alias>` into every error message it
 * emits, alongside `path=`, `requestId=` and `tenantId=`. Reading that field is
 * not the body-prose matching this module deliberately dropped: it is the
 * gateway's own key/value metadata, consistent across codes and keys.
 */
const KEY_ALIAS_PATTERN = /virtualApiKeyAlias=([A-Za-z0-9_-]+)/i

/**
 * Message-text fallbacks for the two billing conditions.
 *
 * Kept only because the same conditions reach us from paths that carry no code:
 * the lakehouse SQL submit surfaces `CZLH-60029`'s prose, and the AI SDK lifts
 * `error.message` onto APICallError.message where the code may be absent. These
 * match the code's own wording, not an arbitrary body format.
 */
const INSUFFICIENT_BALANCE_RE = /insufficient account balance|overdue payments|job submission is currently restricted/i
const OVERDUE_RE = /\[G2\]\s*Tenant overdue\b|Tenant overdue\b|GATEWAY_TENANT_OVERDUE/i
const OVER_QUOTA_RE = /\[G2\]\s*Tenant over quota\b|Tenant over quota\b|GATEWAY_TENANT_OVER_QUOTA/i

const REQUEST_ID_PATTERN = /requestId[=:]\s*([A-Za-z0-9_-]+)/i

export type GatewayErrorInput = {
  statusCode?: number
  message: string
  responseBody?: string
  code?: string
}

/**
 * The gateway's own error code, verbatim — `GATEWAY_TENANT_OVERDUE`,
 * `CZLH-60029`, and so on. Callers branch on this string.
 *
 * Typed as an open union: most of the documented codes carry no tailored advice
 * today, so an unrecognised code must remain representable rather than force a cast.
 */
export type GatewayErrorCode =
  | typeof OVERDUE_CODE
  | typeof OVER_QUOTA_CODE
  | typeof INSUFFICIENT_BALANCE_CODE
  | typeof KEY_QUOTA_CODE
  | (string & {})

export type GatewayErrorRewrite = {
  /** The gateway code this was classified as. */
  code: GatewayErrorCode
  message: string
  isRetryable: false
  /** The gateway's correlation id, when the payload carried one. */
  requestId?: string
  /**
   * The virtual key the gateway blamed, when it named one. Present for
   * `GATEWAY_TOO_MANY_REQUESTS`; lets callers tell a complimentary key from one
   * the user created without re-parsing the message.
   */
  keyAlias?: string
  /** True when `keyAlias` is a complimentary key, whose allowance cannot be raised. */
  isComplimentaryKey?: boolean
}

/**
 * Overdue (unpaid charges) and over-quota (cycle cap reached) are both 403s that
 * stop every call, but the remedies are opposite: paying settles the first and
 * does nothing for the second. Only overdue may be routed to a top-up page.
 */
export const TENANT_OVER_QUOTA_MESSAGE =
  "This tenant has reached its usage limit for the current billing cycle.\n" +
  "Adding funds does not lift it. Wait for the next cycle, reduce usage, or ask " +
  "your account administrator to raise the limit."

/**
 * A complimentary key is spent. Its allowance is fixed, so the way forward is a
 * key of the user's own — spelled out as commands because every step is a CLI call.
 */
export const FREE_KEY_EXHAUSTED_MESSAGE =
  "Your complimentary token quota has been exhausted.\n" +
  "Create and register your own API key (this does not change the current default model):\n" +
  "  cz-cli ai-gateway key create my-key --add-to-llm my-key\n" +
  "To switch the default to the new key, list its models and choose one:\n" +
  "  cz-cli agent llm models my-key\n" +
  "  cz-cli agent llm use my-key/<MODEL_ID>"

/** A key the user provisioned is spent. Unlike the complimentary grant, its own ceiling can be raised. */
export const KEY_QUOTA_EXHAUSTED_MESSAGE =
  "This API key has reached its token quota.\n" +
  "Raise the key's quota, or register another key with `cz-cli ai-gateway key create`."

function str(value: unknown) {
  return typeof value === "string" ? value : undefined
}

function record(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}

/**
 * Pull `code` / `message` off an AIGW error body.
 *
 * The documented shape nests both under `error` ({"error":{"code":…}}), but the
 * same fields also reach us flattened: @ai-sdk/openai-compatible's default
 * errorToMessage lifts `data.error.message` onto APICallError.message, and some
 * ClickZetta services answer with the fields at the top level. Reading only the
 * top level — as this once did — left every `code` branch unreachable on real
 * traffic. Nested wins when both are present.
 */
export function parseGatewayBody(responseBody?: string) {
  if (!responseBody) return {}
  try {
    const parsed = record(JSON.parse(responseBody))
    if (!parsed) return {}
    const nested = record(parsed.error)
    return {
      code: str(nested?.code) ?? str(parsed.code),
      message: str(nested?.message) ?? str(parsed.message),
      source: str(nested?.source) ?? str(parsed.source),
    }
  } catch {
    return {}
  }
}

/**
 * Resolve the gateway code for a code/message pair, or undefined when it is not a
 * condition we have advice for. Code first, message wording only as a fallback.
 *
 * Exported because cz-cli's SQL path asks the same question and used to carry a
 * byte-identical copy of these codes and regexes.
 */
export function clickzettaGatewayCode(input: { code?: string; message?: string }): GatewayErrorCode | undefined {
  const code = input.code
  if (
    code === OVERDUE_CODE ||
    code === OVER_QUOTA_CODE ||
    code === INSUFFICIENT_BALANCE_CODE ||
    code === KEY_QUOTA_CODE
  ) {
    return code
  }
  const message = input.message ?? ""
  if (OVER_QUOTA_RE.test(message)) return OVER_QUOTA_CODE
  if (OVERDUE_RE.test(message) || INSUFFICIENT_BALANCE_RE.test(message)) return OVERDUE_CODE
  return undefined
}

/** The virtual key the gateway named, if any, and whether it is a complimentary one. */
export function clickzettaKeyAlias(message: string | undefined) {
  const alias = KEY_ALIAS_PATTERN.exec(message ?? "")?.[1]
  if (!alias) return undefined
  return { alias, isComplimentary: alias.startsWith(FREE_ALIAS_PREFIX) }
}

/** Whether this code means the account is blocked over money. */
export function isClickzettaBillingCode(code: string | undefined) {
  return code === OVERDUE_CODE || code === OVER_QUOTA_CODE || code === INSUFFICIENT_BALANCE_CODE
}

function overdueMessage() {
  const accountsUrl = process.env.CZ_ACCOUNTS_URL?.trim()
  if (!accountsUrl) return "Insufficient account balance."
  return `Insufficient account balance. Please visit ${accountsUrl.replace(/\/+$/, "")} to add funds.`
}

/** Keep the gateway's correlation id visible — it is the only handle support has. */
function withRequestId(message: string, requestId?: string) {
  if (!requestId || message.includes(requestId)) return message
  return `${message}\n(request id: ${requestId})`
}

export function rewriteClickzettaGatewayError(input: GatewayErrorInput): GatewayErrorRewrite | undefined {
  const message = input.message ?? ""
  const responseBody = input.responseBody ?? ""
  const parsedBody = parseGatewayBody(responseBody)
  const detail = [message, parsedBody.message, responseBody].filter((value) => typeof value === "string" && value).join("\n")
  const requestId = REQUEST_ID_PATTERN.exec(detail)?.[1]

  const code = clickzettaGatewayCode({
    code: input.code ?? parsedBody.code,
    message: parsedBody.message ?? message,
  })
  if (!code) return undefined

  // A spent key needs to know WHICH key: a complimentary grant cannot be topped
  // up, so its only route forward is creating one of the user's own, while a key
  // the user provisioned can simply have its quota raised.
  if (code === KEY_QUOTA_CODE) {
    const key = clickzettaKeyAlias(detail)
    return {
      code,
      message: withRequestId(key?.isComplimentary ? FREE_KEY_EXHAUSTED_MESSAGE : KEY_QUOTA_EXHAUSTED_MESSAGE, requestId),
      isRetryable: false,
      ...(requestId ? { requestId } : {}),
      ...(key ? { keyAlias: key.alias, isComplimentaryKey: key.isComplimentary } : {}),
    }
  }

  return {
    code,
    message: withRequestId(code === OVER_QUOTA_CODE ? TENANT_OVER_QUOTA_MESSAGE : overdueMessage(), requestId),
    isRetryable: false,
    ...(requestId ? { requestId } : {}),
  }
}
