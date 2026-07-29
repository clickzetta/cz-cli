import { afterEach, describe, expect, test } from "bun:test"
import { get } from "node:http"

import { isLocalCallbackEnabled } from "@clickzetta/sdk"
import { loginWithBrowser } from "../src/commands/login-browser"

const realFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = realFetch
})

const ISSUER = "https://api.example.com"
// The discovery document deliberately puts authorize on a DIFFERENT host from
// the issuer. That is the regression guard for the bug this migration fixes: the
// old code guessed the sign-in host by rewriting the api hostname, so
// --oauth-url uat-… could open production. Now the host must come from here.
const AUTHORIZE_HOST = "https://login.partner.example.net"
const DISCOVERY_URL = `${ISSUER}/.well-known/oauth-authorization-server`

const DISCOVERY_DOC = {
  // Must equal the request URL after normalization or the library rejects it
  // with "discovered metadata issuer does not match".
  issuer: ISSUER,
  authorization_endpoint: `${AUTHORIZE_HOST}/oauth2/authorize`,
  token_endpoint: `${ISSUER}/clickzetta-hornhub/oauth2/token`,
  userinfo_endpoint: `${ISSUER}/clickzetta-hornhub/oauth2/userinfo`,
  response_types_supported: ["code"],
  grant_types_supported: ["authorization_code", "refresh_token"],
  code_challenge_methods_supported: ["S256"],
}

// Read the standard flat authorize params. Replaces the old base64 JSON
// `oauthLoginParam` decoder: the wire format is now plain OAuth query params.
function readAuthorizeUrl(authorizeUrl: string): {
  url: URL
  params: URLSearchParams
  redirectUri: string
  state: string
} {
  const url = new URL(authorizeUrl)
  const params = url.searchParams
  const redirectUri = params.get("redirect_uri")
  const state = params.get("state")
  if (!redirectUri || !state) throw new Error(`authorize URL missing redirect_uri/state: ${authorizeUrl}`)
  return { url, params, redirectUri, state }
}

// Fire the loopback callback via node:http (not global fetch, which we stub for
// discovery/token/userinfo) so the listener resolves with the code.
function httpGet(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    get(url, (res) => {
      res.resume()
      res.on("end", () => resolve())
    }).on("error", reject)
  })
}

function jsonResponse(body: unknown, status = 200): Response {
  // openid-client requires an explicit JSON content-type on every response.
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })
}

const TOKEN_RESPONSE = {
  access_token: "access-xyz",
  refresh_token: "refresh-xyz",
  expires_in: 3600,
  // Must be present and case-insensitively "bearer", else the library throws
  // UnsupportedOperationError.
  token_type: "Bearer",
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

interface StubOptions {
  token?: (body: URLSearchParams) => Response
  userinfo?: () => Response
  onRequest?: (url: string, init?: RequestInit) => void
}

/**
 * Stub global fetch for the whole standard flow. `oauth4webapi` reads `fetch`
 * off the global at call time (no module-level binding), so this works for
 * discovery too.
 */
function stubFetch(opts: StubOptions = {}): { requests: string[] } {
  const requests: string[] = []
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    requests.push(url)
    opts.onRequest?.(url, init)
    if (url === DISCOVERY_URL) return jsonResponse(DISCOVERY_DOC)
    if (url === DISCOVERY_DOC.token_endpoint) {
      const body = new URLSearchParams(String(init?.body))
      return opts.token ? opts.token(body) : jsonResponse(TOKEN_RESPONSE)
    }
    if (url === DISCOVERY_DOC.userinfo_endpoint) {
      return opts.userinfo ? opts.userinfo() : jsonResponse(SAMPLE_USERINFO)
    }
    throw new Error(`unexpected fetch to ${url}`)
  }) as typeof fetch
  return { requests }
}

describe("loginWithBrowser", () => {
  // Property 11 (Requirements 10.2, 10.8): the redirect_uri inside the authorize
  // URL is the dynamic loopback, and the redirect_uri sent to the token endpoint
  // is byte-identical. Property 12 (Requirement 10.6): state round-trips.
  // Requirement 11.6: userinfo backfills userId/instanceId + connection context.
  test("happy path: dynamic redirect_uri round-trips into the token exchange", async () => {
    const seen: { authorizeRedirectUri?: string; tokenRedirectUri?: string; authorizeState?: string } = {}

    stubFetch({
      token: (body) => {
        seen.tokenRedirectUri = body.get("redirect_uri") ?? undefined
        expect(body.get("code")).toBe("THE_CODE")
        expect(body.get("grant_type")).toBe("authorization_code")
        // PKCE: the verifier (not the challenge) is presented at the token step.
        expect(body.get("code_verifier")).toBeTruthy()
        return jsonResponse(TOKEN_RESPONSE)
      },
    })

    const fakeBrowser = (authorizeUrl: string) => {
      const parsed = readAuthorizeUrl(authorizeUrl)
      seen.authorizeRedirectUri = parsed.redirectUri
      seen.authorizeState = parsed.state
      // Drive the loopback callback like the real front end would.
      void httpGet(`${parsed.redirectUri}?code=THE_CODE&state=${parsed.state}`)
    }

    const result = await loginWithBrowser({
      baseUrl: ISSUER,
      openBrowser: fakeBrowser,
      timeoutMs: 5000,
    })

    // (a) authorize redirect_uri is the dynamic loopback callback
    expect(seen.authorizeRedirectUri).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/callback$/)
    // (b) Property 11: token redirect_uri is byte-identical to the authorize one.
    // The library derives it by stripping the callback URL's query — dropping the
    // port here is exactly what produces a spurious invalid_grant.
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
    // ...and the region service derived from gatewayMapping[cspId-regionId] for
    // the default instance (1-1 → dev-api.clickzetta.com), stored bare (no scheme).
    expect(result.userInfo?.service).toBe("dev-api.clickzetta.com")
    // Requirement 11.9: the FULL userinfo body is carried verbatim on `raw`,
    // including fields we never map to dedicated columns.
    expect(result.raw).toBeDefined()
    expect(result.raw?.aimeshEndpointBaseUrl).toBe("https://dev-aimesh.clickzetta.com/")
    expect(result.raw?.apiKey).toBe("secret-api-key")
    expect(result.raw?.gatewayMapping).toBe(SAMPLE_USERINFO.gatewayMapping)
    expect(result.raw?.instanceList).toEqual(SAMPLE_USERINFO.instanceList)
  })

  // Metadata discovery must use RFC 8414's /.well-known/oauth-authorization-server,
  // not OIDC's /.well-known/openid-configuration. This is a live server
  // constraint (openid-configuration 404s), which is why `algorithm: "oauth2"`
  // is passed to client.discovery — pinning it here keeps that from being
  // "cleaned up".
  test("discovery hits the RFC 8414 path, not openid-configuration", async () => {
    const { requests } = stubFetch()

    await loginWithBrowser({
      baseUrl: ISSUER,
      openBrowser: (authorizeUrl) => {
        const parsed = readAuthorizeUrl(authorizeUrl)
        void httpGet(`${parsed.redirectUri}?code=THE_CODE&state=${parsed.state}`)
      },
      timeoutMs: 5000,
    })

    expect(requests[0]).toBe(DISCOVERY_URL)
    expect(requests.some((u) => u.includes("openid-configuration"))).toBe(false)
  })

  // Gateway log correlation depends on the `requestId` header. The library's
  // high-level helpers expose no header option, so it is injected via
  // customFetch — pin that it reaches every request, and that one login shares
  // one id.
  test("every request carries the requestId header", async () => {
    const ids: (string | undefined)[] = []
    stubFetch({
      onRequest: (_url, init) => {
        ids.push(new Headers(init?.headers).get("requestId") ?? undefined)
      },
    })

    await loginWithBrowser({
      baseUrl: ISSUER,
      openBrowser: (authorizeUrl) => {
        const parsed = readAuthorizeUrl(authorizeUrl)
        void httpGet(`${parsed.redirectUri}?code=THE_CODE&state=${parsed.state}`)
      },
      timeoutMs: 5000,
    })

    // discovery + token + userinfo
    expect(ids.length).toBe(3)
    expect(new Set(ids).size).toBe(1)
    expect(ids[0]).toMatch(/^tssdk-oauth-[0-9a-f]{12}$/)
  })

  // The authorize URL is now standard flat OAuth params, and the private
  // base64(JSON) `oauthLoginParam` encoding is gone from the wire.
  test("authorize URL carries standard flat OAuth params and no oauthLoginParam", async () => {
    let params: URLSearchParams | undefined
    stubFetch()

    await loginWithBrowser({
      baseUrl: ISSUER,
      openBrowser: (authorizeUrl) => {
        const parsed = readAuthorizeUrl(authorizeUrl)
        params = parsed.params
        void httpGet(`${parsed.redirectUri}?code=THE_CODE&state=${parsed.state}`)
      },
      timeoutMs: 5000,
    })

    expect(params?.get("response_type")).toBe("code")
    expect(params?.get("client_id")).toBe("official-cli")
    expect(params?.get("redirect_uri")).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/callback$/)
    expect(params?.get("scope")).toBe("profile offline_access")
    expect(params?.get("code_challenge_method")).toBe("S256")
    // S256 challenge: 43-char base64url, and never the verifier itself.
    expect(params?.get("code_challenge")).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(params?.get("state")).toBeTruthy()
    expect(params?.get("oauthLoginParam")).toBeNull()
  })

  // Regression test for the originating bug: the browser must be sent to the
  // discovery document's authorization_endpoint host. The old code derived an
  // accounts host from the api hostname, and its "prod" and "unparseable"
  // outcomes were indistinguishable, so an internal --oauth-url silently opened
  // production.
  test("authorize host comes from the discovered authorization_endpoint", async () => {
    let opened: URL | undefined
    stubFetch()

    await loginWithBrowser({
      baseUrl: ISSUER,
      openBrowser: (authorizeUrl) => {
        const parsed = readAuthorizeUrl(authorizeUrl)
        opened = parsed.url
        void httpGet(`${parsed.redirectUri}?code=THE_CODE&state=${parsed.state}`)
      },
      timeoutMs: 5000,
    })

    expect(opened?.origin).toBe(AUTHORIZE_HOST)
    expect(`${opened?.origin}${opened?.pathname}`).toBe(DISCOVERY_DOC.authorization_endpoint)
    // Neither the issuer nor any host guessed from it.
    expect(opened?.origin).not.toBe(ISSUER)
    expect(opened?.hostname).not.toContain("accounts")
  })

  // Requirement 11.7: a userinfo failure must NOT fail the login — the token is
  // still returned and userInfo is undefined. A 401 with a WWW-Authenticate
  // header reaches us as WWWAuthenticateChallengeError (thrown from inside
  // fetchProtectedResource), not as a non-ok Response, so this also pins that
  // the adapter path is non-fatal too.
  test("userinfo 401 with a challenge header is non-fatal: token resolves, userInfo undefined", async () => {
    stubFetch({
      userinfo: () =>
        new Response(JSON.stringify({ error: "invalid_token" }), {
          status: 401,
          headers: {
            "Content-Type": "application/json",
            "WWW-Authenticate": 'Bearer error="invalid_token", error_description="expired"',
          },
        }),
    })

    const result = await loginWithBrowser({
      baseUrl: ISSUER,
      openBrowser: (authorizeUrl) => {
        const parsed = readAuthorizeUrl(authorizeUrl)
        void httpGet(`${parsed.redirectUri}?code=THE_CODE&state=${parsed.state}`)
      },
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

  // A body-only error response (no WWW-Authenticate header) comes back as a
  // non-ok Response instead, and must be equally non-fatal.
  test("userinfo body-only error is non-fatal", async () => {
    stubFetch({ userinfo: () => jsonResponse({ error: "invalid_token" }, 401) })

    const result = await loginWithBrowser({
      baseUrl: ISSUER,
      openBrowser: (authorizeUrl) => {
        const parsed = readAuthorizeUrl(authorizeUrl)
        void httpGet(`${parsed.redirectUri}?code=THE_CODE&state=${parsed.state}`)
      },
      timeoutMs: 5000,
    })

    expect(result.token.token).toBe("access-xyz")
    expect(result.userInfo).toBeUndefined()
  })

  // A token-endpoint failure surfaces as our own InterfaceError code, not the
  // library's OAUTH_RESPONSE_BODY_ERROR constant.
  test("token endpoint invalid_grant surfaces as an invalid_grant InterfaceError", async () => {
    stubFetch({
      token: () => jsonResponse({ error: "invalid_grant", error_description: "code expired" }, 400),
    })

    const promise = loginWithBrowser({
      baseUrl: ISSUER,
      openBrowser: (authorizeUrl) => {
        const parsed = readAuthorizeUrl(authorizeUrl)
        void httpGet(`${parsed.redirectUri}?code=THE_CODE&state=${parsed.state}`)
      },
      timeoutMs: 5000,
    })

    const err = (await promise.catch((e) => e)) as Error & { code?: string }
    expect(err.code).toBe("invalid_grant")
    expect(err.message).toContain("the authorization grant is invalid, expired, or already used")
  })

  // Property 12 (Requirement 10.7): a callback with the wrong state must reject.
  test("rejects when the browser returns a mismatched state", async () => {
    stubFetch({
      token: () => {
        throw new Error("the token endpoint must not be called on state mismatch")
      },
    })

    const fakeBrowser = (authorizeUrl: string) => {
      const parsed = readAuthorizeUrl(authorizeUrl)
      void httpGet(`${parsed.redirectUri}?code=THE_CODE&state=not-the-state`)
    }

    await expect(
      loginWithBrowser({ baseUrl: ISSUER, openBrowser: fakeBrowser, timeoutMs: 5000 }),
    ).rejects.toThrow(/state mismatch/)
  })

  // When the redirect never arrives (proxy/VPN/firewall swallowing loopback
  // traffic), the user can still finish by pasting the address-bar URL. The
  // pasted URL yields a bare code, which converges on the same synthesized
  // callback URL as the loopback path.
  test("falls back to a pasted redirect URL when the callback times out", async () => {
    let exchangedCode: string | undefined
    stubFetch({
      token: (body) => {
        exchangedCode = body.get("code") ?? undefined
        return jsonResponse({ ...TOKEN_RESPONSE, access_token: "access-pasted", refresh_token: "refresh-pasted" })
      },
    })

    let state: string | undefined
    const result = await loginWithBrowser({
      baseUrl: ISSUER,
      // Never drive the loopback, so the wait times out.
      openBrowser: (authorizeUrl) => {
        state = readAuthorizeUrl(authorizeUrl).state
      },
      timeoutMs: 30,
      promptManualUrl: async () =>
        `http://127.0.0.1:1234/callback?authorizationCode=PASTED_CODE&state=${state}`,
    })

    expect(exchangedCode).toBe("PASTED_CODE")
    expect(result.token.token).toBe("access-pasted")
  })

  // Cancelling the paste prompt must surface the original timeout, not a
  // confusing secondary error.
  test("rethrows the timeout when the paste prompt is cancelled", async () => {
    stubFetch()
    await expect(
      loginWithBrowser({
        baseUrl: ISSUER,
        openBrowser: () => {},
        timeoutMs: 30,
        promptManualUrl: async () => undefined,
      }),
    ).rejects.toThrow(/timed out/)
  })

  // A rejected callback DID arrive; offering a paste there would invite the user
  // to hand-carry the request we just refused.
  test("does not offer the paste fallback on a state mismatch", async () => {
    stubFetch()
    let prompted = false
    const fakeBrowser = (authorizeUrl: string) => {
      const parsed = readAuthorizeUrl(authorizeUrl)
      void httpGet(`${parsed.redirectUri}?code=THE_CODE&state=not-the-state`)
    }

    await expect(
      loginWithBrowser({
        baseUrl: ISSUER,
        openBrowser: fakeBrowser,
        timeoutMs: 5000,
        promptManualUrl: async () => {
          prompted = true
          return undefined
        },
      }),
    ).rejects.toThrow(/state mismatch/)
    expect(prompted).toBe(false)
  })

  // A pasted URL is held to the same state check as the loopback path.
  test("rejects a pasted URL whose state does not match", async () => {
    stubFetch()
    await expect(
      loginWithBrowser({
        baseUrl: ISSUER,
        openBrowser: () => {},
        timeoutMs: 30,
        promptManualUrl: async () => "http://127.0.0.1:1234/callback?authorizationCode=X&state=forged",
      }),
    ).rejects.toThrow(/state mismatch in the pasted redirect URL/)
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
