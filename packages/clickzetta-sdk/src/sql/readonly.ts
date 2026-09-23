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

/**
 * Introspection forms whose own text contains a WRITE keyword, and the neutral text
 * to read in their place. Exactly one entry applies — see classify().
 */
const INTROSPECTION_PREFIXES: [RegExp, string][] = [
  [/^SHOW\s+CREATE\b/i, "SHOW"],
  [/^SHOW\s+DYNAMIC\s+TABLE\s+REFRESH\s+HISTORY\b/i, "SHOW HISTORY"],
]

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
  // EXPLAIN returns a plan and executes nothing, so unwrap it before any other rule
  // looks at the statement. This used to happen after the WRITE scan, which left
  // `EXPLAIN SHOW CREATE VIEW v` demanding write approval — CREATE was still in the
  // string WRITE read — while plain `SHOW CREATE VIEW v` was readonly.
  // `EXPLAIN ANALYZE` is deliberately not unwrapped: the documented grammar is
  // `EXPLAIN [EXTENDED] query_statement`, and an ANALYZE form executes the statement
  // on some engines, so it keeps failing closed as unrecognized.
  const query = text.replace(/^EXPLAIN\s+(?:EXTENDED\s+)?/i, "")
  // Introspection whose own text contains a WRITE keyword: SHOW CREATE <object>
  // (CREATE) and SHOW DYNAMIC TABLE REFRESH HISTORY (REFRESH). Neutralize the
  // leading form before the WRITE scan so it is not misread as a modification.
  //
  // Alternatives, not a chain. Chained `.replace()` calls let the first rule's
  // OUTPUT satisfy the second rule's anchor: `SHOW CREATE DYNAMIC TABLE REFRESH
  // HISTORY` became `SHOW DYNAMIC TABLE REFRESH HISTORY`, then collapsed to the
  // literal "SHOW HISTORY", so its REFRESH was gone before WRITE ever ran. Applying
  // only the first matching rule keeps each one scoped to the form it describes.
  //
  // The SHOW CREATE strip is open-ended on purpose, not an allowlist of object
  // types: `SHOW CREATE <anything>` only ever returns a definition, and the
  // documented set (TABLE, MATERIALIZED VIEW, DYNAMIC TABLE, EXTERNAL TABLE, PIPE,
  // SEMANTIC VIEW) keeps growing. This does not open a hole: only a literal leading
  // `SHOW CREATE` is consumed, so a write verb anywhere after it still hits WRITE
  // (`SHOW CREATE OR REPLACE VIEW v` -> write), and multi-statement input is split
  // on `;` before reaching here (`SHOW CREATE VIEW v; DROP VIEW v` -> write).
  const prefix = INTROSPECTION_PREFIXES.find(([pattern]) => pattern.test(query))
  const inspected = prefix ? query.replace(prefix[0], prefix[1]) : query
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
  if (UNSUPPORTED.test(query)) return { kind: "unknown", reason: "Unsupported SQL command or clause" }
  // END also terminates CASE expressions, which are common in read queries.
  if (/\bEND\b/i.test(query) && !/\bCASE\b/i.test(query)) {
    return { kind: "unknown", reason: "Unsupported compound SQL" }
  }
  if (QUERY.test(query) || (/^WITH\b/i.test(query) && /\bSELECT\b/i.test(query))) return { kind: "readonly" }
  return { kind: "unknown", reason: "Unrecognized SQL statement" }
}
