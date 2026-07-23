import { describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"

import { generatePkce } from "../src/auth/pkce.js"

function base64Url(input: Buffer): string {
  return input.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "")
}

// RFC 7636 unreserved character set for code_verifier.
const UNRESERVED = /^[A-Za-z0-9\-._~]+$/

describe("generatePkce", () => {
  // Property 1: PKCE consistency — codeChallenge == base64url(sha256(codeVerifier)),
  // codeVerifier length ∈ [43,128] and uses only unreserved characters.
  // Validates: Requirements 2.1, 2.2
  test("codeChallenge equals base64url(sha256(codeVerifier)) with no padding", () => {
    for (let i = 0; i < 100; i++) {
      const pkce = generatePkce()
      const expected = base64Url(createHash("sha256").update(pkce.codeVerifier).digest())
      expect(pkce.codeChallenge).toBe(expected)
      expect(pkce.codeChallenge).not.toContain("=")
      expect(pkce.codeChallenge).not.toContain("+")
      expect(pkce.codeChallenge).not.toContain("/")
    }
  })

  // Property 1: codeVerifier length ∈ [43,128] and uses only RFC 7636 unreserved characters.
  // Validates: Requirements 2.1
  test("codeVerifier length is within [43,128] and uses only unreserved characters", () => {
    for (let i = 0; i < 100; i++) {
      const pkce = generatePkce()
      expect(pkce.codeVerifier.length).toBeGreaterThanOrEqual(43)
      expect(pkce.codeVerifier.length).toBeLessThanOrEqual(128)
      expect(pkce.codeVerifier).toMatch(UNRESERVED)
    }
  })

  // Property 2: PKCE uniqueness — consecutive generations produce distinct codeVerifier values.
  // Validates: Requirements 2.3
  test("multiple calls produce distinct codeVerifier values", () => {
    const verifiers = Array.from({ length: 100 }, () => generatePkce().codeVerifier)
    expect(new Set(verifiers).size).toBe(verifiers.length)
  })
})
