import { ClickZettaApiError, type ApiResponse } from "./types/api.js"

const SDK_VERSION = "0.1.0"
const MAX_RETRIES = 2
const RETRY_DELAYS = [500, 1000]
const NON_RETRYABLE_STATUS = new Set([400, 403, 404, 409, 422, 504])
const AUTH_EXPIRED_STATUS = 401
const DEFAULT_TIMEOUT_MS = 60_000

export interface ClientOptions {
  baseUrl: string
  token?: string
  customHeaders?: Record<string, string>
  timeout?: number
}

export async function request<T>(
  options: ClientOptions,
  path: string,
  body?: unknown,
  method: string = "POST",
): Promise<ApiResponse<T>> {
  const url = `${options.baseUrl}${path}`
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Accept": "application/json, text/plain, */*",
    "User-Agent": `cz-cli/${SDK_VERSION}`,
    ...options.customHeaders,
  }
  if (options.token) {
    headers["X-Clickzetta-Token"] = options.token
  }

  let lastError: Error | undefined
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const resp = await fetch(url, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(options.timeout ?? DEFAULT_TIMEOUT_MS),
      })
      const text = await resp.text()
      if (!resp.ok) {
        const apiErr = new ClickZettaApiError(
          `HTTP_${resp.status}`,
          `HTTP ${resp.status}: ${text.slice(0, 500)}`,
          resp.status,
        )
        if (NON_RETRYABLE_STATUS.has(resp.status)) throw apiErr
        if (resp.status === AUTH_EXPIRED_STATUS && attempt < MAX_RETRIES) {
          try { const { clearTokenCache } = await import("./auth/token.js"); clearTokenCache() } catch {}
        }
        throw apiErr
      }
      if (!text) return {} as ApiResponse<T>
      try {
        return JSON.parse(text) as ApiResponse<T>
      } catch {
        throw new ClickZettaApiError("PARSE_ERROR", `Invalid JSON response: ${text.slice(0, 200)}`, 0)
      }
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err))
      if (err instanceof ClickZettaApiError && (NON_RETRYABLE_STATUS.has(err.statusCode ?? 0) || err.code === "PARSE_ERROR")) {
        throw err
      }
      if (attempt < MAX_RETRIES) {
        await sleep(RETRY_DELAYS[attempt])
        continue
      }
    }
  }
  throw lastError
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
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
  const url = `${options.baseUrl}${path}`
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Accept": "application/json, text/plain, */*",
    "User-Agent": `cz-cli/${SDK_VERSION}`,
    ...options.customHeaders,
  }
  if (options.token) {
    headers["X-Clickzetta-Token"] = options.token
  }

  let lastError: Error | undefined
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const resp = await fetch(url, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(options.timeout ?? DEFAULT_TIMEOUT_MS),
      })
      const text = await resp.text()
      if (!resp.ok) {
        const apiErr = new ClickZettaApiError(
          `HTTP_${resp.status}`,
          `HTTP ${resp.status}: ${text.slice(0, 500)}`,
          resp.status,
        )
        if (NON_RETRYABLE_STATUS.has(resp.status)) throw apiErr
        if (resp.status === AUTH_EXPIRED_STATUS && attempt < MAX_RETRIES) {
          try { const { clearTokenCache } = await import("./auth/token.js"); clearTokenCache() } catch {}
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
        await sleep(RETRY_DELAYS[attempt])
        continue
      }
    }
  }
  throw lastError
}
