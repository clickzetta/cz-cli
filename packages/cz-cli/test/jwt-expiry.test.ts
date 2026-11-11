import { describe, expect, test } from "bun:test"

import { isTokenExpired } from "@clickzetta/sdk"

import { msUntilJwtExpiry, parseJwtPayload } from "../src/connection/jwt"
import { tokenFromResponse } from "../src/commands/oauth-userinfo"

/** A JWT with the given payload. Unsigned — nothing here verifies signatures. */
function jwt(payload: Record<string, unknown>): string {
  const part = (obj: unknown) => Buffer.from(JSON.stringify(obj)).toString("base64url")
  return `${part({ alg: "HS256" })}.${part(payload)}.signature-not-checked`
}

const NOW = 1_788_342_750_512

describe("parseJwtPayload", () => {
  test("reads the claims", () => {
    expect(parseJwtPayload(jwt({ userId: 110000011901, exp: 1788346050 }))).toEqual({
      userId: 110000011901,
      exp: 1788346050,
    })
  })

  // Opaque tokens are legitimate here (a PAT, or a gateway that stops issuing
  // JWTs). Callers fall back on {}, so this must not throw.
  test("returns nothing readable for a token that is not a JWT", () => {
    expect(parseJwtPayload("access-xyz")).toEqual({})
    expect(parseJwtPayload("")).toEqual({})
    expect(parseJwtPayload("a.b.c")).toEqual({})
  })
})

describe("msUntilJwtExpiry", () => {
  test("measures against the exp claim, not against receipt time", () => {
    // Issued 300s before `now` with a 3600s lifetime, so ~3300s left, NOT 3600s.
    // (3299 rather than 3300 because NOW carries a 512ms remainder.)
    const token = jwt({ iat: 1788342450, exp: 1788346050 })
    expect(msUntilJwtExpiry(token, NOW)).toBe(1788346050 * 1000 - NOW)
    expect(Math.round(msUntilJwtExpiry(token, NOW)! / 1000)).toBe(3299)
  })

  // Both directions are wrong here and only one of them is obvious. A negative
  // duration reads as far-future validity; zero reads as "no expiry to check",
  // because isTokenExpired short-circuits on a falsy expireTimeMs. So the floor is
  // 1ms — expired, and seen to be expired.
  test("floors an already-expired token at 1ms, not zero", () => {
    expect(msUntilJwtExpiry(jwt({ exp: 1788000000 }), NOW)).toBe(1)
  })

  test("a floored token is one the SDK actually treats as expired", () => {
    const token = tokenFromResponse({ access_token: jwt({ exp: 1788000000 }) })
    expect(token.expireTimeMs).toBe(1)
    // obtainedAt is now, so nothing has elapsed yet; the point is that the check
    // RUNS at all instead of short-circuiting on a falsy duration.
    expect(isTokenExpired({ ...token, obtainedAt: NOW - 10 })).toBe(true)
    expect(isTokenExpired({ ...token, expireTimeMs: 0, obtainedAt: NOW - 10 })).toBe(false)
  })

  test("reports nothing usable when there is no exp to read", () => {
    expect(msUntilJwtExpiry(jwt({ userId: 1 }), NOW)).toBeUndefined()
    expect(msUntilJwtExpiry("access-xyz", NOW)).toBeUndefined()
    // Defensive: a non-numeric or non-positive exp is not a deadline.
    expect(msUntilJwtExpiry(jwt({ exp: "1788346050" }), NOW)).toBeUndefined()
    expect(msUntilJwtExpiry(jwt({ exp: 0 }), NOW)).toBeUndefined()
  })
})

describe("tokenFromResponse expiry baseline", () => {
  // The regression this guards: `expires_in` is the token's TOTAL lifetime from
  // the moment the SERVER issued it. In the device flow the user can sit on the
  // verification page for minutes, so storing it against our own receipt time
  // dates the token forward by that gap and eats the refresh safety margin.
  test("prefers the exp claim over expires_in", () => {
    const before = Date.now()
    const exp = Math.floor(before / 1000) + 3300
    const token = tokenFromResponse({
      access_token: jwt({ iat: Math.floor(before / 1000) - 300, exp }),
      expires_in: 3600,
    })

    // ~3300s, not the 3600s expires_in advertises.
    expect(Math.round(token.expireTimeMs / 1000)).toBeLessThanOrEqual(3300)
    expect(Math.round(token.expireTimeMs / 1000)).toBeGreaterThan(3200)
    // Still a DURATION paired with obtainedAt, never an absolute timestamp.
    expect(token.obtainedAt).toBeGreaterThanOrEqual(before)
    expect(token.expireTimeMs).toBeLessThan(24 * 3600 * 1000)
  })

  test("falls back to expires_in for an opaque token", () => {
    expect(tokenFromResponse({ access_token: "access-xyz", expires_in: 3600 }).expireTimeMs).toBe(3600 * 1000)
  })

  test("reports no expiry when neither source says anything", () => {
    expect(tokenFromResponse({ access_token: "access-xyz" }).expireTimeMs).toBe(0)
  })
})
