import { afterEach, beforeEach } from "bun:test"

/**
 * Generic, domain-agnostic HTTP boundary for tests.
 *
 * All ClickZetta SDK network I/O funnels through `globalThis.fetch`
 * (packages/clickzetta-sdk/src/client.ts, auth/*, studio/*), so intercepting
 * fetch is the single seam that lets a test run the REAL cz-cli code path
 * (getStudioContext, resolver, exec, command handlers, …) against canned
 * responses — instead of `mock.module`-ing our own src, which is process-global,
 * leaks across files, and diverges from opencode's convention of only mocking
 * true boundaries.
 *
 * This module knows nothing about ClickZetta URLs or payload shapes; those live
 * in ./cz-fixtures. Register handlers with {@link onFetch} / {@link onStudio}.
 * A test that registers no handler is treated as not opting in — its requests
 * fall through to the real fetch. Once a test registers any handler, an
 * unmatched request throws, so a missing fixture is a loud failure.
 */

export interface FetchHandler {
  match: (url: string, method: string, body: unknown) => boolean
  respond: (url: string, method: string, body: unknown, headers: Record<string, string>) => unknown
}

let handlers: FetchHandler[] = []
let realFetch: typeof globalThis.fetch | undefined

function parseHeaders(init: RequestInit | undefined, input: RequestInfo | URL): Record<string, string> {
  const source = init?.headers ?? (input instanceof Request ? input.headers : undefined)
  const out: Record<string, string> = {}
  if (!source) return out
  if (source instanceof Headers) {
    source.forEach((value, key) => (out[key.toLowerCase()] = value))
  } else if (Array.isArray(source)) {
    for (const [key, value] of source) out[key.toLowerCase()] = value
  } else {
    for (const [key, value] of Object.entries(source)) out[key.toLowerCase()] = String(value)
  }
  return out
}

function parseBody(init?: RequestInit): unknown {
  const raw = init?.body
  if (typeof raw !== "string") return undefined
  try {
    return JSON.parse(raw)
  } catch {
    return raw
  }
}

function toResponse(value: unknown): Response {
  if (value instanceof Response) return value
  return new Response(JSON.stringify(value ?? {}), {
    status: 200,
    headers: { "content-type": "application/json" },
  })
}

/** Install the fetch interceptor. Called once from preload; idempotent. */
export function installFetchBoundary(): void {
  if (realFetch) return
  realFetch = globalThis.fetch
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url
    const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase()
    const body = parseBody(init)
    const headers = parseHeaders(init, input)
    for (const handler of handlers) {
      if (handler.match(url, method, body)) return toResponse(handler.respond(url, method, body, headers))
    }
    // A test that registered nothing did not opt into the boundary — pass through
    // to the real fetch. Once it registers a handler, an unmatched request is a
    // real gap and must fail loudly rather than hit the network.
    if (handlers.length === 0) return realFetch!(input, init)
    throw new Error(`[test fetch] no handler for ${method} ${url} — register one with onFetch()/onStudio()`)
  }) as typeof globalThis.fetch
}

/** Register a raw fetch handler for the current test. Cleared after each test. */
export function onFetch(handler: FetchHandler): void {
  handlers.push(handler)
}

/**
 * Register a handler matched by a URL path substring (e.g. "/user/getCurrentUser").
 * `respond` receives the parsed request body; use {@link onFetch} for url/headers.
 */
export function onPath(pathIncludes: string, respond: (body: unknown) => unknown): void {
  onFetch({ match: (url) => url.includes(pathIncludes), respond: (_url, _method, body) => respond(body) })
}

export function clearFetchHandlers(): void {
  handlers = []
}

// Per-test lifecycle, wired globally via the preload import.
beforeEach(installFetchBoundary)
afterEach(clearFetchHandlers)
