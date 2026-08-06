/**
 * Consumer-side tests for rewriteClickzettaGatewayError(), reached through the
 * cz-cli re-export the CLI and TUI actually import.
 * Run: bun test test/gateway-error.test.ts
 *
 * Classification detail lives in the gateway package's own suite
 * (packages/clickzetta-ai-gateway/test/gateway-error.test.ts). What matters here
 * is the contract cz-cli depends on: the gateway's own error code comes back, the
 * two billing conditions get different advice, and nothing is retried.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { rewriteClickzettaGatewayError } from "../src/llm/gateway-error.ts"

const ACCOUNTS_URL = "https://accounts.clickzetta.com"
let saved: string | undefined

beforeEach(() => {
  saved = process.env.CZ_ACCOUNTS_URL
  process.env.CZ_ACCOUNTS_URL = ACCOUNTS_URL
})

afterEach(() => {
  if (saved === undefined) delete process.env.CZ_ACCOUNTS_URL
  else process.env.CZ_ACCOUNTS_URL = saved
})

describe("rewriteClickzettaGatewayError", () => {
  test("lakehouse insufficient balance → add-funds rewrite, non-retryable", () => {
    const r = rewriteClickzettaGatewayError({
      message: "insufficient account balance, overdue payments",
      statusCode: 429,
    })
    expect(r).toBeDefined()
    expect(r!.code).toBe("GATEWAY_TENANT_OVERDUE")
    expect(r!.message).toBe(`Insufficient account balance. Please visit ${ACCOUNTS_URL} to add funds.`)
    expect(r!.isRetryable).toBe(false)
  })

  test("tenant overdue code → add-funds rewrite, non-retryable", () => {
    const r = rewriteClickzettaGatewayError({
      message: "request blocked",
      responseBody: JSON.stringify({ error: { code: "GATEWAY_TENANT_OVERDUE", message: "[G2] Tenant overdue" } }),
      statusCode: 403,
    })
    expect(r).toBeDefined()
    expect(r!.code).toBe("GATEWAY_TENANT_OVERDUE")
    expect(r!.message).toContain("add funds")
    expect(r!.isRetryable).toBe(false)
  })

  test("tenant over quota gets its own advice — topping up would not fix it", () => {
    // Same 403, opposite remedy. These shared one "add funds" message until the
    // codes were separated, so a capped tenant was told to pay and stayed blocked.
    const r = rewriteClickzettaGatewayError({
      message: "request blocked",
      responseBody: JSON.stringify({ error: { code: "GATEWAY_TENANT_OVER_QUOTA", message: "[G2] Tenant over quota" } }),
      statusCode: 403,
    })
    expect(r).toBeDefined()
    expect(r!.code).toBe("GATEWAY_TENANT_OVER_QUOTA")
    expect(r!.message).not.toContain("add funds")
    expect(r!.message).toContain("billing cycle")
    expect(r!.isRetryable).toBe(false)
  })

  test("requestId is preserved through the rewrite", () => {
    const r = rewriteClickzettaGatewayError({
      message: "[G2] Tenant overdue. requestId=req-abc",
      statusCode: 403,
    })
    expect(r!.requestId).toBe("req-abc")
    expect(r!.message).toContain("req-abc")
  })

  test("a spent complimentary key gets the create-your-own-key guidance", () => {
    // GATEWAY_TOO_MANY_REQUESTS is what the live gateway sends for an exhausted
    // key — it is absent from the documented code table, so this payload was
    // captured from cn-shanghai rather than taken from the docs.
    const message =
      "[G2] Too many request. path=/gateway/v1/chat/completions, requestId=req-abc, " +
      "virtualApiKeyAlias=cz-code_auto_vmhmdkcc, tenantId=1, detail=Virtual key total quota exceeded"
    const r = rewriteClickzettaGatewayError({
      message,
      responseBody: JSON.stringify({ error: { code: "GATEWAY_TOO_MANY_REQUESTS", message, source: "gateway" } }),
      statusCode: 429,
    })
    expect(r?.code).toBe("GATEWAY_TOO_MANY_REQUESTS")
    expect(r?.isComplimentaryKey).toBe(true)
    expect(r!.message).toContain("cz-cli ai-gateway key create")
    expect(r!.isRetryable).toBe(false)
  })

  test("a bare quota body with no code is left untouched", () => {
    // Same condition, no code attached: there is nothing to branch on, so the
    // gateway's own message reaches the user rather than a guess from its prose.
    const body =
      "Virtual key total quota exceeded: limit is 10000000 tokens for virtual key 'paid_key_001', current usage: 10082801 tokens"
    expect(rewriteClickzettaGatewayError({ message: body, responseBody: body, statusCode: 429 })).toBeUndefined()
  })

  test("ordinary errors pass through", () => {
    expect(rewriteClickzettaGatewayError({ message: "temporary upstream hiccup", statusCode: 503 })).toBeUndefined()
    expect(rewriteClickzettaGatewayError({ message: "bad request", statusCode: 400 })).toBeUndefined()
  })
})
