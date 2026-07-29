import { describe, expect, test } from "bun:test"

import { AuthorizationResponseError, ClientError, ResponseBodyError, WWWAuthenticateChallengeError } from "openid-client"

import { InterfaceError } from "@clickzetta/sdk"
import { toInterfaceError } from "../src/commands/oauth-error"

const REQUEST_ID = "tssdk-oauth-abc123def456"

// Distinctive sensitive values, mirroring oauth.test.ts's *_PLAINTEXT sentinels.
// The library's error objects RETAIN the request/response (ResponseBodyError
// keeps the parsed body on .cause and the whole Response on .response), so a
// naive String(err) or spreading the error into a log would leak them. These
// sentinels are planted in exactly those places.
const SECRET_CODE = "super-secret-authorization-code-PLAINTEXT"
const SECRET_VERIFIER = "super-secret-code-verifier-PLAINTEXT"
const SECRET_ACCESS = "super-secret-access-token-PLAINTEXT"

function responseBodyError(body: Record<string, unknown>, status: number): ResponseBodyError {
  return new ResponseBodyError("server responded with an error in the response body", {
    cause: body as never,
    response: new Response(JSON.stringify(body), { status }),
  })
}

describe("toInterfaceError", () => {
  // The token endpoint's 400 is the common failure (expired/replayed code, or a
  // redirect_uri that does not match). The CLI's error code must stay the bare
  // OAuth code, not the library's OAUTH_RESPONSE_BODY_ERROR constant.
  test("ResponseBodyError carrying invalid_grant becomes an InterfaceError coded invalid_grant", () => {
    const err = toInterfaceError(
      responseBodyError(
        {
          error: "invalid_grant",
          error_description: "The provided authorization grant or refresh token is invalid.",
        },
        400,
      ),
      REQUEST_ID,
    )

    expect(err).toBeInstanceOf(InterfaceError)
    expect(err.code).toBe("invalid_grant")
    expect(err.statusCode).toBe(400)
    // Message template is byte-compatible with the SDK's oauthError():
    // "OAuth request failed (<code>): <semantics><detail> (request id: <id>)"
    expect(err.message).toBe(
      "OAuth request failed (invalid_grant): the authorization grant is invalid, expired, or already used" +
        ": The provided authorization grant or refresh token is invalid." +
        ` (request id: ${REQUEST_ID})`,
    )
  })

  // The semantics table is reused from the SDK rather than re-typed, so every
  // code the hand-rolled client explained keeps its explanation.
  test("reuses the SDK semantics table for the other OAuth codes", () => {
    for (const [code, semantics] of [
      ["invalid_request", "the OAuth request was malformed (missing or invalid parameters)"],
      ["invalid_client", "the OAuth client configuration is missing or invalid"],
      ["invalid_scope", "the requested OAuth scope was rejected"],
      ["invalid_token", "the access token is invalid or expired"],
    ] as const) {
      const err = toInterfaceError(responseBodyError({ error: code }, 400), REQUEST_ID)
      expect(err.code).toBe(code)
      expect(err.message).toContain(semantics)
    }
  })

  // A userinfo 401 arrives as WWWAuthenticateChallengeError, NOT
  // ResponseBodyError, and the OAuth code sits in cause[0].parameters — reading
  // `.error` there yields undefined.
  test("WWWAuthenticateChallengeError reads the code out of the parsed challenge", () => {
    const err = toInterfaceError(
      new WWWAuthenticateChallengeError("server responded with a challenge in the WWW-Authenticate HTTP Header", {
        cause: [
          {
            scheme: "bearer",
            parameters: { error: "invalid_token", error_description: "expired" },
          },
        ] as never,
        response: new Response(null, { status: 401 }),
      }),
      REQUEST_ID,
    )

    expect(err.code).toBe("invalid_token")
    expect(err.statusCode).toBe(401)
    expect(err.message).toContain("the access token is invalid or expired")
    expect(err.message).toContain(": expired")
  })

  test("AuthorizationResponseError maps its error param", () => {
    const err = toInterfaceError(
      new AuthorizationResponseError("authorization response from the server is an error", {
        cause: new URLSearchParams({ error: "invalid_request", error_description: "missing code_challenge" }),
      }),
      REQUEST_ID,
    )

    expect(err.code).toBe("invalid_request")
    expect(err.message).toContain("missing code_challenge")
  })

  // ClientError and plain network failures carry no OAuth code; they must not
  // fabricate one, and must still produce a usable message.
  test("ClientError and unknown errors fall back to oauth_error", () => {
    const clientErr = toInterfaceError(new ClientError("failed to fetch server metadata"), REQUEST_ID)
    expect(clientErr.code).toBe("oauth_error")
    expect(clientErr.message).toContain("the OAuth request failed")
    expect(clientErr.message).toContain("failed to fetch server metadata")
    expect(clientErr.message).toContain(`(request id: ${REQUEST_ID})`)

    const netErr = toInterfaceError(new TypeError("fetch failed"), REQUEST_ID)
    expect(netErr.code).toBe("oauth_error")
    expect(netErr.message).toContain("fetch failed")

    // Non-Error throwables must not crash the adapter.
    expect(toInterfaceError("boom", REQUEST_ID).code).toBe("oauth_error")
  })

  // Property 7: the message must never carry credentials, even though the
  // library error object still holds the request body and the Response.
  test("never leaks the code, verifier, or access token held on the error object", () => {
    const tokenErr = toInterfaceError(
      responseBodyError(
        {
          error: "invalid_grant",
          error_description: "code expired",
          // A server that echoes inputs back would put them right here, on
          // the object the adapter is handed.
          code: SECRET_CODE,
          code_verifier: SECRET_VERIFIER,
        },
        400,
      ),
      REQUEST_ID,
    )

    expect(tokenErr.message).not.toContain(SECRET_CODE)
    expect(tokenErr.message).not.toContain(SECRET_VERIFIER)
    expect(tokenErr.message).not.toContain("PLAINTEXT")

    const userinfoErr = toInterfaceError(
      new WWWAuthenticateChallengeError("challenge", {
        cause: [
          { scheme: "bearer", parameters: { error: "invalid_token", access_token: SECRET_ACCESS } },
        ] as never,
        response: new Response(null, { status: 401 }),
      }),
      REQUEST_ID,
    )

    expect(userinfoErr.message).not.toContain(SECRET_ACCESS)
    expect(userinfoErr.message).not.toContain("PLAINTEXT")
  })
})
