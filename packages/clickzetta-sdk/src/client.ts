import { ClickZettaApiError, type ApiResponse } from "./types/api.js"

const MAX_RETRIES = 2
const RETRY_DELAYS = [500, 1000]

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
        signal: options.timeout
          ? AbortSignal.timeout(options.timeout)
          : undefined,
      })
      const text = await resp.text()
      if (!resp.ok) {
        const parsed = tryParseJson(text)
        if (parsed && typeof parsed === "object" && "code" in parsed) {
          return parsed as ApiResponse<T>
        }
        throw new ClickZettaApiError(
          `HTTP_${resp.status}`,
          `HTTP ${resp.status}: ${text}`,
          resp.status,
        )
      }
      return JSON.parse(text) as ApiResponse<T>
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err))
      if (attempt < MAX_RETRIES) {
        await sleep(RETRY_DELAYS[attempt])
        continue
      }
    }
  }
  throw lastError
}

function tryParseJson(text: string): unknown {
  try { return JSON.parse(text) } catch { return undefined }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
