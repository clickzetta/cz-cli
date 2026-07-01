import { describe, expect, test } from "bun:test"

import {
  buildOauthLoginParam,
  encodeOauthLoginParam,
} from "../src/auth/oauth-login-param.js"

describe("buildOauthLoginParam", () => {
  test("fills constant fields and the provided redirectUri/codeChallenge", () => {
    const param = buildOauthLoginParam({
      redirectUri: "http://127.0.0.1:54321/callback",
      codeChallenge: "challenge-xyz",
    })

    expect(param.oauthLogin).toBe(true)
    expect(param.clientId).toBe("official-cli")
    expect(param.scope).toBe("openid profile offline_access")
    expect(param.codeChallengeMethod).toBe("S256")
    expect(param.redirectUri).toBe("http://127.0.0.1:54321/callback")
    expect(param.codeChallenge).toBe("challenge-xyz")
    expect(param.state).toBeUndefined()
    expect("state" in param).toBe(false)
  })

  test("includes state only when provided", () => {
    const param = buildOauthLoginParam({
      redirectUri: "http://127.0.0.1:54321/callback",
      codeChallenge: "challenge-xyz",
      state: "random-state",
    })

    expect(param.state).toBe("random-state")
  })
})

describe("encodeOauthLoginParam", () => {
  test("round-trips through base64 + JSON", () => {
    const param = buildOauthLoginParam({
      redirectUri: "http://127.0.0.1:54321/callback",
      codeChallenge: "challenge-xyz",
      state: "random-state",
    })

    const decoded = JSON.parse(Buffer.from(encodeOauthLoginParam(param), "base64").toString())
    expect(decoded).toEqual(param)
  })
})
