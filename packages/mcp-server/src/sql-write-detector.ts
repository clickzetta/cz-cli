/**
 * SQLWriteDetector — line-by-line port of cz-mcp-server/cz_mcp/core/write_detector.py
 *
 * The Python implementation uses `sqlparse` for tokenization; we keep the
 * same surface API and behavioural contract but do our own lightweight
 * tokenization since node has no sqlparse equivalent and the write-keyword
 * set is small and deterministic.
 */

export type WriteOperation =
  | "INSERT" | "UPDATE" | "DELETE" | "MERGE" | "TRUNCATE"
  | "COPY" | "PUT" | "REMOVE" | "REFRESH" | "RESTORE"
  | "CREATE" | "ALTER" | "DROP" | "UNDROP" | "RENAME" | "REPLACE" | "CLONE"
  | "GRANT" | "REVOKE"
  | "CTE_WRITE"

export interface WriteAnalysis {
  contains_write: boolean
  write_operations: Set<WriteOperation>
  has_cte_write: boolean
  cte_operations: Set<WriteOperation>
  operation_type: WriteOperation | "UNKNOWN"
}

// write_detector.py:12
const DML_WRITE_KEYWORDS: ReadonlySet<WriteOperation> = new Set([
  "INSERT", "UPDATE", "DELETE", "MERGE", "TRUNCATE",
  "COPY", "PUT", "REMOVE", "REFRESH", "RESTORE",
])
// write_detector.py:14
const DDL_KEYWORDS: ReadonlySet<WriteOperation> = new Set([
  "CREATE", "ALTER", "DROP", "UNDROP", "RENAME", "REPLACE", "CLONE",
])
// write_detector.py:16
const DCL_KEYWORDS: ReadonlySet<WriteOperation> = new Set(["GRANT", "REVOKE"])

// write_detector.py:19
const WRITE_KEYWORDS: ReadonlySet<WriteOperation> = new Set([
  ...DML_WRITE_KEYWORDS, ...DDL_KEYWORDS, ...DCL_KEYWORDS,
])

// Priority order used by _determine_operation_type (write_detector.py:208-263).
const OPERATION_TYPE_ORDER: WriteOperation[] = [
  "CREATE", "ALTER", "DROP", "RENAME", "REPLACE", "CLONE", "UNDROP",
  "INSERT", "UPDATE", "DELETE", "MERGE", "TRUNCATE",
  "COPY", "PUT", "REMOVE",
  "REFRESH", "RESTORE",
  "GRANT", "REVOKE",
  "CTE_WRITE",
]

/**
 * Strip SQL line and block comments, collapse quoted strings to `""`
 * so keyword matching never hits content inside literals or comments.
 * Case-preserving.
 */
function stripCommentsAndLiterals(sql: string): string {
  let out = ""
  let i = 0
  while (i < sql.length) {
    const c = sql[i]
    const n = sql[i + 1]
    // Line comment -- …
    if (c === "-" && n === "-") {
      while (i < sql.length && sql[i] !== "\n") i++
      continue
    }
    // Block comment /* … */
    if (c === "/" && n === "*") {
      i += 2
      while (i < sql.length && !(sql[i] === "*" && sql[i + 1] === "/")) i++
      i += 2
      continue
    }
    // String literal '…' / "…" — keep empty quotes as placeholder.
    if (c === "'" || c === '"') {
      const quote = c
      out += quote + quote
      i++
      while (i < sql.length) {
        if (sql[i] === "\\" && i + 1 < sql.length) { i += 2; continue }
        if (sql[i] === quote) { i++; break }
        i++
      }
      continue
    }
    // Backtick identifier `…` — preserve bytes (may contain keywords).
    if (c === "`") {
      out += "``"
      i++
      while (i < sql.length && sql[i] !== "`") i++
      i++
      continue
    }
    out += c
    i++
  }
  return out
}

/**
 * Tokenize the scrubbed SQL into upper-cased keyword-shaped tokens.
 * Anything non-alphanumeric (including parens) is its own token.
 */
function tokenize(sql: string): string[] {
  const upper = sql.toUpperCase()
  const tokens: string[] = []
  let i = 0
  while (i < upper.length) {
    const c = upper[i]
    if (/\s/.test(c)) { i++; continue }
    if (/[A-Z_]/.test(c)) {
      let j = i
      while (j < upper.length && /[A-Z0-9_]/.test(upper[j])) j++
      tokens.push(upper.slice(i, j))
      i = j
      continue
    }
    tokens.push(c)
    i++
  }
  return tokens
}

/**
 * Python: _is_read_only_show_command (write_detector.py:170-178) — any
 * SHOW CREATE … command is read-only and should not trigger a write verdict.
 */
function isReadOnlyShowCommand(sql: string): boolean {
  const text = sql.trim().toUpperCase()
  return text.startsWith("SHOW CREATE")
}

/**
 * Python: _detect_create_or_replace (write_detector.py:180-192).
 * Adds both CREATE and REPLACE when the phrase appears.
 */
function detectCreateOrReplace(sql: string): Set<WriteOperation> {
  const ops = new Set<WriteOperation>()
  if (/\bCREATE\s+OR\s+REPLACE\b/i.test(sql)) {
    ops.add("CREATE")
    ops.add("REPLACE")
  }
  return ops
}

/**
 * Python: _is_function_call (write_detector.py:155-168).
 * TRUNCATE(x, 2) is a function, TRUNCATE TABLE t is DDL.
 * Two conditions (py:163-167):
 *   1. next token is "(" — e.g. TRUNCATE(
 *   2. token itself ends with "(" — e.g. TRUNCATE( as a single token
 */
function isFunctionCall(tokens: string[], idx: number): boolean {
  const next = tokens[idx + 1]
  if (next === "(") return true
  // write_detector.py:166 — token itself ends with "("
  const t = tokens[idx] ?? ""
  if (t.endsWith("(")) return true
  return false
}

/**
 * Python: _find_write_operations (write_detector.py:109-153).
 */
function findWriteOperations(rawSql: string): Set<WriteOperation> {
  const ops = new Set<WriteOperation>()
  if (isReadOnlyShowCommand(rawSql)) return ops

  const scrubbed = stripCommentsAndLiterals(rawSql)
  for (const op of detectCreateOrReplace(scrubbed)) ops.add(op)

  const tokens = tokenize(scrubbed)
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i] as WriteOperation
    if (!WRITE_KEYWORDS.has(t)) continue
    if (isFunctionCall(tokens, i)) continue
    ops.add(t)
  }

  // write_detector.py:142-151 — additional string-based detection for edge
  // cases where the keyword is followed by a space (e.g. "INSERT ").
  // Python iterates all tokens and checks token_str.startswith(write_keyword + ' ').
  for (const keyword of WRITE_KEYWORDS) {
    const pattern = keyword + " "
    if (scrubbed.toUpperCase().includes(pattern)) {
      ops.add(keyword as WriteOperation)
    }
  }

  return ops
}

/**
 * Python: _has_cte / _analyze_cte (write_detector.py:64-107).
 * Returns true when a write keyword appears inside a WITH(...) CTE body.
 */
function analyzeCte(rawSql: string): boolean {
  const scrubbed = stripCommentsAndLiterals(rawSql)
  const tokens = tokenize(scrubbed)

  let inCte = false
  let parenDepth = 0
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]
    if (t === "WITH") { inCte = true; continue }
    if (!inCte) continue
    if (t === "(") parenDepth++
    else if (t === ")") parenDepth--

    // Exit CTE when paren depth returns to 0 and the next keyword is a
    // top-level clause. Python: write_detector.py:93-99.
    if (parenDepth === 0) {
      const next = tokens[i + 1]
      if (next === "SELECT" || next === "FROM" || next === "WHERE") {
        inCte = false
        continue
      }
    }

    if (inCte && parenDepth > 0 && WRITE_KEYWORDS.has(t as WriteOperation)) {
      if (!isFunctionCall(tokens, i)) return true
    }
  }
  return false
}

/**
 * Python: _determine_operation_type (write_detector.py:194-263).
 */
function determineOperationType(
  ops: Set<WriteOperation>,
): WriteOperation | "UNKNOWN" {
  if (ops.size === 0) return "UNKNOWN"
  for (const candidate of OPERATION_TYPE_ORDER) {
    if (ops.has(candidate)) return candidate
  }
  return [...ops][0] ?? "UNKNOWN"
}

/**
 * Split a multi-statement SQL blob at top-level `;` boundaries,
 * respecting quotes / comments. Mirrors Python's sqlparse.parse()
 * loop in analyze_query.
 */
function splitStatements(sql: string): string[] {
  const out: string[] = []
  let buf = ""
  let i = 0
  while (i < sql.length) {
    const c = sql[i]
    const n = sql[i + 1]
    if (c === "-" && n === "-") {
      while (i < sql.length && sql[i] !== "\n") { buf += sql[i]; i++ }
      continue
    }
    if (c === "/" && n === "*") {
      buf += "/*"; i += 2
      while (i < sql.length && !(sql[i] === "*" && sql[i + 1] === "/")) { buf += sql[i]; i++ }
      buf += "*/"; i += 2
      continue
    }
    if (c === "'" || c === '"' || c === "`") {
      const q = c
      buf += c; i++
      while (i < sql.length) {
        buf += sql[i]
        if (sql[i] === "\\" && i + 1 < sql.length) { buf += sql[i + 1]; i += 2; continue }
        if (sql[i] === q) { i++; break }
        i++
      }
      continue
    }
    if (c === ";") {
      if (buf.trim()) out.push(buf)
      buf = ""; i++
      continue
    }
    buf += c
    i++
  }
  if (buf.trim()) out.push(buf)
  return out
}

export class SQLWriteDetector {
  /**
   * Python: analyze_query (write_detector.py:21-62).
   */
  analyzeQuery(sqlQuery: string): WriteAnalysis {
    const statements = splitStatements(sqlQuery)
    if (statements.length === 0) {
      return {
        contains_write: false,
        write_operations: new Set(),
        has_cte_write: false,
        cte_operations: new Set(),
        operation_type: "UNKNOWN",
      }
    }

    const found = new Set<WriteOperation>()
    let hasCteWrite = false

    for (const stmt of statements) {
      if (analyzeCte(stmt)) {
        hasCteWrite = true
        found.add("CTE_WRITE")
      }
      for (const op of findWriteOperations(stmt)) found.add(op)
    }

    const operationType = determineOperationType(found)
    const containsWrite = found.size > 0 || hasCteWrite

    return {
      contains_write: containsWrite,
      write_operations: found,
      has_cte_write: hasCteWrite,
      cte_operations: new Set(),
      operation_type: operationType,
    }
  }
}
