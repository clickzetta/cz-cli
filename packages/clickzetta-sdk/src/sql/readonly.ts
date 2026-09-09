import { scanSql } from "./scan.js"

export type SqlCheck = {
  kind: "readonly" | "write" | "session" | "unknown"
  reason?: string
  statements: {
    kind: "readonly" | "write" | "session" | "unknown"
    reason?: string
    sql: string
    text: string
    command: string
    start: number
    end: number
  }[]
}

// Match throughout the unquoted text, including CTE bodies and trailing clauses.
// Bare identifiers matching these words are intentionally rejected; quote them.
const WRITE =
  /\b(?:INSERT|UPDATE|DELETE|MERGE|CREATE|ALTER|DROP|UNDROP|RENAME|FORK|GRANT|REVOKE|COPY|PUT|REMOVE|RESTORE|REFRESH|CANCEL|KILL|OPTIMIZE|VACUUM|ARCHIVE|UNARCHIVE|ATTACH|DETACH)\b|\bTRUNCATE\b(?!\s*\()|\bREPLACE\b(?!\s*\()/i
const QUERY = /^(?:SELECT|VALUES|SHOW|DESC|DESCRIBE)\b/i
const UNSUPPORTED = /\b(?:BEGIN|CALL|EXECUTE|EXEC|DECLARE|SET|USE|UNSET|RESET|INTO|OUTFILE)\b/i

/** Settings whose effects are understood without changing lexical/function lookup rules. */
export function isReadonlySqlSetting(key: string): boolean {
  return /^(?:query_tag|query_timeout|time_zone|schedule_job_queue_priority|cz\.sql\.timezone|sdk\.job\.timeout|cz\.sql\.result\.row\.partial\.limit)$/i.test(
    key,
  )
}

/**
 * Best-effort accident guard: readonly means a recognized query-shaped string,
 * not proof of valid SQL or absence of UDF/view/external-service side effects.
 * Analyze the entire input after substitution, before executing any statement.
 */
export function analyzeSql(sql: string): SqlCheck {
  const scan = scanSql(sql)
  const statements = scan.statements
    .filter((item) => item.text.trim())
    .map((item) => ({
      ...item,
      ...(scan.reason ? { kind: "unknown" as const, reason: scan.reason } : classify(item.text.trim())),
    }))
  if (scan.reason) return { kind: "unknown", reason: scan.reason, statements }
  if (!statements.length) return { kind: "unknown", reason: "No SQL statements found", statements }
  const issue =
    statements.find((item) => item.kind === "write") ??
    statements.find((item) => item.kind === "unknown") ??
    statements.find((item) => item.kind === "session")
  return { kind: issue?.kind ?? "readonly", reason: issue?.reason, statements }
}

function classify(text: string): Pick<SqlCheck, "kind" | "reason"> {
  // These documented introspection prefixes contain modification keywords.
  const inspected = text
    .replace(/^SHOW\s+CREATE\s+TABLE\b/i, "SHOW TABLE")
    .replace(/^SHOW\s+DYNAMIC\s+TABLE\s+REFRESH\s+HISTORY\b/i, "SHOW HISTORY")
  const write = inspected.match(WRITE)
  if (write) return { kind: "write", reason: `Modification keyword: ${write[0].toUpperCase()}` }
  const setting = text.match(/^SET\s+([\w.]+)\s*=\s*(?:\?|[\w+./:-]+)\s*$/i)
  if (setting)
    return isReadonlySqlSetting(setting[1])
      ? { kind: "session" }
      : { kind: "unknown", reason: `Unreviewed session setting: ${setting[1]}` }
  if (/^USE\s+(?:(?:SCHEMA|WORKSPACE|VCLUSTER)\s+)?(?:\?|[\w]+)(?:\s*\.\s*(?:\?|[\w]+))*\s*$/i.test(text)) {
    return { kind: "session" }
  }
  const query = text.replace(/^EXPLAIN\s+(?:EXTENDED\s+)?/i, "")
  if (UNSUPPORTED.test(query)) return { kind: "unknown", reason: "Unsupported SQL command or clause" }
  // END also terminates CASE expressions, which are common in read queries.
  if (/\bEND\b/i.test(query) && !/\bCASE\b/i.test(query)) {
    return { kind: "unknown", reason: "Unsupported compound SQL" }
  }
  if (QUERY.test(query) || (/^WITH\b/i.test(query) && /\bSELECT\b/i.test(query))) return { kind: "readonly" }
  return { kind: "unknown", reason: "Unrecognized SQL statement" }
}
