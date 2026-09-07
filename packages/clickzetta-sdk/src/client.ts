import { ClickZettaApiError, type ApiResponse } from "./types/api.js"
import type { Credential, RequestContext, TokenSource } from "./types/index.js"
import { currentTraceparent } from "./traceparent.js"
import { getHeader, mergeHeaders } from "./headers.js"

const SDK_VERSION = "0.1.0"
const MAX_RETRIES = 3
const NON_RETRYABLE_STATUS = new Set([400, 403, 404, 409, 422])
/**
 * Error codes that end the retry loop immediately. A refresh that reported the
 * session as dead will report it again on every attempt, so retrying only adds
 * latency (and, for a profile with no credentials, further pointless network
 * calls) before the same verdict. Transient refresh failures keep retrying.
 */
const TERMINAL_ERROR_CODES = new Set(["SESSION_EXPIRED"])
const AUTH_EXPIRED_STATUS = 401
const DEFAULT_TIMEOUT_MS = 60_000

export interface ClientOptions {
  baseUrl: string
  /**
   * How this request authenticates. The transport calls `get()` before each
   * attempt and `rotate()` once on a 401, so a caller never holds a token and
   * cannot forget to wire recovery. Use `staticTokenSource` for a credential
   * with no rotation path and `anonymous()` for an unauthenticated endpoint.
   */
  tokens: TokenSource
  customHeaders?: Record<string, string>
  traceparent?: string
  timeout?: number
  /** Non-auth metadata some request bodies embed — see {@link RequestContext}. */
  context?: RequestContext
}

/**
 * Exponential backoff with jitter. Capped at 8s + up to 500ms jitter.
 * attempt is 0-indexed (0 → ~500ms, 1 → ~1s, 2 → ~2s, ... capped at 8s).
 */
export function retryDelayMs(attempt: number): number {
  const base = Math.min(500 * 2 ** attempt, 8000)
  return base + Math.random() * 500
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Generate a request id matching the Python connector format
 * (`pysdk-v{version}-{uuid12}`, client.py:292). The server uses this for
 * log correlation; every outgoing request carries its own id.
 */
function generateRequestId(): string {
  const hex = Array.from(crypto.getRandomValues(new Uint8Array(6)))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
  return `tssdk-v${SDK_VERSION}-${hex}`
}

/**
 * Header name of the wire credential. Lower case because {@link mergeHeaders}
 * folds every name that way; after a rotation the headers are rebuilt from the
 * new credential, and a different casing here would emit a duplicate field.
 */
const TOKEN_HEADER = "x-clickzetta-token"

function buildHeaders(opts: ClientOptions, credential: Credential): Record<string, string> {
  const requestId = generateRequestId()
  // Case-insensitive: a profile may spell this `Instancename`, and missing it
  // here would fall back to the context instance and emit a second, conflicting value.
  const instanceName = getHeader(opts.customHeaders, "instanceName") ?? opts.context?.instance
  return mergeHeaders(
    {
      "Content-Type": "application/json",
      "Accept": "application/json, text/plain, */*",
      "User-Agent": `tssdk/${SDK_VERSION}`,
      // client.py:293 — trace id header, required by the gateway for correlation
      "requestId": requestId,
      "X-Request-ID": requestId,
      "traceparent": opts.traceparent ?? currentTraceparent(),
      ...(instanceName ? { instanceName } : {}),
    },
    // The credential's own headers sit under the caller's: a Cookie belongs to
    // the credential, but per-call identity headers still win.
    credential.headers,
    opts.customHeaders,
    credential.token ? { [TOKEN_HEADER]: credential.token } : undefined,
  )
}

/**
 * Shared fetch + retry core used by both `request` and `requestRaw`.
 * - parseWrapper=true  → returns parsed JSON as ApiResponse<T>
 * - parseWrapper=false → returns parsed JSON as T
 *
 * Authentication is resolved here and nowhere else: the credential comes from
 * `opts.tokens` before each attempt, and a 401 asks the same source to rotate
 * it. A source with no rotation path returns undefined and the 401 stands.
 */
async function doRequest<T>(
  opts: ClientOptions,
  path: string,
  body: unknown,
  method: string,
  parseWrapper: boolean,
): Promise<T> {
  const url = `${opts.baseUrl}${path}`
  let credential = await opts.tokens.get()
  let headers = buildHeaders(opts, credential)
  // Credential a rotation just produced, to be used verbatim by the next attempt.
  // `TokenSource.rotate` is contracted to RETURN the replacement, not to make
  // `get()` observe it, so re-resolving over it would drop the rotation for any
  // source that does not also persist (the built-in one happens to, via
  // forceRefreshToken's cache write — which is exactly what would have hidden this).
  let rotatedCredential: Credential | undefined
  // A 401 gets exactly one rotation per request, matching RFC 6750's single
  // re-authentication challenge: a second rejection is the server's answer
  // about this identity, not a race we should keep re-running.
  let rotated = false
  // Set when a 401 cannot be recovered from. The generic retry loop below would
  // otherwise resend the very credential the server just rejected, which is
  // never useful and delays the error by three backoffs.
  let authExhausted = false

  let lastError: Error | undefined
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      if (attempt > 0) {
        // Prefer the rotated credential; otherwise re-resolve, because a retry
        // after a multi-second backoff must not resend one that expired while
        // we waited. `get()` is cache-backed, so re-resolving costs nothing.
        credential = rotatedCredential ?? await opts.tokens.get()
        rotatedCredential = undefined
        headers = buildHeaders(opts, credential)
      }
      const resp = await fetch(url, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(opts.timeout ?? DEFAULT_TIMEOUT_MS),
      })
      const text = await resp.text()
      if (!resp.ok) {
        const apiErr = new ClickZettaApiError(
          `HTTP_${resp.status}`,
          `HTTP ${resp.status}: ${text.slice(0, 1000)}`,
          resp.status,
        )
        if (NON_RETRYABLE_STATUS.has(resp.status)) throw apiErr
        if (resp.status === AUTH_EXPIRED_STATUS) {
          // Rotation is offered once; a source that cannot rotate (or a second
          // rejection) makes this 401 the final answer for this identity.
          const fresh = rotated || attempt >= MAX_RETRIES
            ? undefined
            : await opts.tokens.rotate(credential)
          if (!fresh) {
            authExhausted = true
            throw apiErr
          }
          rotated = true
          rotatedCredential = fresh
        }
        throw apiErr
      }
      if (!text) return {} as T
      try {
        return JSON.parse(text) as T
      } catch {
        throw new ClickZettaApiError("PARSE_ERROR", `Invalid JSON response: ${text.slice(0, 200)}`, 0)
      }
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err))
      if (err instanceof ClickZettaApiError && (NON_RETRYABLE_STATUS.has(err.statusCode ?? 0) || err.code === "PARSE_ERROR")) {
        throw err
      }
      if (authExhausted) throw err
      if (TERMINAL_ERROR_CODES.has(String((err as { code?: unknown }).code ?? ""))) throw err
      if (attempt < MAX_RETRIES) {
        await sleep(retryDelayMs(attempt))
        continue
      }
    }
  }
  // Signal to callers: parseWrapper is unused on the error path but
  // retained to keep the generic T in scope.
  void parseWrapper
  throw lastError
}

export async function request<T>(
  options: ClientOptions,
  path: string,
  body?: unknown,
  method: string = "POST",
): Promise<ApiResponse<T>> {
  return doRequest<ApiResponse<T>>(options, path, body, method, true)
}

/**
 * Raw request that returns the parsed JSON body directly without assuming
 * an ApiResponse<T> wrapper. Used for /lh/submitJob and /lh/getJob which
 * return their own response format.
 */
export async function requestRaw<T = unknown>(
  options: ClientOptions,
  path: string,
  body?: unknown,
  method: string = "POST",
): Promise<T> {
  return doRequest<T>(options, path, body, method, false)
}
