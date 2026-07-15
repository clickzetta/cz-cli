import { afterEach, describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"

import { loginWithPassword } from "../src/auth/login.js"

function base64Url(input: Buffer): string {
  return input.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "")
}

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

describe("OAuth login", () => {
  test("loginWithPassword sends oauthLoginParam and exchanges authorizationCode", async () => {
    let loginPayload: Record<string, unknown> | undefined
    let tokenPayload: URLSearchParams | undefined
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input))
      if (url.pathname === "/clickzetta-portal/user/loginSingle" && init?.method === "POST") {
        loginPayload = JSON.parse(String(init.body)) as Record<string, unknown>
        return new Response(JSON.stringify({
          code: 0,
          data: {
            token: "legacy-token",
            authorizationCode: "auth-code-1",
            userId: 7,
            instanceId: 9,
            expireTime: 123,
          },
        }), { status: 200, headers: { "content-type": "application/json" } })
      }
      if (url.pathname === "/clickzetta-hornhub/oauth2/token" && init?.method === "POST") {
        tokenPayload = new URLSearchParams(String(init.body))
        return new Response(JSON.stringify({
          access_token: "oauth-access-token",
          refresh_token: "oauth-refresh-token",
          token_type: "Bearer",
          expires_in: 900,
        }), { status: 200, headers: { "content-type": "application/json" } })
      }
      return new Response("not found", { status: 404 })
    }) as typeof fetch

    const token = await loginWithPassword("https://service.example.com", "user", "pass", "inst")

    const oauthLoginParam = loginPayload?.oauthLoginParam as Record<string, unknown>
    expect(loginPayload?.username).toBe("user")
    expect(loginPayload?.password).toBe("pass")
    expect(loginPayload?.instanceName).toBe("inst")
    expect(oauthLoginParam.oauthLogin).toBe(true)
    expect(oauthLoginParam.clientId).toBe("official-cli")
    expect(oauthLoginParam.redirectUri).toBe("http://127.0.0.1/callback")
    expect(oauthLoginParam.scope).toBe("openid profile offline_access")
    expect(oauthLoginParam.codeChallengeMethod).toBe("S256")

    const verifier = tokenPayload?.get("code_verifier") ?? ""
    expect(tokenPayload?.get("grant_type")).toBe("authorization_code")
    expect(tokenPayload?.get("code")).toBe("auth-code-1")
    expect(tokenPayload?.get("client_id")).toBe("official-cli")
    expect(tokenPayload?.get("redirect_uri")).toBe("http://127.0.0.1/callback")
    expect(oauthLoginParam.codeChallenge).toBe(base64Url(createHash("sha256").update(verifier).digest()))
    expect(token.token).toBe("oauth-access-token")
    expect(token.refreshToken).toBe("oauth-refresh-token")
    expect(token.expireTimeMs).toBe(900_000)
  })

  test("loginWithPassword keeps legacy token when authorizationCode is absent", async () => {
    let tokenExchangeCalls = 0
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input))
      if (url.pathname === "/clickzetta-portal/user/loginSingle" && init?.method === "POST") {
        return new Response(JSON.stringify({
          code: 0,
          data: {
            token: "legacy-token",
            userId: 7,
            instanceId: 9,
            expireTime: 123,
          },
        }), { status: 200, headers: { "content-type": "application/json" } })
      }
      if (url.pathname === "/clickzetta-hornhub/oauth2/token") {
        tokenExchangeCalls += 1
      }
      return new Response("not found", { status: 404 })
    }) as typeof fetch

    const token = await loginWithPassword("https://service.example.com", "user", "pass", "inst")

    expect(token.token).toBe("legacy-token")
    expect(tokenExchangeCalls).toBe(0)
  })
})
