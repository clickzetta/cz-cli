import { createHash } from "node:crypto"

export interface Pkce {
  codeVerifier: string
  codeChallenge: string // base64url(SHA-256(codeVerifier)), no padding
}

// base64url encode without padding: '+'→'-', '/'→'_', strip '='.
function base64Url(input: Buffer): string {
  return input.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "")
}

// Generate RFC 7636 PKCE parameters.
// 64 random bytes → 86 base64url chars, comfortably within the [43,128] range,
// and base64url already yields only unreserved characters [A-Za-z0-9-._~].
export function generatePkce(): Pkce {
  const bytes = new Uint8Array(64)
  crypto.getRandomValues(bytes)
  const codeVerifier = base64Url(Buffer.from(bytes))
  const codeChallenge = base64Url(createHash("sha256").update(codeVerifier).digest())
  return { codeVerifier, codeChallenge }
}
