/**
 * Tests for the cross-process quota cache.
 * Run: bun test test/quota-store.test.ts
 *
 * Real files under a temp CLICKZETTA_TEST_HOME — the same override cz-cli's own
 * config readers honour — rather than a mocked fs, so the path resolution is
 * covered too.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { gatewayQuotaCacheKey, readGatewayQuota, recordGatewayQuota } from "../src/quota-store"

const BASE = "https://uat-aimesh.clickzetta.com/gateway/v1"
const KEY = "k".repeat(32)
const QUOTAS = [
  { period: "daily" as const, periodCode: "PDO", limit: 10000000, used: 238, remaining: 9999762, scope: "api-key" },
]

let home: string
const previous = process.env.CLICKZETTA_TEST_HOME

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "cz-quota-store-"))
  process.env.CLICKZETTA_TEST_HOME = home
})

afterEach(() => {
  if (previous === undefined) delete process.env.CLICKZETTA_TEST_HOME
  else process.env.CLICKZETTA_TEST_HOME = previous
  rmSync(home, { recursive: true, force: true })
})

describe("recordGatewayQuota / readGatewayQuota", () => {
  test("a recorded reading comes back, and creates .clickzetta if absent", () => {
    recordGatewayQuota({ baseURL: BASE, apiKey: KEY, quotas: QUOTAS })
    const entry = readGatewayQuota({ baseURL: BASE, apiKey: KEY })
    expect(entry?.quotas).toEqual(QUOTAS)
    expect(entry?.updated_at).toBeGreaterThan(0)
  })

  /**
   * The reason the key is part of the cache key at all: two llm.json entries
   * pointing at one gateway with different keys must not overwrite each other.
   */
  test("two keys on the same endpoint keep separate readings", () => {
    recordGatewayQuota({ baseURL: BASE, apiKey: KEY, quotas: QUOTAS })
    recordGatewayQuota({
      baseURL: BASE,
      apiKey: "z".repeat(32),
      quotas: [{ periodCode: "PTO", period: "total" as const, limit: 5, used: 1, remaining: 4, scope: "api-key" }],
    })
    expect(readGatewayQuota({ baseURL: BASE, apiKey: KEY })?.quotas).toEqual(QUOTAS)
    expect(readGatewayQuota({ baseURL: BASE, apiKey: "z".repeat(32) })?.quotas?.[0]?.limit).toBe(5)
  })

  test("a trailing slash is the same endpoint", () => {
    recordGatewayQuota({ baseURL: BASE, apiKey: KEY, quotas: QUOTAS })
    expect(readGatewayQuota({ baseURL: `${BASE}/`, apiKey: KEY })?.quotas).toEqual(QUOTAS)
  })

  test("a later reading replaces the earlier one for the same key", () => {
    recordGatewayQuota({ baseURL: BASE, apiKey: KEY, quotas: QUOTAS })
    recordGatewayQuota({
      baseURL: BASE,
      apiKey: KEY,
      quotas: [{ ...QUOTAS[0]!, used: 999, remaining: 9999001 }],
    })
    expect(readGatewayQuota({ baseURL: BASE, apiKey: KEY })?.quotas?.[0]?.used).toBe(999)
  })

  /** Quota moves with every request, so a reading from an old session is worse than none. */
  /** The timestamp comes back so the caller can make the freshness decision itself. */
  test("the reading carries the moment it was taken", () => {
    const before = Date.now()
    recordGatewayQuota({ baseURL: BASE, apiKey: KEY, quotas: QUOTAS })
    const entry = readGatewayQuota({ baseURL: BASE, apiKey: KEY })
    expect(entry?.updated_at).toBeGreaterThanOrEqual(before)
    expect(entry?.updated_at).toBeLessThanOrEqual(Date.now())
  })

  test("an unknown endpoint or key reads as nothing cached", () => {
    recordGatewayQuota({ baseURL: BASE, apiKey: KEY, quotas: QUOTAS })
    expect(readGatewayQuota({ baseURL: "https://other/gateway/v1", apiKey: KEY })).toBeUndefined()
    expect(readGatewayQuota({ baseURL: BASE, apiKey: "other" })).toBeUndefined()
  })

  test("no file at all reads as nothing cached, not an error", () => {
    expect(readGatewayQuota({ baseURL: BASE, apiKey: KEY })).toBeUndefined()
  })

  /** An interrupted write leaves a truncated body; it must read like a miss. */
  test("a corrupt store reads as nothing cached", () => {
    mkdirSync(join(home, ".clickzetta"), { recursive: true })
    writeFileSync(join(home, ".clickzetta", "gateway-quota.json"), '{"entries":{"a":', "utf-8")
    expect(readGatewayQuota({ baseURL: BASE, apiKey: KEY })).toBeUndefined()
    // And a following write repairs it rather than throwing.
    recordGatewayQuota({ baseURL: BASE, apiKey: KEY, quotas: QUOTAS })
    expect(readGatewayQuota({ baseURL: BASE, apiKey: KEY })?.quotas).toEqual(QUOTAS)
  })

  test("an empty quota list is not a reading", () => {
    recordGatewayQuota({ baseURL: BASE, apiKey: KEY, quotas: [] })
    expect(readGatewayQuota({ baseURL: BASE, apiKey: KEY })).toBeUndefined()
  })

  /** The key must not be recoverable from the file that sits next to llm.json. */
  test("the cache key hashes the credential instead of storing it", () => {
    const id = gatewayQuotaCacheKey(BASE, KEY)
    expect(id).toStartWith(`${BASE}#`)
    expect(id).not.toContain(KEY)
    expect(id).toBe(gatewayQuotaCacheKey(`${BASE}///`, KEY))
  })
})
