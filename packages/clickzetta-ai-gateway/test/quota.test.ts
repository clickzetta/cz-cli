/**
 * Tests for reading a key's token quota off the gateway's response headers.
 * Run: bun test test/quota.test.ts
 *
 * The header values here are copied from live UAT and prod responses, including
 * the multi-period case where all four headers repeat and arrive comma-joined.
 */
import { describe, expect, test } from "bun:test"
import { formatClickzettaQuota, parseClickzettaQuota } from "../src/quota"

describe("parseClickzettaQuota", () => {
  test("a single-period key, verbatim from a UAT completion", () => {
    expect(
      parseClickzettaQuota({
        "x-czgw-ratelimit-api-key-token-period": "PDO",
        "x-czgw-ratelimit-api-key-token-limit": "10000000",
        "x-czgw-ratelimit-api-key-token-used": "238",
        "x-czgw-ratelimit-api-key-token-remaining": "9999762",
      }),
    ).toEqual([
      { period: "daily", periodCode: "PDO", limit: 10000000, used: 238, remaining: 9999762, scope: "api-key" },
    ])
  })

  /**
   * The shape that made a naive parser wrong: a key with both a lifetime and a
   * daily allowance repeats every header, and Headers (like the AI SDK's
   * SharedV3Headers) hands the duplicates over as one comma-joined string. Index i
   * of each list belongs to the same period, so 1,000,000,000 must land on `total`
   * and 1,000 on `daily` — never averaged, summed, or last-one-wins.
   */
  test("a key with two periods keeps each period's own numbers", () => {
    expect(
      parseClickzettaQuota({
        "x-czgw-ratelimit-api-key-token-period": "PTO, PDO",
        "x-czgw-ratelimit-api-key-token-limit": "1000000000, 1000",
        "x-czgw-ratelimit-api-key-token-used": "21306657, 0",
        "x-czgw-ratelimit-api-key-token-remaining": "978693343, 1000",
      }),
    ).toEqual([
      { period: "total", periodCode: "PTO", limit: 1000000000, used: 21306657, remaining: 978693343, scope: "api-key" },
      { period: "daily", periodCode: "PDO", limit: 1000, used: 0, remaining: 1000, scope: "api-key" },
    ])
  })

  test("all four period codes map to the admin API's own vocabulary", () => {
    const parsed = parseClickzettaQuota({
      "x-czgw-ratelimit-api-key-token-period": "PDO,PWO,PMO,PTO",
    })
    expect(parsed?.map((q) => q.period)).toEqual(["daily", "weekly", "monthly", "total"])
  })

  test("reads a real Headers object, not just a plain record", () => {
    const headers = new Headers()
    headers.append("X-Czgw-Ratelimit-Api-Key-Token-Period", "PTO")
    headers.append("X-Czgw-Ratelimit-Api-Key-Token-Limit", "500")
    // Appending twice is how a multi-period response actually arrives.
    headers.append("X-Czgw-Ratelimit-Api-Key-Token-Period", "PDO")
    headers.append("X-Czgw-Ratelimit-Api-Key-Token-Limit", "50")
    expect(parseClickzettaQuota(headers)).toEqual([
      { period: "total", periodCode: "PTO", limit: 500, scope: "api-key" },
      { period: "daily", periodCode: "PDO", limit: 50, scope: "api-key" },
    ])
  })

  test("no quota headers means not reported, not zero", () => {
    expect(parseClickzettaQuota({ "content-type": "application/json", "x-request-id": "abc" })).toBeUndefined()
    expect(parseClickzettaQuota(undefined)).toBeUndefined()
    expect(parseClickzettaQuota({})).toBeUndefined()
  })

  test("an unmapped period code is still reported, under its raw code", () => {
    expect(parseClickzettaQuota({ "x-czgw-ratelimit-api-key-token-period": "PYO" })).toEqual([
      { periodCode: "PYO", scope: "api-key" },
    ])
  })

  test("a non-numeric or empty value drops that field instead of becoming NaN", () => {
    expect(
      parseClickzettaQuota({
        "x-czgw-ratelimit-api-key-token-period": "PDO",
        "x-czgw-ratelimit-api-key-token-limit": "unlimited",
        "x-czgw-ratelimit-api-key-token-used": "",
        "x-czgw-ratelimit-api-key-token-remaining": "12",
      }),
    ).toEqual([{ period: "daily", periodCode: "PDO", remaining: 12, scope: "api-key" }])
  })

  /** A shorter list leaves that field unknown for the trailing periods rather than shifting values onto them. */
  test("mismatched list lengths do not shift values between periods", () => {
    expect(
      parseClickzettaQuota({
        "x-czgw-ratelimit-api-key-token-period": "PTO, PDO",
        "x-czgw-ratelimit-api-key-token-limit": "900",
      }),
    ).toEqual([
      { period: "total", periodCode: "PTO", limit: 900, scope: "api-key" },
      { period: "daily", periodCode: "PDO", scope: "api-key" },
    ])
  })

  /** Scope is captured rather than hardcoded, so a limiter other than the virtual key still parses. */
  test("a non-api-key limiter is reported under its own scope", () => {
    expect(
      parseClickzettaQuota({
        "x-czgw-ratelimit-tenant-token-period": "PMO",
        "x-czgw-ratelimit-tenant-token-remaining": "42",
      }),
    ).toEqual([{ period: "monthly", periodCode: "PMO", remaining: 42, scope: "tenant" }])
  })
})

describe("formatClickzettaQuota", () => {
  test("used, limit and remaining read as one line", () => {
    expect(
      formatClickzettaQuota({
        period: "total",
        periodCode: "PTO",
        limit: 1000000000,
        used: 21306657,
        remaining: 978693343,
        scope: "api-key",
      }),
    ).toBe("total: 21,306,657 / 1,000,000,000 tokens (978,693,343 left)")
  })

  test("partial numbers still produce a line", () => {
    expect(formatClickzettaQuota({ period: "daily", periodCode: "PDO", limit: 1000, scope: "api-key" })).toBe(
      "daily: limit 1,000 tokens",
    )
    expect(formatClickzettaQuota({ periodCode: "PYO", used: 5, scope: "api-key" })).toBe("PYO: 5 tokens used")
    expect(formatClickzettaQuota({ periodCode: "", scope: "api-key" })).toBe("api-key: no numbers reported")
  })
})
