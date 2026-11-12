import { spawn } from "node:child_process"

import * as p from "@clack/prompts"
import * as client from "openid-client"

import {
  OAUTH_CODE_CHALLENGE_METHOD,
  OAUTH_SCOPE,
  startLoopbackCallback,
  type AuthToken,
} from "@clickzetta/sdk"

import { toInterfaceError } from "./oauth-error.js"
import {
  collectUserInfo,
  discoverOAuthConfig,
  generateRequestId,
  tokenFromResponse,
  type OAuthLoginResult,
} from "./oauth-userinfo.js"
import { browserOpenCommandForPlatform, canOpenBrowser } from "../util/browser.js"

/**
 * Browser loopback OAuth login (authorization code + PKCE).
 *
 * Everything that happens AFTER an authorization is obtained — discovery, the
 * userinfo round trip, gatewayMapping parsing, the AuthToken shape — lives in
 * `oauth-userinfo.ts`, shared with the device-flow login in `login-device.ts`.
 * What stays here is specific to proving identity through a browser: the
 * loopback listener, PKCE, `state`, and the manual-paste fallback.
 */

/**
 * Generate a random hex `state` for CSRF protection of the authorize round
 * trip (requirement 10.3/10.6). It is used once for callback validation and is
 * not a secret.
 */
function randomState(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
}

/**
 * Best-effort cross-platform system browser opener (design Addendum 2, step 4).
 * Failures are swallowed: the authorize URL is already printed to the terminal so
 * the user can open it manually while the loopback listener keeps waiting
 * (requirement 10.5). Uses the shared opener rather than `start` through a shell:
 * the authorize URL always carries several `&`-joined parameters, which cmd.exe
 * would split into separate commands.
 */
function openSystemBrowser(url: string): void {
  const opener = browserOpenCommandForPlatform(process.platform, url)
  try {
    const child = spawn(opener.command, opener.args, { stdio: "ignore", detached: true })
    child.on("error", () => {})
    child.unref()
  } catch {
    // best-effort: ignore spawn failures, the URL was already printed
  }
}

export interface LoginWithBrowserOptions {
  // OAuth issuer base URL (toServiceUrl(entryHost, protocol)). Every endpoint —
  // authorize, token, userinfo — is discovered from it; the CLI never guesses a
  // sign-in host of its own.
  baseUrl: string
  // Injectable browser opener; defaults to the system browser. Tests inject a
  // fake that drives the loopback callback.
  openBrowser?: (url: string) => void
  // Optional callback timeout in ms (forwarded to startLoopbackCallback).
  timeoutMs?: number
  // Whether a browser opened here reaches the user. Defaults to canOpenBrowser on
  // the real environment; false over SSH or without a display.
  browserAvailable?: boolean
  // Injectable prompt for the manual-paste fallback. Returns the redirect URL the
  // user copied out of the browser, or undefined if they cancelled / it is
  // non-interactive. Tests inject a fake; the default prompts on a TTY.
  promptManualUrl?: () => Promise<string | undefined>
}

/**
 * Extract the authorization code from a redirect URL the user pasted, validating
 * `state` exactly as the loopback listener would.
 *
 * Accepts a bare `code=…` query fragment as well as a full URL: people copy
 * inconsistently, and the failure mode of being strict here is a user who can
 * see their code but cannot get it in.
 */
export function codeFromPastedUrl(input: string, expectedState: string): string {
  const trimmed = input.trim()
  if (!trimmed) throw new Error("LOGIN_CANCELLED: no redirect URL was provided")

  let params: URLSearchParams
  try {
    params = new URL(trimmed).searchParams
  } catch {
    const query = trimmed.slice(trimmed.indexOf("?") + 1)
    params = new URLSearchParams(query)
  }

  const code = params.get("code") ?? params.get("authorizationCode")
  if (!code) {
    throw new Error(
      "LOGIN_FAILED: that URL carries no authorization code. Copy the full address bar contents after signing in.",
    )
  }
  const state = params.get("state")
  if (state !== expectedState) {
    throw new Error("LOGIN_FAILED: state mismatch in the pasted redirect URL — start a fresh login")
  }
  return code
}

/** Default TTY prompt for the pasted redirect URL. Non-TTY → undefined. */
async function defaultPromptManualUrl(): Promise<string | undefined> {
  if (!process.stdin.isTTY) return undefined
  const result = await p.text({
    message: "Paste the full redirect URL from your browser's address bar (or press Esc to abort):",
    placeholder: "http://127.0.0.1:1234/callback?authorizationCode=…&state=…",
  })
  if (p.isCancel(result)) return undefined
  return String(result).trim()
}

/**
 * Wait for the loopback redirect, falling back to manual paste if it never
 * arrives.
 *
 * The loopback flow assumes the browser can reach 127.0.0.1, which is not always
 * true — a proxy in TUN mode, a VPN, a firewall, or a headless/remote shell can
 * all swallow the redirect, and the code is then visible in the address bar but
 * unreachable by us. Rather than fail with only a timeout, offer the user the one
 * thing they can still do. The pasted URL goes through the same `state` check.
 */
async function waitForCodeWithManualFallback(
  cb: { waitForCode: () => Promise<string>; close: () => void },
  expectedState: string,
  promptManualUrl?: () => Promise<string | undefined>,
): Promise<string> {
  try {
    return await cb.waitForCode()
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    // Only a timeout means "the redirect never arrived". A state mismatch or a
    // malformed callback means one DID arrive and was rejected — prompting for a
    // paste there would invite the user to hand-carry the very request we just
    // refused, so those propagate untouched.
    if (!message.includes("timed out waiting for authorization callback")) throw err

    const prompt = promptManualUrl ?? defaultPromptManualUrl
    console.error(
      "\nThe browser never delivered the redirect to the local callback.\n" +
        "This usually means something between the browser and 127.0.0.1 dropped it — a proxy in TUN/enhanced mode, a VPN, or a firewall. " +
        "If you already signed in, the address bar still holds the code and you can finish by pasting it here.",
    )
    const pasted = await prompt()
    if (!pasted) throw err
    return codeFromPastedUrl(pasted, expectedState)
  } finally {
    cb.close()
  }
}

/**
 * Browser loopback OAuth login orchestration (design Addendum 2, component I;
 * requirements 10.1/10.5/10.8/10.10).
 *
 * Standard OAuth 2.0 authorization code + PKCE, driven by `openid-client`. Flow:
 * discover the server metadata from `opts.baseUrl` (RFC 8414) → generate PKCE +
 * state → start the loopback listener to learn the dynamic `redirect_uri` →
 * build the authorize URL from the DISCOVERED `authorization_endpoint` and open
 * the browser (also printing the URL) → wait for the validated `code` on the
 * loopback → exchange it using the SAME `redirect_uri` (Property 11). On any
 * failure the listener is closed so it never leaks. Never logs `code_verifier`,
 * the authorization code, or tokens — printing the authorize URL is fine since
 * it only carries `code_challenge` + `state`.
 *
 * Note the deliberate asymmetry with token refresh: LOGIN is discovery-driven
 * (RFC 8414 exists to bootstrap a client that does not yet know the server),
 * while REFRESH stays convention-driven in the SDK (`OAUTH_PATH_PREFIX`). By
 * refresh time the issuer was already recorded at login, so a discovery round
 * trip on every expired-token command would buy nothing — each CLI invocation is
 * a fresh process with no cross-process cache, so it would be a permanent cost.
 */
export async function loginWithBrowser(opts: LoginWithBrowserOptions): Promise<OAuthLoginResult> {
  const requestId = generateRequestId()
  const config = await discoverOAuthConfig(opts.baseUrl, requestId)
  const meta = config.serverMetadata()

  const codeVerifier = client.randomPKCECodeVerifier()
  const codeChallenge = await client.calculatePKCECodeChallenge(codeVerifier)
  const state = randomState()
  const cb = await startLoopbackCallback({ expectedState: state, timeoutMs: opts.timeoutMs })

  try {
    const authorizeUrl = client.buildAuthorizationUrl(config, {
      redirect_uri: cb.redirectUri,
      scope: OAUTH_SCOPE,
      code_challenge: codeChallenge,
      code_challenge_method: OAUTH_CODE_CHALLENGE_METHOD,
      state,
    })

    // Over SSH or without a display a launched browser lands somewhere the user
    // cannot see, and the redirect to 127.0.0.1 would reach that machine, not this
    // one. Say so up front, so the manual-paste fallback below is the expected
    // path rather than a surprise after a timeout.
    const local = opts.browserAvailable ?? canOpenBrowser(process.env, process.platform)
    console.log(
      local
        ? `Open this URL in your browser to sign in:\n${authorizeUrl.href}`
        : `No browser on this machine. Open this URL in a browser on your computer and sign in:\n${authorizeUrl.href}\n` +
            "The final page will not load (it points at this machine); copy its full address and paste it here.",
    )
    if (local) (opts.openBrowser ?? openSystemBrowser)(authorizeUrl.href)

    const code = await waitForCodeWithManualFallback(cb, state, opts.promptManualUrl)

    // `authorizationCodeGrant` wants the redirect URL, but our listener (and the
    // manual-paste fallback) hands back a bare code string. Synthesize the URL
    // from `cb.redirectUri` rather than from the real request: it keeps both
    // paths converging here, and — critically — it preserves the PORT. The
    // library derives the token request's `redirect_uri` by stripping this URL's
    // query/hash, so it must be byte-identical to the one in the authorize URL
    // (RFC 6749 §4.1.3); a URL built from `req.url` against a portless origin
    // silently drops the port and the server answers `invalid_grant`.
    const callbackUrl = new URL(cb.redirectUri)
    callbackUrl.searchParams.set("code", code)
    // `state` is re-attached so the library's own validateAuthResponse passes.
    // Our listener (callback-server.ts) already rejected any mismatch — this is
    // a deliberate second gate, not dead weight. Do NOT "optimize" it into
    // `skipStateCheck`: the paste fallback reaches the same code path, and one
    // check is one place to get wrong.
    callbackUrl.searchParams.set("state", state)
    if (meta.authorization_response_iss_parameter_supported) {
      callbackUrl.searchParams.set("iss", meta.issuer)
    }

    const tokens = await client
      .authorizationCodeGrant(config, callbackUrl, {
        pkceCodeVerifier: codeVerifier,
        expectedState: state,
      })
      .catch((err) => {
        throw toInterfaceError(err, requestId)
      })

    const token: AuthToken = tokenFromResponse(tokens)
    const context = await collectUserInfo(config, meta.userinfo_endpoint, token, requestId)

    return { token, ...context }
  } catch (err) {
    // Ensure the listener never leaks if we fail before/after waitForCode
    // settles. close() is a no-op once the core already settled.
    cb.close()
    throw err
  }
}
