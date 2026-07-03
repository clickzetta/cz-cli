/**
 * Unit tests for rewriteClickzettaGatewayError().
 * Run: bun test test/gateway-error.test.ts
 *
 * This is the consolidated replacement for the former opencode-side billing seam
 * (test/session/billing-semantic.test.ts) + rotation handler. The rewriter is a
 * pure function consumed by the @clickzetta/ai-gateway shell; it must turn every
 * ClickZetta billing / quota condition into a non-retryable, actionable message,
 * and leave everything else untouched.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { mkdirSync, writeFileSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import {
  rewriteClickzettaGatewayError,
  AI_GATEWAY_API_KEY_QUOTA_MESSAGE,
  AI_GATEWAY_FREE_QUOTA_MESSAGE,
} from "../src/llm/gateway-error.ts"

const HOME = join(tmpdir(), `cz-gateway-err-test-${process.pid}-${Date.now()}`)
const ACCOUNTS_URL = "https://accounts.clickzetta.com"
const originalHome = process.env.CLICKZETTA_TEST_HOME

beforeAll(() => {
  mkdirSync(join(HOME, ".clickzetta"), { recursive: true })
  writeFileSync(
    join(HOME, ".clickzetta", "profiles.toml"),
    [`default_profile = "default"`, ``, `[profiles.default]`, `service = "clickzetta"`, `accounts_url = "${ACCOUNTS_URL}"`, ``].join("\n"),
    "utf-8",
  )
  process.env.CLICKZETTA_TEST_HOME = HOME
})

afterAll(() => {
  if (originalHome === undefined) delete process.env.CLICKZETTA_TEST_HOME
  else process.env.CLICKZETTA_TEST_HOME = originalHome
  rmSync(HOME, { recursive: true, force: true })
})

describe("rewriteClickzettaGatewayError", () => {
  test("insufficient-balance → actionable rewrite, non-retryable", () => {
    const r = rewriteClickzettaGatewayError({
      message: "insufficient account balance, overdue payments",
      statusCode: 429,
    })
    expect(r).toBeDefined()
    expect(r!.message).toBe(`Insufficient account balance. Please visit ${ACCOUNTS_URL} to add funds.`)
    expect(r!.isRetryable).toBe(false)
  })

  test("gateway tenant-overdue code → add-funds rewrite, non-retryable", () => {
    const r = rewriteClickzettaGatewayError({
      message: "request blocked",
      responseBody: JSON.stringify({ code: "GATEWAY_TENANT_OVERDUE", message: "[G2] Tenant overdue" }),
      code: "GATEWAY_TENANT_OVERDUE",
      statusCode: 429,
    })
    expect(r).toBeDefined()
    expect(r!.message).toContain("add funds")
    expect(r!.isRetryable).toBe(false)
  })

  test("user-created virtual key quota exhausted → standard quota message, non-retryable", () => {
    const body =
      "Virtual key total quota exceeded: limit is 10000000 tokens for virtual key 'paid_key_001', current usage: 10082801 tokens"
    const r = rewriteClickzettaGatewayError({ message: body, responseBody: body, statusCode: 429 })
    expect(r).toBeDefined()
    expect(r!.message).toBe(AI_GATEWAY_API_KEY_QUOTA_MESSAGE)
    expect(r!.isRetryable).toBe(false)
  })

  test("free complimentary key (cz-code_auto_*) exhausted → create-key guidance, non-retryable", () => {
    const body =
      "Virtual key total quota exceeded: limit is 1000000 tokens for virtual key 'cz-code_auto_alice', current usage: 1000001 tokens"
    const r = rewriteClickzettaGatewayError({ message: body, responseBody: body, statusCode: 429 })
    expect(r).toBeDefined()
    expect(r!.message).toBe(AI_GATEWAY_FREE_QUOTA_MESSAGE)
    expect(r!.message).toContain("cz-cli ai-gateway key create")
    expect(r!.isRetryable).toBe(false)
  })

  test("generic daily-token-limit 429 → keep message, non-retryable", () => {
    const body = "you have hit your daily token limit"
    const r = rewriteClickzettaGatewayError({ message: body, responseBody: body, statusCode: 429 })
    expect(r).toBeDefined()
    expect(r!.message).toBe(body)
    expect(r!.isRetryable).toBe(false)
  })

  test("ordinary non-billing error → undefined (passthrough)", () => {
    const r = rewriteClickzettaGatewayError({ message: "temporary upstream hiccup", statusCode: 503 })
    expect(r).toBeUndefined()
  })

  test("non-429 with no billing signature → undefined (passthrough)", () => {
    const r = rewriteClickzettaGatewayError({ message: "bad request", statusCode: 400 })
    expect(r).toBeUndefined()
  })
})
