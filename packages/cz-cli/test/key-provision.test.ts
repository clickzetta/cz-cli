/**
 * Unit tests for the gateway-alias derivation behind in-place key provisioning.
 * Run: bun test test/key-provision.test.ts
 *
 * The alias is DERIVED rather than asked for, which is what lets the TUI flow be a
 * single confirm. That makes two properties load-bearing: it must be stable (so
 * re-provisioning the same entry updates one virtual key instead of littering the
 * tenant with an alias per incident), and it must survive entry names the gateway
 * would reject, since an entry name is whatever the user typed.
 */
import { describe, expect, test } from "bun:test"
import { gatewayAliasForEntry } from "../src/llm/key-provision.ts"

describe("gatewayAliasForEntry", () => {
  test("is stable for the same entry", () => {
    expect(gatewayAliasForEntry("cc-sh")).toBe(gatewayAliasForEntry("cc-sh"))
  })

  test("prefixes so it cannot collide with a hand-made alias", () => {
    // A user creating "my-key" by hand must not end up sharing a virtual key with
    // the entry named "my-key".
    expect(gatewayAliasForEntry("my-key")).toBe("cz-my-key")
  })

  test("keeps the characters aliases accept", () => {
    expect(gatewayAliasForEntry("robert_0")).toBe("cz-robert_0")
    expect(gatewayAliasForEntry("e2e-std_0")).toBe("cz-e2e-std_0")
  })

  test("rewrites characters the gateway would reject", () => {
    expect(gatewayAliasForEntry("team/prod acct")).toBe("cz-team-prod-acct")
    expect(gatewayAliasForEntry("a.b:c")).toBe("cz-a-b-c")
  })

  test("does not emit a doubled or trailing separator", () => {
    // Naive substitution would yield "cz--weird-" here, which reads like a typo
    // and risks tripping alias validation.
    expect(gatewayAliasForEntry("/weird/")).toBe("cz-weird")
    expect(gatewayAliasForEntry("a//b")).toBe("cz-a-b")
  })

  test("falls back rather than emitting a bare prefix", () => {
    // An all-punctuation entry name would otherwise reduce to "cz-", which is not
    // a usable alias.
    expect(gatewayAliasForEntry("///")).toBe("cz-agent")
    expect(gatewayAliasForEntry("")).toBe("cz-agent")
  })
})
