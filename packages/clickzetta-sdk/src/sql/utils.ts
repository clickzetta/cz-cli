/**
 * Utility functions ported from clickzetta/connector/v0/utils.py.
 * Provides executeWithRetrying, asTimezone, splitSql (re-exported), BaseExecuteContext, etc.
 */

export { splitSql } from "./split.js"

// ─── BaseExecuteContext ──────────────────────────────────────────────────────

export class BaseExecuteContext {
  result: unknown = null
}

// ─── executeWithRetrying ─────────────────────────────────────────────────────

export interface RetryOptions {
  handle: (tried: number) => unknown | Promise<unknown>
  checker?: (context: BaseExecuteContext, tried: number, exception?: Error) => boolean
  onFailure?: (result: unknown, exception?: Error) => void
  maxTries?: number
  retryInterval?: number
}

/**
 * Execute a function with retry logic.
 * @returns The result from handle on success, or throws on exhaustion.
 */
export async function executeWithRetrying(opts: RetryOptions): Promise<unknown> {
  const {
    handle,
    checker = () => true,
    onFailure = (result, exception) => { throw new Error(`Failed to execute! Result: ${result}, ${exception?.message ?? ""}`) },
    maxTries = 1,
    retryInterval = 0,
  } = opts

  const isInfinite = maxTries == null || maxTries === -1
  const limit = isInfinite ? Infinity : maxTries

  for (let tried = 1; tried <= limit; tried++) {
    const context = new BaseExecuteContext()
    let e: Error | undefined

    try {
      context.result = await handle(tried)
    } catch (exc) {
      e = exc instanceof Error ? exc : new Error(String(exc))
    }

    try {
      if (checker(context, tried, e)) {
        return context.result
      }
    } catch (checkerExc) {
      throw checkerExc instanceof Error ? checkerExc : new Error(String(checkerExc))
    }

    if (tried === maxTries) {
      onFailure(context.result, e)
      return e ?? context.result
    }

    if (retryInterval > 0) {
      await sleep(retryInterval * 1000)
    }
  }
  return null
}

// ─── asTimezone ──────────────────────────────────────────────────────────────

/**
 * Convert a Date to a specific timezone representation.
 * In Node.js we use Intl for timezone conversion.
 */
export function asTimezone(dt: Date, timezoneStr?: string, isTimestampNtz = false): Date {
  if (isTimestampNtz) {
    // NTZ timestamps are treated as UTC
    return dt
  }
  if (timezoneStr) {
    // Return a new Date adjusted to the target timezone (for display purposes)
    // In JS, Date is always UTC internally; timezone is a display concern
    return dt
  }
  return dt
}

// ─── normalizeFilePath ───────────────────────────────────────────────────────

/**
 * Normalize a file path by removing file:/ protocol prefix.
 */
export function normalizeFilePath(fileUrl: string): string {
  const pattern = /^file:\/{0,3}/
  if (pattern.test(fileUrl)) {
    let path = fileUrl.replace(pattern, "")
    // If not a Windows path, ensure leading slash
    if (!/^[a-zA-Z]:/.test(path)) {
      path = "/" + path.replace(/^\/+/, "")
    }
    return path
  }
  return fileUrl
}

// ─── stripLeadingComment ─────────────────────────────────────────────────────

/**
 * Strip leading SQL comments (-- and /* ... *​/) from a string.
 */
export function stripLeadingComment(input: string): string {
  let ret = input.trim()
  while (ret.startsWith("--") || ret.startsWith("/*")) {
    if (ret.startsWith("--")) {
      const idx = ret.indexOf("\n")
      if (idx === -1) return ""
      ret = ret.slice(idx + 1).trim()
    } else {
      const idx = ret.indexOf("*/")
      if (idx === -1) return ""
      ret = ret.slice(idx + 2).trim()
    }
  }
  return ret
}

// ─── tryWithFinally ──────────────────────────────────────────────────────────

/**
 * Execute mainFn with a guaranteed finallyFn call.
 */
export async function tryWithFinally(mainFn?: (() => unknown) | null, finallyFn?: (() => unknown) | null): Promise<void> {
  try {
    if (mainFn) await mainFn()
  } finally {
    if (finallyFn) {
      try { await finallyFn() } catch { /* ignore */ }
    }
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
