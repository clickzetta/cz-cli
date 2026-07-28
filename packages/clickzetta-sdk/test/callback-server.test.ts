import { afterEach, describe, expect, test } from "bun:test"
import { get } from "node:http"
import { connect, type Socket } from "node:net"

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

/**
 * Raw HTTP over a socket we control, so a test can inspect response headers and
 * decide whether to keep the connection open. `node:http` hides both.
 */
function rawRequest(
  port: number,
  path: string,
  opts: { keepOpen?: boolean; socket?: Socket } = {},
): Promise<{ head: string; socket: Socket }> {
  return new Promise((resolve, reject) => {
    const socket = opts.socket ?? connect(port, "127.0.0.1")
    let buf = ""
    const onData = (d: Buffer) => {
      buf += d.toString()
      if (!buf.includes("\r\n\r\n")) return
      socket.off("data", onData)
      if (!opts.keepOpen && !opts.socket) socket.destroy()
      resolve({ head: buf.split("\r\n\r\n")[0]!, socket })
    }
    socket.on("data", onData)
    socket.on("error", reject)
    const send = () =>
      socket.write(
        `GET ${path} HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nConnection: keep-alive\r\n\r\n`,
      )
    if (opts.socket) send()
    else socket.on("connect", send)
  })
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

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

  // RFC 8252 §7.3: the redirect must be accepted on both loopback families,
  // since the address the browser dials is not ours to predict.
  test("accepts the callback on the IPv6 loopback too", async () => {
    const cb = await startLoopbackCallback({ expectedState: "state-v6", port: 0 })
    const codePromise = cb.waitForCode()
    codePromise.catch(() => {})

    const status = await httpGet(
      `http://[::1]:${cb.port}/callback?authorizationCode=v6-code&state=state-v6`,
    )
    expect(status).toBe(200)
    expect(await codePromise).toBe("v6-code")
  })

  // Regression: the listener must not invite the browser to pool its sockets.
  // A pooled connection idles through the sign-in, gets reaped, and the redirect
  // is then written to a dead socket — the code never arrives.
  test("tells the browser not to reuse the connection", async () => {
    const cb = await startLoopbackCallback({ expectedState: "state-hdr", port: 0 })
    cb.waitForCode().catch(() => {})

    const probe = await rawRequest(cb.port, "/favicon.ico")
    expect(probe.head).toMatch(/^HTTP\/1\.1 404/)
    expect(probe.head.toLowerCase()).toContain("connection: close")
    expect(probe.head.toLowerCase()).not.toContain("keep-alive")

    cb.close()
  })

  // Regression: the real failure mode. The browser probes the port, banks the
  // socket, and only redirects after the user has signed in. Reaping that socket
  // meanwhile loses the redirect and hangs login until the timeout — so the probe
  // response must decline reuse, and the socket must survive an idle stretch
  // longer than Node's default 5s keepAliveTimeout.
  test("keeps the probed socket alive across the sign-in delay", async () => {
    const cb = await startLoopbackCallback({ expectedState: "state-pool", port: 0 })
    const codePromise = cb.waitForCode()
    codePromise.catch(() => {})

    const probe = await rawRequest(cb.port, "/", { keepOpen: true })
    expect(probe.head).toMatch(/^HTTP\/1\.1 404/)

    let reaped = false
    probe.socket.on("end", () => { reaped = true })
    probe.socket.on("error", () => { reaped = true })

    // Longer than the 5s idle window that used to kill this socket.
    await sleep(5500)
    expect(reaped).toBe(false)

    // Write the redirect down that same socket, as a browser reusing a pooled
    // connection would, and require it to actually reach the listener.
    const redirect = await rawRequest(
      cb.port,
      "/callback?authorizationCode=late-code&state=state-pool",
      { socket: probe.socket },
    )
    expect(redirect.head).toMatch(/^HTTP\/1\.1 200/)
    expect(await codePromise).toBe("late-code")

    probe.socket.destroy()
  }, 20000)

  // Regression: waitForCode must settle even while another socket is still open —
  // it used to wait for every connection to drain first.
  test("resolves promptly while an idle browser socket is still open", async () => {
    const cb = await startLoopbackCallback({ expectedState: "state-idle", port: 0 })
    const codePromise = cb.waitForCode()
    codePromise.catch(() => {})

    // A preconnect that never sends anything.
    const idle = connect(cb.port, "127.0.0.1")
    await new Promise((r) => idle.on("connect", r))

    const started = Date.now()
    await httpGet(`${cb.redirectUri}?code=prompt-code&state=state-idle`)
    expect(await codePromise).toBe("prompt-code")
    expect(Date.now() - started).toBeLessThan(2000)

    idle.destroy()
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
