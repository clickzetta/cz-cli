import { ClickZettaApiError, type ApiResponse } from "./types/api.js"
import type { ConnectionConfig } from "./types/index.js"
import { currentTraceparent } from "./traceparent.js"

const SDK_VERSION = "0.1.0"
const MAX_RETRIES = 3
const NON_RETRYABLE_STATUS = new Set([400, 403, 404, 409, 422])
const AUTH_EXPIRED_STATUS = 401
const DEFAULT_TIMEOUT_MS = 60_000

export interface ClientOptions {
  baseUrl: string
  token?: string
  customHeaders?: Record<string, string>
  traceparent?: string
  timeout?: number
  /**
   * Optional connection config. When present, a 401 response will
   * trigger an automatic `forceRefreshToken(config)` and retry with
   * the refreshed token. Backwards compatible: when omitted, 401
   * behaves as before (only the token cache is cleared).
   */
  config?: ConnectionConfig
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

function buildHeaders(opts: ClientOptions): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Accept": "application/json, text/plain, */*",
    "User-Agent": `tssdk/${SDK_VERSION}`,
    // client.py:293 — trace id header, required by the gateway for correlation
    "requestId": generateRequestId(),
    "traceparent": opts.traceparent ?? currentTraceparent(),
    ...opts.customHeaders,
  }
  if (opts.token) {
    headers["X-Clickzetta-Token"] = opts.token
  }
  return headers
}

/**
 * Shared fetch + retry core used by both `request` and `requestRaw`.
 * - parseWrapper=true  → returns parsed JSON as ApiResponse<T>
 * - parseWrapper=false → returns parsed JSON as T
 *
 * On 401, if `opts.config` is provided, we force-refresh the token
 * and retry with the new value written back into `opts.token`
 * (so subsequent attempts in the same loop pick it up too).
 */
async function doRequest<T>(
  opts: ClientOptions,
  path: string,
  body: unknown,
  method: string,
  parseWrapper: boolean,
): Promise<T> {
  const url = `${opts.baseUrl}${path}`
  const headers = buildHeaders(opts)

  let lastError: Error | undefined
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
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
        if (resp.status === AUTH_EXPIRED_STATUS && attempt < MAX_RETRIES) {
          const { clearTokenCache, forceRefreshToken } = await import("./auth/token.js")
          clearTokenCache()
          if (opts.config) {
            try {
              const fresh = await forceRefreshToken(opts.config)
              opts.token = fresh.token
              headers["X-Clickzetta-Token"] = fresh.token
            } catch (refreshErr) {
              // Bubble up the refresh error as the final cause so
              // callers see why we gave up on this request.
              throw refreshErr
            }
          }
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
