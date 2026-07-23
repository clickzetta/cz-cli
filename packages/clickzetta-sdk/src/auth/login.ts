import { type ClientOptions } from "../client.js"
import { ClickZettaApiError, type ApiResponse } from "../types/api.js"
import { InterfaceError } from "../types/errors.js"
import type { AuthToken } from "../types/index.js"
import { generatePkce } from "./pkce.js"
import { exchangeAuthorizationCode } from "./oauth.js"
import { OAUTH_REDIRECT_URI } from "./oauth-constants.js"
import { buildOauthLoginParam } from "./oauth-login-param.js"

interface LoginResponse {
  token: string
  instanceId: number
  userId: number
  expireTime: number
  authorizationCode?: string
}

// Mirrors Python connector login loop at client.py:296-392:
// max 5 retries (6 attempts total), backoff = min(2^n * 0.1, 2) seconds,
// 10s per-attempt timeout.
const LOGIN_MAX_RETRIES = 5
const LOGIN_TIMEOUT_MS = 10_000

function loginBackoffMs(attempt: number): number {
  // attempt is 1-based: 1 → 200ms, 2 → 400ms, 3 → 800ms, 4 → 1600ms, 5 → 2000ms
  return Math.min(2 ** attempt * 100, 2000)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Detect the instance-configuration error the Lakehouse gateway returns
 * when the instance name is unknown. Python checks both the Chinese and
 * English forms (client.py:310).
 */
function instanceConfigError(serverMessage: unknown, instance: string): string | undefined {
  const msg = typeof serverMessage === "string" ? serverMessage : ""
  if (!msg) return undefined
  if (msg.includes("没有这样的元素") || msg.includes("No such element")) {
    return `instance name '${instance}' is invalid or not found. Please check your \`instance\` configuration. server error:${msg}`
  }
  return undefined
}

/**
 * Generate a request id matching the Python connector format
 * (`pysdk-v{version}-{uuid12}`, client.py:305). Carried in the `requestId`
 * header so gateway logs can correlate login attempts.
 */
function generateRequestId(): string {
  const hex = Array.from(crypto.getRandomValues(new Uint8Array(6)))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
  return `tssdk-login-${hex}`
}

async function postLogin(
  baseUrl: string,
  body: unknown,
  requestId: string,
): Promise<ApiResponse<LoginResponse>> {
  const url = `${baseUrl}/clickzetta-portal/user/loginSingle`
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json, text/plain, */*",
      "requestId": requestId,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(LOGIN_TIMEOUT_MS),
  })
  const text = await resp.text()
  if (!resp.ok) {
    // Throw something the outer retry loop can inspect for instance errors.
    throw new ClickZettaApiError(
      `HTTP_${resp.status}`,
      `HTTP ${resp.status}: ${text.slice(0, 500)} (request id: ${requestId})`,
      resp.status,
    )
  }
  if (!text) {
    throw new ClickZettaApiError("AUTH_FAILED", `Login returned empty body (request id: ${requestId})`)
  }
  try {
    return JSON.parse(text) as ApiResponse<LoginResponse>
  } catch {
    throw new ClickZettaApiError("AUTH_FAILED", `Login returned invalid JSON: ${text.slice(0, 200)} (request id: ${requestId})`)
  }
}

async function loginWithRetry(
  baseUrl: string,
  body: Record<string, unknown>,
  instance: string,
  oauth: boolean,
): Promise<AuthToken> {
  let lastError: Error | undefined
  // client.py:305 — one request id for the entire login attempt sequence
  const requestId = generateRequestId()

  // The three login methods (PAT, password, browser OAuth) are independent.
  // PAT and password logins are plain credential exchanges and must NOT carry
  // `oauthLoginParam` — portals that don't implement OAuth authorization-code
  // login reject the whole request (business code 5014, "missing required
  // parameter or otherwise malformed"). `oauthLoginParam` is attached ONLY when
  // the caller explicitly opts into the OAuth upgrade (`oauth === true`).
  //
  // PKCE is generated once per login sequence; codeVerifier stays in memory
  // only and is never logged. codeChallenge is sent to the portal so the
  // gateway can later validate the matching verifier at /oauth2/token.
  const pkce = oauth ? generatePkce() : undefined
  const loginBody = pkce
    ? {
        ...body,
        oauthLoginParam: buildOauthLoginParam({
          redirectUri: OAUTH_REDIRECT_URI,
          codeChallenge: pkce.codeChallenge,
        }),
      }
    : body

  for (let attempt = 0; attempt <= LOGIN_MAX_RETRIES; attempt++) {
    try {
      const resp = await postLogin(baseUrl, loginBody, requestId)
      if (resp.code !== 0 && resp.code !== "0" && resp.code !== 200 && resp.code !== "200") {
        const serverMsg = resp.message ?? ""
        const instErr = instanceConfigError(serverMsg, instance)
        if (instErr) throw new InterfaceError(instErr, { code: "INSTANCE_CONFIG_ERROR" })
        lastError = new ClickZettaApiError(
          "AUTH_FAILED",
          `Login failed: ${serverMsg || "unknown error"}`,
        )
      } else if (!resp.data?.token) {
        lastError = new ClickZettaApiError("AUTH_FAILED", "Login succeeded but no token returned")
      } else {
        const data = resp.data
        // OAuth path: a non-empty authorizationCode means the portal opted
        // into the code exchange. Only reachable when we sent PKCE (oauth ===
        // true); the guard keeps this correct even if a portal echoes a code
        // for a plain credential login. Swap the legacy token for the OAuth
        // tokens while keeping the portal-issued instanceId/userId.
        if (pkce && data.authorizationCode) {
          const oauth = await exchangeAuthorizationCode(baseUrl, data.authorizationCode, pkce.codeVerifier, OAUTH_REDIRECT_URI)
          return {
            token: oauth.accessToken,
            refreshToken: oauth.refreshToken,
            instanceId: data.instanceId,
            userId: data.userId,
            expireTimeMs: oauth.expiresInMs,
            obtainedAt: Date.now(),
          }
        }
        // Legacy path: no authorization code, keep the portal token as-is.
        return {
          token: data.token,
          instanceId: data.instanceId,
          userId: data.userId,
          expireTimeMs: data.expireTime,
          obtainedAt: Date.now(),
        }
      }
    } catch (err) {
      // InterfaceError from instanceConfigError must not be retried.
      if (err instanceof InterfaceError) throw err
      // An HTTP error may carry an instance-config error in its body;
      // surface it before giving up.
      if (err instanceof ClickZettaApiError && err.message) {
        const instErr = instanceConfigError(err.message, instance)
        if (instErr) throw new InterfaceError(instErr, { code: "INSTANCE_CONFIG_ERROR" })
      }
      lastError = err instanceof Error ? err : new Error(String(err))
    }

    if (attempt < LOGIN_MAX_RETRIES) {
      await sleep(loginBackoffMs(attempt + 1))
    }
  }

  throw lastError ?? new ClickZettaApiError("AUTH_FAILED", "Login failed after retries")
}

export async function loginWithPat(
  baseUrl: string,
  pat: string,
  instanceName: string,
  oauth = false,
): Promise<AuthToken> {
  return loginWithRetry(baseUrl, { accessToken: pat, instanceName }, instanceName, oauth)
}

export async function loginWithPassword(
  baseUrl: string,
  username: string,
  password: string,
  instanceName: string,
  oauth = false,
): Promise<AuthToken> {
  return loginWithRetry(
    baseUrl,
    { username, password, instanceName },
    instanceName,
    oauth,
  )
}

// ClientOptions is imported only to keep the original public signature
// compatible; the login functions no longer go through `request()`.
export type { ClientOptions }
