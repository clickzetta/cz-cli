export const OAUTH_CLIENT_ID = "official-cli"
export const OAUTH_REDIRECT_URI = "http://127.0.0.1/callback"
export const OAUTH_SCOPE = "openid profile offline_access"
export const OAUTH_CODE_CHALLENGE_METHOD = "S256"

/**
 * Gateway service-path prefix the OAuth endpoints are mounted under. Through
 * the API gateway the hornhub service lives at `/clickzetta-hornhub` (mirroring
 * how login lives under `/clickzetta-portal`); the OAuth `/oauth2/*` endpoints
 * must be addressed as `${baseUrl}/clickzetta-hornhub/oauth2/*`. Hitting the
 * bare `/oauth2/*` at the gateway root reaches a different handler.
 */
export const OAUTH_PATH_PREFIX = "/clickzetta-hornhub"

/**
 * Build the loopback redirect_uri for the browser flow using the actual
 * listening port. The gateway ignores the port when validating
 * `127.0.0.1` redirect URIs, so a dynamic port is acceptable.
 */
export function loopbackRedirectUri(port: number): string {
  return `http://127.0.0.1:${port}/callback`
}
