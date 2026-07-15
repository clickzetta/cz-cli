import { OAUTH_CLIENT_ID, OAUTH_PATH_PREFIX } from "./oauth-constants.js"
import { InterfaceError } from "../types/errors.js"

export interface OAuthTokenResult {
  accessToken: string
  refreshToken?: string
  expiresInMs: number
  tokenType: string
}

/**
 * Human-readable semantics for the OAuth error codes the gateway returns.
 * These are static strings only — never interpolate request inputs
 * (`code`, `code_verifier`, `refresh_token`, `access_token`) so error
 * messages and logs cannot leak sensitive values (design Property 7,
 * requirement 7.6).
 */
const OAUTH_ERROR_SEMANTICS: Record<string, string> = {
  invalid_request: "the OAuth request was malformed (missing or invalid parameters)",
  invalid_client: "the OAuth client configuration is missing or invalid",
  invalid_scope: "the requested OAuth scope was rejected",
  invalid_grant: "the authorization grant is invalid, expired, or already used",
  invalid_token: "the access token is invalid or expired",
}

/**
 * Generate a request id carried on the `requestId` header so gateway logs
 * can correlate OAuth calls (requirement 7.7). The value is random hex and
 * contains no sensitive material.
 */
function generateRequestId(): string {
  const hex = Array.from(crypto.getRandomValues(new Uint8Array(6)))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
  return `tssdk-oauth-${hex}`
}

/**
 * Debug switch shared with the callback server. When `CZ_OAUTH_DEBUG` is
 * "1"/"true", token requests log their grant type + param keys and the raw
 * response so integration mismatches can be inspected. Opt-in only.
 */
function isOauthDebug(): boolean {
  const flag = process.env.CZ_OAUTH_DEBUG
  return flag === "1" || flag === "true"
}

/**
 * Build an {@link InterfaceError} (auth-layer failure) from an OAuth error
 * code. The message exposes the error code, its semantics, and the server's
 * `error_description` (which describes the request problem, not a secret), but
 * never the caller-supplied credentials.
 */
function oauthError(
  error: string | undefined,
  status: number,
  requestId: string,
  description?: string,
): InterfaceError {
  const code = error ?? "oauth_error"
  const semantics = OAUTH_ERROR_SEMANTICS[code] ?? "the OAuth request failed"
  const detail = description ? `: ${description}` : ""
  return new InterfaceError(
    `OAuth request failed (${code}): ${semantics}${detail} (request id: ${requestId})`,
    { code, statusCode: status },
  )
}

async function requestToken(baseUrl: string, params: URLSearchParams): Promise<OAuthTokenResult> {
  const requestId = generateRequestId()
  const tokenUrl = `${baseUrl}${OAUTH_PATH_PREFIX}/oauth2/token`
  if (isOauthDebug()) {
    console.error(
      `[oauth-token] POST ${tokenUrl} grant=${params.get("grant_type")} params=[${Array.from(params.keys()).join(",")}]`,
    )
  }
  const resp = await fetch(tokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Accept": "application/json",
      "requestId": requestId,
    },
    body: params.toString(),
  })

  const body = (await resp.json()) as Record<string, unknown>
  if (isOauthDebug()) {
    console.error(`[oauth-token] status=${resp.status} returned=[${Object.keys(body).join(",")}]`)
    if (typeof body.error === "string") {
      console.error(`[oauth-token] error=${body.error} error_description=${String(body.error_description ?? "")}`)
    }
  }
  if (!resp.ok || typeof body.error === "string") {
    throw oauthError(
      typeof body.error === "string" ? body.error : undefined,
      resp.status,
      requestId,
      typeof body.error_description === "string" ? body.error_description : undefined,
    )
  }

  return {
    accessToken: String(body.access_token),
    refreshToken: typeof body.refresh_token === "string" ? body.refresh_token : undefined,
    expiresInMs: typeof body.expires_in === "number" ? body.expires_in * 1000 : 0,
    tokenType: typeof body.token_type === "string" ? body.token_type : "Bearer",
  }
}

/**
 * Exchange an authorization code for tokens (`grant_type=authorization_code`).
 * The `redirectUri` is supplied by the caller so it matches the value used to
 * obtain the code (a fixed loopback for the credential path, or a dynamic
 * loopback port for the browser flow).
 */
export function exchangeAuthorizationCode(
  baseUrl: string,
  code: string,
  codeVerifier: string,
  redirectUri: string,
): Promise<OAuthTokenResult> {
  return requestToken(
    baseUrl,
    new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: OAUTH_CLIENT_ID,
      redirect_uri: redirectUri,
      code_verifier: codeVerifier,
    }),
  )
}

/**
 * Rotate tokens using a refresh token (`grant_type=refresh_token`).
 */
export function refreshAccessToken(
  baseUrl: string,
  refreshToken: string,
): Promise<OAuthTokenResult> {
  return requestToken(
    baseUrl,
    new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: OAUTH_CLIENT_ID,
    }),
  )
}

/**
 * Fetch the OpenID userinfo for an access token. Failures (e.g.
 * `invalid_token`) surface as {@link InterfaceError} without leaking the
 * token value.
 */
export async function fetchUserInfo(
  baseUrl: string,
  accessToken: string,
): Promise<Record<string, unknown>> {
  const requestId = generateRequestId()
  const resp = await fetch(`${baseUrl}${OAUTH_PATH_PREFIX}/oauth2/userinfo`, {
    method: "GET",
    headers: {
      "Authorization": `Bearer ${accessToken}`,
      "Accept": "application/json",
      "requestId": requestId,
    },
  })

  const body = (await resp.json()) as Record<string, unknown>
  if (!resp.ok || typeof body.error === "string") {
    throw oauthError(typeof body.error === "string" ? body.error : undefined, resp.status, requestId)
  }

  return body
}
