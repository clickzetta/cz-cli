import path from "path"
import fs from "fs"
import { Global } from "@opencode-ai/core/global"

/**
 * Compat shim for the old `Log` namespace removed upstream (v1.17.x migrated
 * to Effect-based Logging). cz's entry (main.ts) only needs imperative
 * diagnostic logging at startup, so we back it with a plain file appender at
 * the same upstream log path.
 */
export namespace Log {
  export type Level = "DEBUG" | "INFO" | "WARN" | "ERROR"

  let logFile = path.join(Global.Path.log, "opencode.log")
  let print = false
  let minLevel: Level = "INFO"
  const order: Record<Level, number> = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 }

  export function file() {
    return logFile
  }

  export async function init(opts: { print?: boolean; dev?: boolean; level?: Level }) {
    print = opts.print ?? false
    minLevel = opts.level ?? "INFO"
    fs.mkdirSync(path.dirname(logFile), { recursive: true })
  }

  function write(level: Level, message: string, data?: Record<string, unknown>) {
    if (order[level] < order[minLevel]) return
    const parts = [new Date().toISOString(), level, message]
    if (data) parts.push(JSON.stringify(data))
    const line = parts.join(" ") + "\n"
    try {
      fs.appendFileSync(logFile, line)
    } catch {}
    if (print) process.stderr.write(line)
  }

  export const Default = {
    error: (message: string, data?: Record<string, unknown>) => write("ERROR", message, data),
    warn: (message: string, data?: Record<string, unknown>) => write("WARN", message, data),
    info: (message: string, data?: Record<string, unknown>) => write("INFO", message, data),
    debug: (message: string, data?: Record<string, unknown>) => write("DEBUG", message, data),
  }

  export type Logger = typeof Default & { tag: (extra: Record<string, unknown>) => Logger }

  export function create(service: string | Record<string, unknown>): Logger {
    const base = typeof service === "string" ? { service } : service
    const withCtx = (level: Level, message: string, data?: Record<string, unknown>) =>
      write(level, message, { ...base, ...data })
    const logger: Logger = {
      error: (m, d) => withCtx("ERROR", m, d),
      warn: (m, d) => withCtx("WARN", m, d),
      info: (m, d) => withCtx("INFO", m, d),
      debug: (m, d) => withCtx("DEBUG", m, d),
      tag: (extra) => create({ ...base, ...extra }),
    }
    return logger
  }
}
