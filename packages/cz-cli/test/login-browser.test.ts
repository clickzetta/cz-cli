import { afterEach, describe, expect, test } from "bun:test"
import { get } from "node:http"

import { isLocalCallbackEnabled } from "@clickzetta/sdk"
import { loginWithBrowser } from "../src/commands/login-browser"

const realFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = realFetch
})

// Decode the base64(JSON) oauthLoginParam carried on the authorize URL so the
// fake browser can read the dynamic redirectUri + state, mirroring what the
// real accounts front end does.
function decodeAuthorizeUrl(authorizeUrl: string): { redirectUri: string; state: string } {
  const encoded = new URL(authorizeUrl).searchParams.get("oauthLoginParam")
  if (!encoded) throw new Error("authorize URL missing oauthLoginParam")
  const param = JSON.parse(Buffer.from(encoded, "base64").toString("utf-8"))
  return { redirectUri: param.redirectUri, state: param.state }
}

// Fire the loopback callback via node:http (not global fetch, which we stub for
// /oauth2/token) so the listener resolves with the code.
function httpGet(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    get(url, (res) => {
      res.resume()
      res.on("end", () => resolve())
    }).on("error", reject)
  })
}

const SAMPLE_USERINFO = {
  userId: 110000011361,
  accountName: "wynptmks",
  gatewayMapping: '{"1-1":"https://dev-api.clickzetta.com","1-2":"https://dev-api.clickzetta.com"}',
  instanceList: [{ cspId: 1, regionId: 1, serviceId: 1, id: 159973, name: "89b94150" }],
  instanceName: "89b94150",
  workspaceName: "quick_start",
  schema: "public",
  virtualCluster: "DEFAULT_AP",
  aimeshEndpointBaseUrl: "https://dev-aimesh.clickzetta.com/",
  apiKey: "secret-api-key",
  sub: "110000011361",
  preferred_username: "weiliu",
  name: "weiliu",
  account_id: 112407,
}

describe("loginWithBrowser", () => {
  // Property 11 (Requirements 10.2, 10.8): the redirectUri inside the authorize
  // URL is the dynamic loopback, and the redirect_uri sent to /oauth2/token is
  // byte-identical. Property 12 (Requirement 10.6): state round-trips.
  // Requirement 11.6: userinfo backfills userId/instanceId + connection context.
  test("happy path: dynamic redirect_uri round-trips into the token exchange", async () => {
    const seen: { authorizeRedirectUri?: string; tokenRedirectUri?: string; authorizeState?: string } = {}

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith("/oauth2/token")) {
        const body = new URLSearchParams(String(init?.body))
        seen.tokenRedirectUri = body.get("redirect_uri") ?? undefined
        expect(body.get("code")).toBe("THE_CODE")
        return new Response(
          JSON.stringify({
            access_token: "access-xyz",
            refresh_token: "refresh-xyz",
            expires_in: 3600,
            token_type: "Bearer",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        )
      }
      if (url.endsWith("/oauth2/userinfo")) {
        return new Response(JSON.stringify(SAMPLE_USERINFO), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      }
      throw new Error(`unexpected fetch to ${url}`)
    }) as typeof fetch

    const fakeBrowser = (authorizeUrl: string) => {
      const parsed = decodeAuthorizeUrl(authorizeUrl)
      seen.authorizeRedirectUri = parsed.redirectUri
      seen.authorizeState = parsed.state
      // Drive the loopback callback like the real front end would.
      void httpGet(`${parsed.redirectUri}?code=THE_CODE&state=${parsed.state}`)
    }

    const result = await loginWithBrowser({
      baseUrl: "https://api.example.com",
      accountsBaseUrl: "https://accounts.example.com",
      openBrowser: fakeBrowser,
      timeoutMs: 5000,
    })

    // (a) authorize redirectUri is the dynamic loopback callback
    expect(seen.authorizeRedirectUri).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/callback$/)
    // (b) Property 11: token redirect_uri is byte-identical to the authorize one
    expect(seen.tokenRedirectUri).toBe(seen.authorizeRedirectUri)
    // (c) returned AuthToken carries the access/refresh tokens
    expect(result.token.token).toBe("access-xyz")
    expect(result.token.refreshToken).toBe("refresh-xyz")
    // (c2) expireTimeMs is a DURATION (expires_in * 1000), NOT an absolute
    // timestamp. mocked expires_in=3600 → 3600000ms. The < 1e12 guard catches
    // the regression where Date.now()+duration produced an absolute time.
    expect(result.token.expireTimeMs).toBe(3600 * 1000)
    expect(result.token.expireTimeMs).toBeLessThan(1e12)
    // (d) Property 12: state matched what the callback validated (no rejection)
    expect(seen.authorizeState).toBeDefined()
    // (e) Requirement 11.6: userinfo backfilled identity into the token...
    expect(result.token.userId).toBe(110000011361)
    expect(result.token.instanceId).toBe(159973)
    // ...and the connection context surfaced on userInfo.
    expect(result.userInfo?.workspace).toBe("quick_start")
    expect(result.userInfo?.vcluster).toBe("DEFAULT_AP")
    expect(result.userInfo?.instanceName).toBe("89b94150")
    // ...account identity mapped from userinfo.
    expect(result.userInfo?.accountName).toBe("wynptmks")
    expect(result.userInfo?.accountId).toBe(112407)
    // ...and the LLM fields surfaced for provisioning.
    expect(result.userInfo?.apiKey).toBe("secret-api-key")
    expect(result.userInfo?.aimeshEndpointBaseUrl).toBe("https://dev-aimesh.clickzetta.com/")
    // Requirement 11.9: the FULL userinfo body is carried verbatim on `raw`,
    // including fields we never map to dedicated columns.
    expect(result.raw).toBeDefined()
    expect(result.raw?.aimeshEndpointBaseUrl).toBe("https://dev-aimesh.clickzetta.com/")
    expect(result.raw?.apiKey).toBe("secret-api-key")
    expect(result.raw?.gatewayMapping).toBe(SAMPLE_USERINFO.gatewayMapping)
    expect(result.raw?.instanceList).toEqual(SAMPLE_USERINFO.instanceList)
  })

  // Requirement 11.7: a userinfo failure must NOT fail the login — the token is
  // still returned and userInfo is undefined.
  test("userinfo failure is non-fatal: token resolves, userInfo undefined", async () => {
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith("/oauth2/token")) {
        const body = new URLSearchParams(String(init?.body))
        expect(body.get("code")).toBe("THE_CODE")
        return new Response(
          JSON.stringify({
            access_token: "access-xyz",
            refresh_token: "refresh-xyz",
            expires_in: 3600,
            token_type: "Bearer",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        )
      }
      if (url.endsWith("/oauth2/userinfo")) {
        return new Response(JSON.stringify({ error: "invalid_token" }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        })
      }
      throw new Error(`unexpected fetch to ${url}`)
    }) as typeof fetch

    const fakeBrowser = (authorizeUrl: string) => {
      const parsed = decodeAuthorizeUrl(authorizeUrl)
      void httpGet(`${parsed.redirectUri}?code=THE_CODE&state=${parsed.state}`)
    }

    const result = await loginWithBrowser({
      baseUrl: "https://api.example.com",
      accountsBaseUrl: "https://accounts.example.com",
      openBrowser: fakeBrowser,
      timeoutMs: 5000,
    })

    expect(result.token.token).toBe("access-xyz")
    // userinfo failed → identity stays at the default and context is absent.
    expect(result.token.userId).toBe(0)
    expect(result.token.instanceId).toBe(0)
    expect(result.userInfo).toBeUndefined()
    // raw is only present when userinfo succeeded.
    expect(result.raw).toBeUndefined()
  })

  // Property 12 (Requirement 10.7): a callback with the wrong state must reject.
  test("rejects when the browser returns a mismatched state", async () => {
    globalThis.fetch = (async () => {
      throw new Error("/oauth2/token must not be called on state mismatch")
    }) as typeof fetch

    const fakeBrowser = (authorizeUrl: string) => {
      const parsed = decodeAuthorizeUrl(authorizeUrl)
      void httpGet(`${parsed.redirectUri}?code=THE_CODE&state=not-the-state`)
    }

    await expect(
      loginWithBrowser({
        baseUrl: "https://api.example.com",
        accountsBaseUrl: "https://accounts.example.com",
        openBrowser: fakeBrowser,
        timeoutMs: 5000,
      }),
    ).rejects.toThrow(/state mismatch/)
  })

  // Property 13 (Requirement 10.1): with CZ_OAUTH_LOCAL_CALLBACK unset the
  // gating check is false, so callers keep the existing default path.
  test("gating: isLocalCallbackEnabled is false when the switch is unset", () => {
    const original = process.env.CZ_OAUTH_LOCAL_CALLBACK
    delete process.env.CZ_OAUTH_LOCAL_CALLBACK
    try {
      expect(isLocalCallbackEnabled()).toBe(false)
    } finally {
      if (original !== undefined) process.env.CZ_OAUTH_LOCAL_CALLBACK = original
    }
  })
})
