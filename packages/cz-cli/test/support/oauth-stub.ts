/**
 * The primitives every OAuth login test needs, and nothing else.
 *
 * The three OAuth test files (login-browser, login-device, device-account-select)
 * each drive a different flow, so their URL routing, discovery documents and
 * userinfo fixtures are deliberately NOT shared: the browser file's discovery doc
 * puts authorize on a foreign host as a regression guard, the device file's omits
 * `device_authorization_endpoint` in one variant on purpose, and merging them into
 * one configurable harness would trade three readable stubs for one that has to be
 * decoded before any test in any of them can be read. What IS shared lives here —
 * the two response requirements `openid-client` imposes, and the global-fetch
 * lifecycle.
 *
 * These tests replace `globalThis.fetch` outright rather than registering a
 * handler with ./fetch-boundary, because `openid-client` reads `fetch` off the
 * global at call time and each flow needs to assert on the exact request sequence,
 * including requests that must NOT happen. While a stub is installed the boundary
 * is bypassed, so a test in these files cannot also use `onFetch`/`onPath` — one
 * mechanism per file.
 *
 * That makes {@link restoreFetch} load-bearing beyond tidiness: `bun test
 * --isolate` gives each file a fresh module registry but ONE shared `globalThis`,
 * so a stub left installed is still installed when the next file runs, and that
 * file's boundary handlers never see its requests — they leave for the real
 * network and fail as timeouts, in a file that looks unrelated to this one.
 */

const realFetch = globalThis.fetch

/**
 * Build a JSON response with the explicit content-type `openid-client` demands on
 * every response it parses — a body without it fails as a protocol error rather
 * than as a wrong value, which reads like a bug in the code under test.
 */
export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })
}

/**
 * A token endpoint response the library accepts. `token_type` must be present and
 * case-insensitively "bearer" or it throws UnsupportedOperationError, so a test
 * that only cares about the access token still has to carry it.
 */
export const TOKEN_RESPONSE = {
  access_token: "access-xyz",
  refresh_token: "refresh-xyz",
  expires_in: 3600,
  token_type: "Bearer",
}

/**
 * Install a fetch stub for the current test. Pair it with {@link restoreFetch} in
 * the importing file's own `afterEach`: the hook has to be registered by the test
 * file itself, because a module-scope hook here would attach to whichever file
 * happened to evaluate this module first and silently not cover the others.
 */
export function stubGlobalFetch(
  handler: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
): void {
  globalThis.fetch = handler as typeof fetch
}

/** Put the pre-stub `fetch` back. Call from the importing file's `afterEach`. */
export function restoreFetch(): void {
  globalThis.fetch = realFetch
}
