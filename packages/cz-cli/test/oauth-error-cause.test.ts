import { describe, expect, test } from "bun:test"
import * as client from "openid-client"
import { toInterfaceError } from "../src/commands/oauth-error"

/**
 * openid-client funnels every unclassified failure through a single
 * `new ClientError("something went wrong", { cause })`, so DNS failures and
 * issuer mismatches used to reach the user as the same opaque sentence. These
 * tests pin the reason surfacing from `cause`.
 *
 * The error shapes here are built the way the library builds them (see
 * openid-client build/index.js:165 and :286-297) rather than by throwing real
 * network calls, so the suite stays offline and deterministic.
 */
describe("toInterfaceError cause surfacing", () => {
  test("a DNS failure names ENOTFOUND instead of only 'something went wrong'", () => {
    const sys = Object.assign(new Error("getaddrinfo ENOTFOUND api.singdata.com"), { code: "ENOTFOUND" })
    const err = new Error("something went wrong", { cause: sys })

    const out = toInterfaceError(err, "req-1")

    expect(out.message).toContain("ENOTFOUND")
    expect(out.message).toContain("req-1")
  })

  test("a refused connection names ECONNREFUSED", () => {
    const sys = Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:443"), { code: "ECONNREFUSED" })
    const out = toInterfaceError(new Error("something went wrong", { cause: sys }), "req-2")
    expect(out.message).toContain("ECONNREFUSED")
  })

  test("an issuer mismatch names both hosts, so the real diagnosis is visible", () => {
    // Shape from performDiscovery's RFC 8414 §3.3 check.
    const err = new Error("discovered metadata issuer does not match the expected issuer", {
      cause: {
        expected: "https://api.clickzetta.com/",
        body: { issuer: "https://cn-shanghai-alicloud.api.clickzetta.com" },
        attribute: "issuer",
      },
    })

    const out = toInterfaceError(err, "req-3")

    expect(out.message).toContain("issuer mismatch")
    expect(out.message).toContain("https://api.clickzetta.com/")
    expect(out.message).toContain("https://cn-shanghai-alicloud.api.clickzetta.com")
  })

  test("an issuer-mismatch cause never leaks the rest of the metadata body", () => {
    // Property 7: read only host names out of `body`, never stringify it — a
    // response body is exactly where a token would be if one were present.
    const err = new Error("discovered metadata issuer does not match the expected issuer", {
      cause: {
        expected: "https://api.clickzetta.com/",
        body: { issuer: "https://region.api.clickzetta.com", access_token: "SECRET-TOKEN-VALUE" },
        attribute: "issuer",
      },
    })

    expect(toInterfaceError(err, "req-4").message).not.toContain("SECRET-TOKEN-VALUE")
  })

  test("an error with no usable cause still reports its own message", () => {
    const out = toInterfaceError(new Error("something went wrong"), "req-5")
    expect(out.message).toContain("something went wrong")
    expect(out.message).toContain("req-5")
  })

  test("OAuth protocol errors keep their own code, unaffected by cause handling", () => {
    // Regression guard: the cause path must not shadow ResponseBodyError, whose
    // real OAuth code is what REFRESH_TOKEN_DEAD detection depends on.
    const err = new client.ResponseBodyError("invalid_grant", {
      cause: { error: "invalid_grant", error_description: "refresh token expired" },
      response: new Response("{}", { status: 400 }),
    } as never)

    const out = toInterfaceError(err, "req-6")

    expect(out.code).toBe("invalid_grant")
  })
})
