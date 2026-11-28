/**
 * Read a JWT's payload without verifying it.
 *
 * Verification is the server's job — we hold the token, not the signing key, and
 * everything read here is used only to describe a credential we were handed
 * (when it expires, who it belongs to). Never use these claims to decide
 * whether a request is authorized.
 *
 * Returns `{}` for anything unparseable, so callers fall back to whatever the
 * transport told them rather than failing on an opaque token.
 */
export function parseJwtPayload(token: string): Record<string, unknown> {
  const payload = token.split(".")[1]
  if (!payload) return {}
  try {
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf-8")) as Record<string, unknown>
  } catch {
    return {}
  }
}

/**
 * How long a token is still good for, in ms, measured against the `exp` claim
 * the SERVER will enforce.
 *
 * `expires_in` from a token endpoint is the token's TOTAL lifetime, counted from
 * when the server issued it — not from when we received it. In the device flow
 * those two moments are minutes apart: the gateway issues the token when the
 * user finishes on the verification page, and the CLI only picks it up on a
 * later poll. Storing `expires_in` against our own receipt time therefore dates
 * the token forward by exactly that gap, spending it out of the margin
 * isTokenExpired keeps (EXPIRED_FACTOR 0.8) and moving the refresh that much
 * closer to the server's own deadline than intended.
 *
 * So prefer `exp`, which is the same instant the server compares against, and
 * fall back to `expires_in` only for an opaque token that carries no claim.
 * Returns undefined when there is no usable `exp`.
 */
export function msUntilJwtExpiry(token: string, now: number = Date.now()): number | undefined {
  const exp = parseJwtPayload(token).exp
  if (typeof exp !== "number" || !Number.isFinite(exp) || exp <= 0) return undefined
  // Floored at 1ms, NOT at 0. A negative duration would read as far-future
  // validity, but 0 is just as wrong in the other direction: the SDK's
  // isTokenExpired short-circuits on a falsy `expireTimeMs` and answers "not
  // expired", so an already-expired token stored as 0 would never be proactively
  // refreshed at all. 1ms is the smallest value that still means "expired".
  return Math.max(1, exp * 1000 - now)
}
