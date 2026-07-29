import { AuthorizationResponseError, ResponseBodyError, WWWAuthenticateChallengeError } from "openid-client"

import { InterfaceError, OAUTH_ERROR_SEMANTICS } from "@clickzetta/sdk"

/**
 * Translate an `openid-client` failure into the same {@link InterfaceError} shape
 * the SDK's hand-rolled OAuth client produced, so the CLI's user-facing error
 * codes and message template do not change when the transport does.
 *
 * Only the LOGIN side needs this. Token refresh still goes through the SDK's own
 * `refreshAccessToken`, which already puts the bare OAuth code on `.code` —
 * `token.ts`'s REFRESH_TOKEN_DEAD detection is untouched by this file.
 *
 * The library puts the OAuth error code in a different place per error class,
 * and never on `.code` (which carries a library constant like
 * `OAUTH_RESPONSE_BODY_ERROR`). Shapes below are what the library actually
 * throws, verified against a local server:
 *
 *   ResponseBodyError (token endpoint 400)
 *     .error = "invalid_grant", .error_description, .status = 400
 *   WWWAuthenticateChallengeError (userinfo 401)
 *     .error is undefined; the code lives in
 *     .cause[0].parameters.error / .error_description, .status = 401
 *   AuthorizationResponseError (error params on the redirect)
 *     .error / .error_description
 *
 * Never interpolate request inputs (code, code_verifier, tokens) into the
 * message. `ResponseBodyError.cause` holds the parsed response body and
 * `.response` the whole `Response`, so this deliberately reads only the two
 * known-safe fields rather than stringifying the error (design Property 7).
 */
export function toInterfaceError(err: unknown, requestId: string): InterfaceError {
  const { code, description, status } = extract(err)
  return interfaceError(code, description, status, requestId)
}

/**
 * Same message template, for an OAuth error we read out of a response body
 * ourselves rather than receiving as a thrown library error — the userinfo call
 * hands back a raw `Response` (we want the body verbatim), so a body-only error
 * response never becomes a `ResponseBodyError`.
 */
export function oauthBodyError(
  body: Record<string, unknown>,
  status: number,
  requestId: string,
): InterfaceError {
  return interfaceError(str(body.error) ?? "oauth_error", str(body.error_description), status, requestId)
}

function interfaceError(
  code: string,
  description: string | undefined,
  status: number,
  requestId: string,
): InterfaceError {
  const semantics = OAUTH_ERROR_SEMANTICS[code] ?? "the OAuth request failed"
  const detail = description ? `: ${description}` : ""
  return new InterfaceError(
    `OAuth request failed (${code}): ${semantics}${detail} (request id: ${requestId})`,
    { code, statusCode: status },
  )
}

function extract(err: unknown): { code: string; description?: string; status: number } {
  if (err instanceof ResponseBodyError) {
    return { code: err.error, description: str(err.error_description), status: err.status }
  }
  if (err instanceof WWWAuthenticateChallengeError) {
    // The OAuth code arrives inside the parsed WWW-Authenticate challenges, not
    // on the error itself.
    const params = (Array.isArray(err.cause) ? err.cause[0] : undefined)?.parameters
    return {
      code: str(params?.error) ?? "oauth_error",
      description: str(params?.error_description),
      status: err.status,
    }
  }
  if (err instanceof AuthorizationResponseError) {
    return { code: err.error, description: str(err.error_description), status: 400 }
  }
  // ClientError / network / anything else: no OAuth code to report. Keep the
  // library's own message as the detail — it describes the request problem, and
  // the library never puts credentials in it.
  return { code: "oauth_error", description: err instanceof Error ? err.message : undefined, status: 0 }
}

function str(val: unknown): string | undefined {
  return typeof val === "string" && val.length > 0 ? val : undefined
}
