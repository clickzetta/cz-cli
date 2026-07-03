import { homedir } from "node:os"
import { join, dirname } from "node:path"
import { appendFile, mkdir } from "node:fs/promises"

const LOG_DIR = join(homedir(), ".clickzetta")
const LOG_FILE = join(LOG_DIR, "sql-history.jsonl")

const RE_QUOTED = /'([^']*)'/g
const RE_PHONE = /^1[3-9]\d{9}$/
const RE_IDCARD = /^\d{17}[\dXx]?$/
const RE_SENSITIVE_COL = /(password|passwd|secret|api_key|apikey|phone|mobile|id_card|idcard|email)\s*[,)]/i

export function redactSql(sql: string): string {
  let lastEnd = 0
  const out: string[] = []

  for (const m of sql.matchAll(RE_QUOTED)) {
    const matchStart = m.index!
    const matchEnd = matchStart + m[0].length
    out.push(sql.slice(lastEnd, matchStart))

    const val = m[1]
    let redacted: string | null = null

    if (RE_PHONE.test(val)) {
      const digits = val.replace(/\D/g, "")
      redacted = digits.length >= 7 ? digits.slice(0, 3) + "****" + digits.slice(-4) : "****"
    } else if (RE_IDCARD.test(val)) {
      redacted = val.length >= 6 ? val.slice(0, 3) + "*".repeat(Math.max(1, val.length - 7)) + val.slice(-4) : "****"
    } else if (val.includes("@")) {
      const atIdx = val.lastIndexOf("@")
      const local = val.slice(0, atIdx)
      const domain = val.slice(atIdx + 1)
      redacted = local.length > 1 ? local[0] + "***@" + domain : "***@" + domain
    } else {
      let prefix = sql.slice(0, matchStart)
      if (prefix.length > 400) prefix = prefix.slice(-400)
      if (RE_SENSITIVE_COL.test(prefix) && /^[\w\d_]+$/.test(val) && val.length >= 6) {
        redacted = "******"
      }
    }

    if (redacted !== null) {
      out.push("'" + redacted + "'")
    } else {
      out.push(m[0])
    }
    lastEnd = matchEnd
  }

  out.push(sql.slice(lastEnd))
  return out.join("")
}

export function logOperation(
  command: string,
  opts?: {
    sql?: string
    ok?: boolean
    rows?: number
    timeMs?: number
    errorCode?: string
  },
): void {
  const entry: Record<string, unknown> = {
    ts: new Date().toISOString().slice(0, 19),
    command,
  }
  if (opts?.sql !== undefined) entry.sql = redactSql(opts.sql)
  entry.ok = opts?.ok ?? true
  if (opts?.rows !== undefined) entry.rows = opts.rows
  if (opts?.timeMs) entry.time_ms = opts.timeMs
  if (opts?.errorCode) entry.error_code = opts.errorCode

  mkdir(LOG_DIR, { recursive: true })
    .then(() => appendFile(LOG_FILE, JSON.stringify(entry) + "\n"))
    .catch(() => {})
}
