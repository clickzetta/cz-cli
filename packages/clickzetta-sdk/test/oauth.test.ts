import { afterEach, describe, expect, test } from "bun:test"

import {
  exchangeAuthorizationCode,
  fetchUserInfo,
  refreshAccessToken,
} from "../src/auth/oauth.js"
import { OAUTH_REDIRECT_URI, loopbackRedirectUri } from "../src/auth/oauth-constants.js"
import { InterfaceError } from "../src/types/errors.js"

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

// Distinctive sensitive values; used to assert error messages never leak them.
const SECRET_CODE = "super-secret-authorization-code-PLAINTEXT"
const SECRET_VERIFIER = "super-secret-code-verifier-PLAINTEXT"
const SECRET_REFRESH = "super-secret-refresh-token-PLAINTEXT"
const SECRET_ACCESS = "super-secret-access-token-PLAINTEXT"

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

describe("exchangeAuthorizationCode", () => {
  // Validates: Requirements 4.1, 4.2, 4.3, 10.9
  test("POSTs form-urlencoded body to /oauth2/token and maps expires_in to ms", async () => {
    let requestUrl: string | undefined
    let method: string | undefined
    let contentType: string | undefined
    let payload: URLSearchParams | undefined

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      method = init?.method
      contentType = new Headers(init?.headers).get("content-type") ?? undefined
      payload = new URLSearchParams(String(init?.body))
      return jsonResponse({
        access_token: "oauth-access-token",
        refresh_token: "oauth-refresh-token",
        token_type: "Bearer",
        expires_in: 900,
      })
    }) as typeof fetch

    const result = await exchangeAuthorizationCode(
      "https://service.example.com",
      "auth-code-1",
      "verifier-1",
      OAUTH_REDIRECT_URI,
    )

    expect(requestUrl).toBe("https://service.example.com/clickzetta-hornhub/oauth2/token")
    expect(method).toBe("POST")
    expect(contentType).toContain("application/x-www-form-urlencoded")

    expect(payload?.get("grant_type")).toBe("authorization_code")
    expect(payload?.get("code")).toBe("auth-code-1")
    expect(payload?.get("client_id")).toBe("official-cli")
    expect(payload?.get("redirect_uri")).toBe(OAUTH_REDIRECT_URI)
    expect(payload?.get("code_verifier")).toBe("verifier-1")

    expect(result.accessToken).toBe("oauth-access-token")
    expect(result.refreshToken).toBe("oauth-refresh-token")
    expect(result.tokenType).toBe("Bearer")
    expect(result.expiresInMs).toBe(900_000)
  })

  // Validates: Requirements 10.8, 10.9 (Property 11)
  test("sends the caller-supplied dynamic loopback redirect_uri verbatim", async () => {
    let payload: URLSearchParams | undefined

    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      payload = new URLSearchParams(String(init?.body))
      return jsonResponse({
        access_token: "oauth-access-token",
        token_type: "Bearer",
        expires_in: 900,
      })
    }) as typeof fetch

    const dynamicRedirectUri = loopbackRedirectUri(54321)
    await exchangeAuthorizationCode(
      "https://service.example.com",
      "auth-code-2",
      "verifier-2",
      dynamicRedirectUri,
    )

    expect(dynamicRedirectUri).toBe("http://127.0.0.1:54321/callback")
    expect(payload?.get("redirect_uri")).toBe(dynamicRedirectUri)
  })

  // Validates: Requirements 7.4, 7.6 (Property 7)
  test("rejects with InterfaceError on invalid_grant without leaking sensitive values", async () => {
    globalThis.fetch = (async () =>
      jsonResponse({ error: "invalid_grant", error_description: "code expired" }, 400)) as typeof fetch

    const promise = exchangeAuthorizationCode(
      "https://service.example.com",
      SECRET_CODE,
      SECRET_VERIFIER,
      OAUTH_REDIRECT_URI,
    )

    await expect(promise).rejects.toBeInstanceOf(InterfaceError)

    const err = await promise.catch((e) => e as Error)
    expect(err.message).not.toContain(SECRET_CODE)
    expect(err.message).not.toContain(SECRET_VERIFIER)
  })

  // Validates: Requirements 7.1, 7.6
  test("rejects with InterfaceError on invalid_request", async () => {
    globalThis.fetch = (async () =>
      jsonResponse({ error: "invalid_request" }, 400)) as typeof fetch

    await expect(
      exchangeAuthorizationCode("https://service.example.com", SECRET_CODE, SECRET_VERIFIER, OAUTH_REDIRECT_URI),
    ).rejects.toBeInstanceOf(InterfaceError)
  })

  // Validates: Requirements 7.2, 7.6
  test("rejects with InterfaceError on invalid_client", async () => {
    globalThis.fetch = (async () =>
      jsonResponse({ error: "invalid_client" }, 401)) as typeof fetch

    await expect(
      exchangeAuthorizationCode("https://service.example.com", SECRET_CODE, SECRET_VERIFIER, OAUTH_REDIRECT_URI),
    ).rejects.toBeInstanceOf(InterfaceError)
  })

  // Validates: Requirements 7.3, 7.6
  test("rejects with InterfaceError on invalid_scope", async () => {
    globalThis.fetch = (async () =>
      jsonResponse({ error: "invalid_scope" }, 400)) as typeof fetch

    await expect(
      exchangeAuthorizationCode("https://service.example.com", SECRET_CODE, SECRET_VERIFIER, OAUTH_REDIRECT_URI),
    ).rejects.toBeInstanceOf(InterfaceError)
  })
})

describe("refreshAccessToken", () => {
  // Validates: Requirements 5.2, 5.3
  test("POSTs grant_type=refresh_token and returns rotated tokens", async () => {
    let requestUrl: string | undefined
    let method: string | undefined
    let contentType: string | undefined
    let payload: URLSearchParams | undefined

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      method = init?.method
      contentType = new Headers(init?.headers).get("content-type") ?? undefined
      payload = new URLSearchParams(String(init?.body))
      return jsonResponse({
        access_token: "rotated-access-token",
        refresh_token: "rotated-refresh-token",
        token_type: "Bearer",
        expires_in: 600,
      })
    }) as typeof fetch

    const result = await refreshAccessToken("https://service.example.com", "old-refresh-token")

    expect(requestUrl).toBe("https://service.example.com/clickzetta-hornhub/oauth2/token")
    expect(method).toBe("POST")
    expect(contentType).toContain("application/x-www-form-urlencoded")

    expect(payload?.get("grant_type")).toBe("refresh_token")
    expect(payload?.get("refresh_token")).toBe("old-refresh-token")
    expect(payload?.get("client_id")).toBe("official-cli")

    expect(result.accessToken).toBe("rotated-access-token")
    expect(result.refreshToken).toBe("rotated-refresh-token")
    expect(result.expiresInMs).toBe(600_000)
  })

  // Validates: Requirements 5.4, 7.4, 7.6 (Property 7)
  test("rejects with InterfaceError on invalid_grant without leaking the refresh token", async () => {
    globalThis.fetch = (async () =>
      jsonResponse({ error: "invalid_grant" }, 400)) as typeof fetch

    const promise = refreshAccessToken("https://service.example.com", SECRET_REFRESH)

    await expect(promise).rejects.toBeInstanceOf(InterfaceError)

    const err = await promise.catch((e) => e as Error)
    expect(err.message).not.toContain(SECRET_REFRESH)
  })
})

describe("fetchUserInfo", () => {
  // Validates: Requirements 6.1, 6.2
  test("GETs /oauth2/userinfo with Bearer header and returns the user info object", async () => {
    let requestUrl: string | undefined
    let method: string | undefined
    let authHeader: string | undefined

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      method = init?.method ?? "GET"
      authHeader = new Headers(init?.headers).get("authorization") ?? undefined
      return jsonResponse({ sub: "user-7", name: "Alice", instance: "inst" })
    }) as typeof fetch

    const info = await fetchUserInfo("https://service.example.com", "the-access-token")

    expect(requestUrl).toBe("https://service.example.com/clickzetta-hornhub/oauth2/userinfo")
    expect(method).toBe("GET")
    expect(authHeader).toBe("Bearer the-access-token")
    expect(info.sub).toBe("user-7")
    expect(info.name).toBe("Alice")
  })

  // Validates: Requirements 6.4, 7.5, 7.6 (Property 7)
  test("rejects with InterfaceError on invalid_token without leaking the access token", async () => {
    globalThis.fetch = (async () =>
      jsonResponse({ error: "invalid_token" }, 401)) as typeof fetch

    const promise = fetchUserInfo("https://service.example.com", SECRET_ACCESS)

    await expect(promise).rejects.toBeInstanceOf(InterfaceError)

    const err = await promise.catch((e) => e as Error)
    expect(err.message).not.toContain(SECRET_ACCESS)
  })
})

describe("loopbackRedirectUri", () => {
  // Validates: Requirements 10.2, 10.9
  test("builds the loopback redirect_uri from the listening port", () => {
    expect(loopbackRedirectUri(54321)).toBe("http://127.0.0.1:54321/callback")
    expect(loopbackRedirectUri(8080)).toBe("http://127.0.0.1:8080/callback")
  })
})
