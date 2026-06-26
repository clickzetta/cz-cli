import { createServer } from "node:http"

import { loopbackRedirectUri } from "./oauth-constants.js"

export interface CallbackOptions {
  expectedState: string
  // Reject and stop listening after this many ms (default 120000).
  timeoutMs?: number
  // Loopback port to bind. Defaults to 0 (ephemeral) so callers/tests can
  // bind without a privileged port.
  port?: number
  // Invoked once the listener is bound, with the chosen port. Useful for
  // tests (port:0) and callers that must build the redirect URL.
  onListening?: (port: number) => void
}

/**
 * Separated loopback callback handle (design Addendum 2, component G).
 *
 * `startLoopbackCallback` resolves this once the listener is bound, exposing
 * the actual `port` / `redirectUri` so the caller can build the dynamic
 * redirect_uri and open the browser BEFORE the authorization code arrives.
 * `waitForCode()` resolves later when a validated code is received.
 */
export interface LoopbackCallback {
  port: number
  redirectUri: string
  // Resolves on a validated code (then closes); rejects on bad state, missing
  // code, timeout, or close().
  waitForCode(): Promise<string>
  // Tear down the listener if the caller aborts; causes a pending
  // waitForCode() to reject if not already settled.
  close(): void
}

const DEFAULT_TIMEOUT_MS = 120000

const SUCCESS_PAGE =
  "<!doctype html><html><head><meta charset=\"utf-8\"><title>Login complete</title></head>" +
  "<body><h1>Login complete</h1><p>You can close this window and return to the CLI.</p></body></html>"

const FAILURE_PAGE =
  "<!doctype html><html><head><meta charset=\"utf-8\"><title>Login failed</title></head>" +
  "<body><h1>Login failed</h1><p>The authorization callback was invalid. Please retry from the CLI.</p></body></html>"

/**
 * Feature switch for the local loopback callback flow. Returns true ONLY when
 * `CZ_OAUTH_LOCAL_CALLBACK` is set to "1" or "true". The default (unset) is
 * disabled, so the default login flow never starts a listener (requirement 3.6).
 */
export function isLocalCallbackEnabled(): boolean {
  const flag = process.env.CZ_OAUTH_LOCAL_CALLBACK
  return flag === "1" || flag === "true"
}

/**
 * Debug switch for the loopback callback. When `CZ_OAUTH_DEBUG` is "1"/"true",
 * every incoming request to the listener is logged to stderr (method, path,
 * query param keys, and the full raw URL) so integration mismatches — wrong
 * path, missing `state`, unexpected param name — can be inspected. Opt-in only;
 * the raw URL may contain the authorization code, so it is never logged unless
 * the developer explicitly enables this.
 */
function isOauthDebug(): boolean {
  const flag = process.env.CZ_OAUTH_DEBUG
  return flag === "1" || flag === "true"
}

interface CallbackCore {
  port: number
  waitForCode: () => Promise<string>
  close: () => void
}

/**
 * Shared core for both the one-shot `waitForAuthorizationCode` and the
 * separated `startLoopbackCallback` API. Binds 127.0.0.1, parses the incoming
 * request's authorization code (`?code=` or `?authorizationCode=`) and
 * `?state=`, validates `state === expectedState`, replies with
 * a small success/failure page, and resolves/rejects an internal "code"
 * promise. Never logs the code or state value.
 *
 * The returned Promise resolves once the listener is bound (exposing the actual
 * port); the internal code promise is exposed via `waitForCode()`. The timeout
 * timer starts when listening begins.
 */
function startCallbackCore(opts: {
  expectedState: string
  timeoutMs?: number
  port?: number
}): Promise<CallbackCore> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
  return new Promise<CallbackCore>((resolveListen, rejectListen) => {
    let settled = false
    let listening = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const pending = Promise.withResolvers<string>()
    // Attach a noop handler so a close()/timeout rejection that lands before the
    // caller awaits waitForCode() does not surface as an unhandled rejection.
    // The original promise still rejects for the real awaiter.
    pending.promise.catch(() => {})

    const finish = (action: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      server.close(() => action())
    }

    const server = createServer((req, res) => {
      if (settled) return
      const url = new URL(req.url ?? "/", "http://127.0.0.1")

      if (isOauthDebug()) {
        const keys = Array.from(url.searchParams.keys()).join(",")
        console.error(`[oauth-callback] ${req.method} ${url.pathname} params=[${keys}] url=${req.url}`)
      }

      // Only the loopback callback path is the real OAuth redirect. Browsers and
      // the OS routinely probe a freshly-opened loopback port (favicon.ico, the
      // root path, connectivity checks) — those carry no `code` and must NOT
      // consume this one-shot listener. Answer 404 and keep waiting so the
      // genuine `/callback?code=...&state=...` request still settles it.
      if (url.pathname !== "/callback") {
        res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" })
        res.end("not found")
        return
      }

      const code = url.searchParams.get("code") ?? url.searchParams.get("authorizationCode")
      const state = url.searchParams.get("state")

      if (!code || state !== opts.expectedState) {
        res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" })
        res.end(FAILURE_PAGE)
        finish(() =>
          pending.reject(
            new Error(
              !code
                ? "missing authorization code in callback request"
                : "state mismatch in authorization callback",
            ),
          ),
        )
        return
      }

      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" })
      res.end(SUCCESS_PAGE)
      finish(() => pending.resolve(code))
    })

    server.on("error", (err) => {
      if (!listening) {
        rejectListen(err)
        return
      }
      finish(() => pending.reject(err))
    })

    server.listen(opts.port ?? 0, "127.0.0.1", () => {
      listening = true
      timer = setTimeout(
        () => finish(() => pending.reject(new Error("timed out waiting for authorization callback"))),
        timeoutMs,
      )
      timer.unref?.()

      const addr = server.address()
      const port = addr && typeof addr === "object" ? addr.port : 0
      resolveListen({
        port,
        waitForCode: () => pending.promise,
        close: () =>
          finish(() =>
            pending.reject(
              new Error("callback listener closed before receiving authorization code"),
            ),
          ),
      })
    })
  })
}

/**
 * Start a one-shot loopback HTTP listener that captures an OAuth authorization
 * code redirected back from the browser (requirement 3.5).
 *
 * It binds 127.0.0.1, validates `state`, resolves with the `code`, then closes
 * the listener. On missing code, state mismatch, timeout, or a bind error it
 * rejects and closes. Never logs the code value.
 */
export function waitForAuthorizationCode(opts: CallbackOptions): Promise<string> {
  return startCallbackCore(opts).then((core) => {
    opts.onListening?.(core.port)
    return core.waitForCode()
  })
}

/**
 * Separated loopback callback API (design Addendum 2, component G; needs 10.2,
 * 10.6, 10.7). Starts the listener and resolves once it is bound, exposing the
 * actual `port` and `redirectUri = loopbackRedirectUri(port)` so the caller can
 * build the authorize URL and open the browser BEFORE the code arrives. The
 * code itself is awaited later via `waitForCode()`. The timeout starts when
 * listening begins. `close()` aborts a pending wait.
 */
export function startLoopbackCallback(opts: {
  expectedState: string
  timeoutMs?: number
  port?: number
}): Promise<LoopbackCallback> {
  return startCallbackCore(opts).then((core) => ({
    port: core.port,
    redirectUri: loopbackRedirectUri(core.port),
    waitForCode: core.waitForCode,
    close: core.close,
  }))
}
