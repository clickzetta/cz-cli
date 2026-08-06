/**
 * Classification tests for rewriteClickzettaGatewayError().
 * Run: bun test test/gateway-error.test.ts
 *
 * The contract is: classify by the gateway's OWN error code, and give each code
 * the advice the documented table prescribes. See
 * https://www.yunqi.tech/documents/aigw_pass_through_code.
 *
 * The body-text/alias heuristics that used to live here were removed on purpose —
 * they matched prose the gateway never promised to keep stable and invented
 * categories with no code behind them. The final describe block pins that removal
 * so it cannot creep back in.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { clickzettaGatewayCode, rewriteClickzettaGatewayError } from "../src/gateway-error"

const ACCOUNTS_URL = "https://acme.accounts.clickzetta.com"
let saved: string | undefined

beforeEach(() => {
  saved = process.env.CZ_ACCOUNTS_URL
  delete process.env.CZ_ACCOUNTS_URL
})

afterEach(() => {
  if (saved === undefined) delete process.env.CZ_ACCOUNTS_URL
  else process.env.CZ_ACCOUNTS_URL = saved
})

/** The documented gateway body: every field nested under `error`. */
function gatewayBody(code: string, message: string, source = "gateway") {
  return JSON.stringify({ error: { code, message, source, retry_history: null } })
}

describe("code extraction", () => {
  test("reads the nested error.code the docs specify", () => {
    // The message says nothing billing-related; only the nested code identifies
    // it. Reading the top level alone left this branch unreachable on real traffic.
    const r = rewriteClickzettaGatewayError({
      statusCode: 403,
      message: "Request rejected",
      responseBody: gatewayBody("GATEWAY_TENANT_OVERDUE", "Request rejected"),
    })
    expect(r?.code).toBe("GATEWAY_TENANT_OVERDUE")
  })

  test("also reads a flattened top-level code", () => {
    const r = rewriteClickzettaGatewayError({
      statusCode: 403,
      message: "Request rejected",
      responseBody: JSON.stringify({ code: "GATEWAY_TENANT_OVERDUE", message: "Request rejected" }),
    })
    expect(r?.code).toBe("GATEWAY_TENANT_OVERDUE")
  })

  test("an explicit input code wins over the body", () => {
    const r = rewriteClickzettaGatewayError({
      statusCode: 403,
      message: "nothing quotable here",
      code: "GATEWAY_TENANT_OVER_QUOTA",
    })
    expect(r?.code).toBe("GATEWAY_TENANT_OVER_QUOTA")
  })

  test("malformed JSON degrades to the message fallback rather than throwing", () => {
    const r = rewriteClickzettaGatewayError({ statusCode: 403, message: "Tenant overdue", responseBody: "{not json" })
    expect(r?.code).toBe("GATEWAY_TENANT_OVERDUE")
  })

  test("the lakehouse SQL code is recognised when supplied", () => {
    const r = rewriteClickzettaGatewayError({ statusCode: 429, message: "job blocked", code: "CZLH-60029" })
    expect(r?.code).toBe("CZLH-60029")
  })

  test("lakehouse balance prose maps to overdue", () => {
    // The SQL submit path reports prose with no code attached. It cannot say
    // WHICH code produced it, so it resolves to the overdue condition — which is
    // what drives the advice anyway.
    const r = rewriteClickzettaGatewayError({ statusCode: 429, message: "insufficient account balance, overdue payments" })
    expect(r?.code).toBe("GATEWAY_TENANT_OVERDUE")
    expect(r!.message).toContain("Insufficient account balance")
  })
})

describe("advice per code", () => {
  test("overdue points at the accounts console", () => {
    process.env.CZ_ACCOUNTS_URL = ACCOUNTS_URL
    const r = rewriteClickzettaGatewayError({
      statusCode: 403,
      message: "blocked",
      responseBody: gatewayBody("GATEWAY_TENANT_OVERDUE", "[G2] Tenant overdue"),
    })
    expect(r?.code).toBe("GATEWAY_TENANT_OVERDUE")
    expect(r!.message).toContain(ACCOUNTS_URL)
    expect(r!.message).toContain("add funds")
  })

  test("over quota never tells the user to add funds", () => {
    // Both codes are 403 blocks, but the remedies are opposite: paying settles a
    // debt and does nothing for a cycle cap. Sharing one "add funds" string meant
    // a capped tenant paid and stayed blocked.
    process.env.CZ_ACCOUNTS_URL = ACCOUNTS_URL
    const r = rewriteClickzettaGatewayError({
      statusCode: 403,
      message: "blocked",
      responseBody: gatewayBody("GATEWAY_TENANT_OVER_QUOTA", "[G2] Tenant over quota. requestId=req-abc"),
    })
    expect(r?.code).toBe("GATEWAY_TENANT_OVER_QUOTA")
    expect(r!.message).not.toContain("add funds")
    expect(r!.message).not.toContain(ACCOUNTS_URL)
    // …and it must say what the user can actually do, per the docs.
    expect(r!.message).toContain("billing cycle")
    expect(r!.message).toContain("raise the limit")
  })

  test("overdue without a configured console still names the condition", () => {
    const r = rewriteClickzettaGatewayError({ statusCode: 403, message: "Tenant overdue" })
    expect(r!.message).toBe("Insufficient account balance.")
  })

  test("every rewrite is non-retryable", () => {
    for (const code of ["GATEWAY_TENANT_OVERDUE", "GATEWAY_TENANT_OVER_QUOTA"]) {
      expect(rewriteClickzettaGatewayError({ statusCode: 403, message: "x", code })?.isRetryable).toBe(false)
    }
  })
})

describe("request id", () => {
  test("survives a wholesale message replacement", () => {
    // The rewrites replace the message outright; without this the only handle
    // support has to correlate the failure would be dropped.
    const r = rewriteClickzettaGatewayError({
      statusCode: 403,
      message: "[G2] Tenant overdue. path=/v1/chat/completions, requestId=req-abc",
      responseBody: gatewayBody("GATEWAY_TENANT_OVERDUE", "[G2] Tenant overdue. requestId=req-abc"),
    })
    expect(r?.requestId).toBe("req-abc")
    expect(r!.message).toContain("req-abc")
  })

  test("absent when the payload carried none", () => {
    const r = rewriteClickzettaGatewayError({ statusCode: 403, message: "Tenant overdue" })
    expect(r?.requestId).toBeUndefined()
    expect(r!.message).not.toContain("request id")
  })
})

describe("exhausted virtual key (GATEWAY_TOO_MANY_REQUESTS)", () => {
  /**
   * Captured verbatim from cn-shanghai with a spent key. This code is NOT in the
   * documented table — it was found by calling the live gateway — so the payload
   * is pinned here rather than paraphrased.
   */
  const liveBody = (alias: string) =>
    `{"error":{"code":"GATEWAY_TOO_MANY_REQUESTS","message":"[G2] Too many request. path=/gateway/v1/chat/completions, requestId=423fb935050582439277183e1e9c8712, virtualApiKeyAlias=${alias}, tenantId=1, detail=Virtual key total quota exceeded: limit is 10000000 tokens for virtual key '${alias}', current usage: 10081501 tokens","source":"gateway"}}`

  const classify = (alias: string) => {
    const body = liveBody(alias)
    return rewriteClickzettaGatewayError({
      statusCode: 429,
      message: JSON.parse(body).error.message,
      responseBody: body,
    })
  }

  test("a complimentary key gets the create-your-own-key guidance", () => {
    // Its allowance is fixed, so raising a quota is not an option the user has.
    const r = classify("cz-code_auto_vmhmdkcc")
    expect(r?.code).toBe("GATEWAY_TOO_MANY_REQUESTS")
    expect(r?.keyAlias).toBe("cz-code_auto_vmhmdkcc")
    expect(r?.isComplimentaryKey).toBe(true)
    expect(r!.message).toContain("complimentary")
    expect(r!.message).toContain("cz-cli ai-gateway key create")
  })

  test("a user-provisioned key is told to raise its quota instead", () => {
    const r = classify("my_own_key")
    expect(r?.keyAlias).toBe("my_own_key")
    expect(r?.isComplimentaryKey).toBe(false)
    expect(r!.message).not.toContain("complimentary")
    expect(r!.message).toContain("reached its token quota")
  })

  test("the alias comes from the gateway's own field, not the quota prose", () => {
    // `virtualApiKeyAlias=` is structured metadata the gateway stamps on every
    // error. The `for virtual key '…'` phrasing inside `detail=` is prose and must
    // not be what drives the decision — here the two disagree on purpose.
    const body = liveBody("cz-code_auto_real").replace(/for virtual key '[^']+'/, "for virtual key 'decoy_paid_key'")
    const r = rewriteClickzettaGatewayError({ statusCode: 429, message: JSON.parse(body).error.message, responseBody: body })
    expect(r?.keyAlias).toBe("cz-code_auto_real")
    expect(r?.isComplimentaryKey).toBe(true)
  })

  test("the code alone classifies it even with no alias present", () => {
    const r = rewriteClickzettaGatewayError({ statusCode: 429, message: "[G2] Too many request.", code: "GATEWAY_TOO_MANY_REQUESTS" })
    expect(r?.code).toBe("GATEWAY_TOO_MANY_REQUESTS")
    expect(r?.keyAlias).toBeUndefined()
    // With no key named, the safe default is the raise-quota wording rather than
    // claiming a complimentary grant is involved.
    expect(r!.message).toContain("reached its token quota")
  })

  test("never retried — a spent quota does not recover on backoff", () => {
    expect(classify("cz-code_auto_x")!.isRetryable).toBe(false)
  })
})

describe("undocumented conditions are left alone", () => {
  test("a bare quota body with no code is not classified", () => {
    // Without the gateway's code there is nothing to key off. This body used to be
    // matched by a regex on its prose; that guesswork is gone.
    const body =
      "Virtual key total quota exceeded: limit is 10000000 tokens for virtual key 'paid_key_001', current usage: 10082801 tokens"
    expect(rewriteClickzettaGatewayError({ statusCode: 429, message: body, responseBody: body })).toBeUndefined()
  })

  test("a daily-limit 429 is not classified", () => {
    const body = "you have hit your daily token limit"
    expect(rewriteClickzettaGatewayError({ statusCode: 429, message: body, responseBody: body })).toBeUndefined()
  })

  test("codes with no tailored advice pass through", () => {
    // The documented table has eleven codes; only the billing ones are handled.
    for (const code of ["GATEWAY_VIRTUAL_KEY_DISABLED", "GATEWAY_MODEL_NOT_RESOLVED", "UPSTREAM_ALL_FAILED"]) {
      expect(clickzettaGatewayCode({ code })).toBeUndefined()
      expect(rewriteClickzettaGatewayError({ statusCode: 401, message: "x", code })).toBeUndefined()
    }
  })

  test("an ordinary upstream failure passes through", () => {
    expect(rewriteClickzettaGatewayError({ message: "temporary upstream hiccup", statusCode: 503 })).toBeUndefined()
    expect(rewriteClickzettaGatewayError({ message: "bad request", statusCode: 400 })).toBeUndefined()
  })
})
