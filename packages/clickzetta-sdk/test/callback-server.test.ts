import { afterEach, describe, expect, test } from "bun:test"
import { get } from "node:http"

import {
  isLocalCallbackEnabled,
  startLoopbackCallback,
  waitForAuthorizationCode,
} from "../src/auth/callback-server.js"

// Issue the loopback request via node:http (not global fetch) so the test is
// immune to any fetch stub a sibling test file may leave installed, and never
// relies on the privileged port 80.
function httpGet(url: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = get(url, (res) => {
      res.resume() // drain so the socket closes
      resolve(res.statusCode ?? 0)
    })
    req.on("error", reject)
  })
}

// Bind an ephemeral port (0) and resolve once the listener is ready.
async function startListener(expectedState: string) {
  const portReady = Promise.withResolvers<number>()
  const codePromise = waitForAuthorizationCode({
    expectedState,
    port: 0,
    onListening: (port) => portReady.resolve(port),
  })
  // Swallow the rejection path here; individual tests assert on codePromise.
  codePromise.catch(() => {})
  return { port: await portReady.promise, codePromise }
}

describe("waitForAuthorizationCode", () => {
  // Requirement 3.5: capture the authorization code from the loopback callback
  // and validate state before resolving.
  test("resolves with the code when state matches", async () => {
    const { port, codePromise } = await startListener("state-match-123")
    const status = await httpGet(
      `http://127.0.0.1:${port}/callback?code=auth-code-xyz&state=state-match-123`,
    )
    expect(status).toBe(200)
    expect(await codePromise).toBe("auth-code-xyz")
  })

  // Requirement 3.5: a state mismatch must be rejected (and the listener closed).
  test("rejects when state does not match", async () => {
    const { port, codePromise } = await startListener("expected-state")
    const status = await httpGet(
      `http://127.0.0.1:${port}/callback?code=auth-code-xyz&state=wrong-state`,
    )
    expect(status).toBe(400)
    await expect(codePromise).rejects.toThrow(/state mismatch/)
  })

  // Requirement 3.5: a missing code must be rejected.
  test("rejects when code is missing", async () => {
    const { port, codePromise } = await startListener("any-state")
    const status = await httpGet(`http://127.0.0.1:${port}/callback?state=any-state`)
    expect(status).toBe(400)
    await expect(codePromise).rejects.toThrow(/missing authorization code/)
  })

  // Requirement 3.5: honor the timeout and reject without leaking resources.
  test("rejects after the timeout elapses", async () => {
    await expect(
      waitForAuthorizationCode({ expectedState: "s", port: 0, timeoutMs: 20 }),
    ).rejects.toThrow(/timed out/)
  })
})

describe("startLoopbackCallback", () => {
  // Property 11/12 (Requirements 10.2, 10.6, 10.7): the API resolves once bound,
  // exposing the real port + redirectUri so the caller can build the redirect
  // URL before the code arrives; a matching callback then resolves waitForCode.
  test("resolves with port + redirectUri, then waitForCode resolves on matching callback", async () => {
    const cb = await startLoopbackCallback({ expectedState: "state-abc", port: 0 })
    expect(cb.port).toBeGreaterThan(0)
    expect(cb.redirectUri).toBe(`http://127.0.0.1:${cb.port}/callback`)

    const codePromise = cb.waitForCode()
    codePromise.catch(() => {})
    const status = await httpGet(`${cb.redirectUri}?code=auth-code-abc&state=state-abc`)
    expect(status).toBe(200)
    expect(await codePromise).toBe("auth-code-abc")
  })

  // Requirement 10.7: a state mismatch must reject waitForCode (and close).
  test("waitForCode rejects on state mismatch", async () => {
    const cb = await startLoopbackCallback({ expectedState: "expected", port: 0 })
    const codePromise = cb.waitForCode()
    codePromise.catch(() => {})
    const status = await httpGet(`${cb.redirectUri}?code=auth-code-abc&state=wrong`)
    expect(status).toBe(400)
    await expect(codePromise).rejects.toThrow(/state mismatch/)
  })

  // Requirement 10.7: a missing code must reject waitForCode.
  test("waitForCode rejects when code is missing", async () => {
    const cb = await startLoopbackCallback({ expectedState: "any", port: 0 })
    const codePromise = cb.waitForCode()
    codePromise.catch(() => {})
    const status = await httpGet(`${cb.redirectUri}?state=any`)
    expect(status).toBe(400)
    await expect(codePromise).rejects.toThrow(/missing authorization code/)
  })

  // Requirement 10.7: honor the timeout and reject without leaking resources.
  test("waitForCode rejects after the timeout elapses", async () => {
    const cb = await startLoopbackCallback({ expectedState: "s", port: 0, timeoutMs: 20 })
    await expect(cb.waitForCode()).rejects.toThrow(/timed out/)
  })

  // close() before any callback must reject a pending waitForCode().
  test("close() rejects a pending waitForCode", async () => {
    const cb = await startLoopbackCallback({ expectedState: "s", port: 0 })
    const codePromise = cb.waitForCode()
    codePromise.catch(() => {})
    cb.close()
    await expect(codePromise).rejects.toThrow(/closed/)
  })

  // The front end may name the code param `authorizationCode` (current accounts
  // contract) instead of the OAuth-standard `code`; both must be accepted.
  test("resolves when the code is passed as authorizationCode with matching state", async () => {
    const cb = await startLoopbackCallback({ expectedState: "state-acode", port: 0 })
    const codePromise = cb.waitForCode()
    codePromise.catch(() => {})
    const status = await httpGet(`${cb.redirectUri}?authorizationCode=ac-123&state=state-acode`)
    expect(status).toBe(200)
    expect(await codePromise).toBe("ac-123")
  })

  // A stray probe (favicon / root / connectivity check) to the loopback port
  // must NOT consume the one-shot listener; the real /callback still resolves.
  test("ignores non-callback probes then resolves on the real callback", async () => {
    const cb = await startLoopbackCallback({ expectedState: "state-probe", port: 0 })
    const codePromise = cb.waitForCode()
    codePromise.catch(() => {})

    const faviconStatus = await httpGet(`http://127.0.0.1:${cb.port}/favicon.ico`)
    expect(faviconStatus).toBe(404)
    const rootStatus = await httpGet(`http://127.0.0.1:${cb.port}/`)
    expect(rootStatus).toBe(404)

    const status = await httpGet(`${cb.redirectUri}?code=real-code&state=state-probe`)
    expect(status).toBe(200)
    expect(await codePromise).toBe("real-code")
  })
})

describe("isLocalCallbackEnabled", () => {
  const original = process.env.CZ_OAUTH_LOCAL_CALLBACK

  afterEach(() => {
    if (original === undefined) delete process.env.CZ_OAUTH_LOCAL_CALLBACK
    else process.env.CZ_OAUTH_LOCAL_CALLBACK = original
  })

  // Requirement 3.6: default (unset) MUST be disabled.
  test("returns false when the env var is unset", () => {
    delete process.env.CZ_OAUTH_LOCAL_CALLBACK
    expect(isLocalCallbackEnabled()).toBe(false)
  })

  test("returns true when set to \"1\" or \"true\"", () => {
    process.env.CZ_OAUTH_LOCAL_CALLBACK = "1"
    expect(isLocalCallbackEnabled()).toBe(true)
    process.env.CZ_OAUTH_LOCAL_CALLBACK = "true"
    expect(isLocalCallbackEnabled()).toBe(true)
  })

  test("returns false for other values", () => {
    process.env.CZ_OAUTH_LOCAL_CALLBACK = "0"
    expect(isLocalCallbackEnabled()).toBe(false)
    process.env.CZ_OAUTH_LOCAL_CALLBACK = "yes"
    expect(isLocalCallbackEnabled()).toBe(false)
  })
})
