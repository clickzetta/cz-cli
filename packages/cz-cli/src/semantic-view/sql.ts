import { SemanticViewError } from "./error.js"

export type Token = {
  text: string
  value: string
  kind: "identifier" | "string" | "number" | "symbol" | "space" | "comment"
}

/** Lossless lexer: strings/comments are never interpreted as identifier references. */
export function tokenize(sql: string): Token[] {
  const result: Token[] = []
  const pattern =
    /\s+|--[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\/|'(?:''|\\.|[^'\\])*'|`(?:``|[^`])*`|"(?:""|[^"])*"|[\p{L}_$][\p{L}\p{N}_$]*|(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?|./gu
  for (const match of sql.matchAll(pattern)) {
    const text = match[0]
    const kind = /^\s/.test(text)
      ? "space"
      : /^(--|\/\*)/.test(text)
        ? "comment"
        : text[0] === "'"
          ? "string"
          : /^[`"\p{L}_$]/u.test(text)
            ? "identifier"
            : /^\d|^\.\d/.test(text)
              ? "number"
              : "symbol"
    if (["'", "`", '"'].includes(text) || text === "\\")
      throw new SemanticViewError("INVALID_SQL", "Unterminated quoted SQL token")
    result.push({
      text,
      kind,
      value: /^[`"]/.test(text) ? text.slice(1, -1).replaceAll(text[0].repeat(2), text[0]) : text,
    })
  }
  return result
}

export function identifier(value: string) {
  if (!value || value.includes("\0"))
    throw new SemanticViewError("INVALID_IDENTIFIER", "Identifier cannot be empty or contain NUL")
  return "`" + value.replaceAll("`", "``") + "`"
}

export function literal(value: string) {
  // Native ClickZetta uses BACKSLASH mode; adjacent '...' strings concatenate.
  return "'" + value.replaceAll("\\", "\\\\").replaceAll("'", "\\'") + "'"
}

export function nameParts(value: string) {
  const tokens = tokenize(value).filter((t) => t.kind !== "space")
  if (
    !tokens.length ||
    tokens.some((t, i) => (i % 2 === 0 ? t.kind !== "identifier" : t.text !== ".")) ||
    tokens.length % 2 === 0
  ) {
    throw new SemanticViewError("INVALID_IDENTIFIER", `Expected a qualified identifier: ${value}`)
  }
  return tokens.filter((_, i) => i % 2 === 0).map((t) => t.value)
}

export function qualified(value: string) {
  return nameParts(value).map(identifier).join(".")
}

export function storedName(value: string) {
  const parts = nameParts(value)
  if (parts.length > 3 || parts.some((p) => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(p))) {
    throw new SemanticViewError(
      "INVALID_TARGET",
      "Stored workspace, schema and view names must contain only letters, digits and underscores",
    )
  }
  return parts
}

export function expression(value: string) {
  if (value.includes("/*") || value.includes("*/"))
    throw new SemanticViewError("INVALID_EXPRESSION", "Expressions cannot contain comments")
  const tokens = tokenize(value)
  const state = { depth: 0 }
  if (!tokens.some((t) => t.kind !== "space"))
    throw new SemanticViewError("INVALID_EXPRESSION", "SQL expression cannot be empty")
  for (const t of tokens) {
    if (t.kind === "comment" || t.text === ";")
      throw new SemanticViewError("INVALID_EXPRESSION", "Expressions cannot contain comments or statement separators")
    if (t.text === "(") state.depth++
    if (t.text === ")") state.depth--
    if (state.depth < 0) throw new SemanticViewError("INVALID_EXPRESSION", "Unbalanced expression")
  }
  if (state.depth) throw new SemanticViewError("INVALID_EXPRESSION", "Unbalanced expression")
  return value
}

export function references(sql: string) {
  const tokens = tokenize(sql)
  const significant = tokens.map((t, i) => ({ t, i })).filter((x) => !["space", "comment"].includes(x.t.kind))
  const refs: { parts: string[]; start: number; end: number; call: boolean; aggregate: boolean }[] = []
  const scopes: boolean[] = []
  const aggregates =
    /^(SUM|AVG|COUNT|MIN|MAX|COUNT_IF|APPROX_COUNT_DISTINCT|ARRAY_AGG|LISTAGG|STDDEV|VARIANCE|ANY_VALUE)$/i
  for (let i = 0; i < significant.length; i++) {
    const first = significant[i]
    if (first.t.text === "(") scopes.push(aggregates.test(significant[i - 1]?.t.value ?? ""))
    if (first.t.text === ")") scopes.pop()
    if (first.t.kind !== "identifier") continue
    const parts = [first.t.value]
    const start = first.i
    while (significant[i + 1]?.t.text === "." && significant[i + 2]?.t.kind === "identifier") {
      parts.push(significant[i + 2].t.value)
      i += 2
    }
    refs.push({
      parts,
      start,
      end: significant[i].i + 1,
      call: significant[i + 1]?.t.text === "(",
      aggregate: scopes.includes(true),
    })
  }
  return { tokens, refs }
}

export function rewriteReferences(
  sql: string,
  rewrite: (parts: string[], call: boolean, aggregate: boolean) => string | undefined,
) {
  const parsed = references(sql)
  const replacements = new Map(
    parsed.refs.map((r) => [r.start, { ...r, replacement: rewrite(r.parts, r.call, r.aggregate) }]),
  )
  const output: string[] = []
  for (let i = 0; i < parsed.tokens.length; i++) {
    const match = replacements.get(i)
    if (match?.replacement !== undefined) {
      output.push(match.replacement)
      i = match.end - 1
      continue
    }
    output.push(parsed.tokens[i].text)
  }
  return output.join("")
}

const KEYWORDS = new Set(
  "AND OR NOT NULL TRUE FALSE IS IN LIKE ILIKE BETWEEN CASE WHEN THEN ELSE END AS DISTINCT ALL OVER PARTITION ORDER BY ASC DESC NULLS FIRST LAST ROWS RANGE UNBOUNDED PRECEDING FOLLOWING CURRENT ROW INTERVAL DATE TIMESTAMP STRING BIGINT INT INTEGER DOUBLE FLOAT DECIMAL BOOLEAN YEAR MONTH DAY HOUR MINUTE SECOND EXTRACT FROM FILTER WHERE CAST TRY_CAST".split(
    " ",
  ),
)

export function normalizeExpression(sql: string, table?: string) {
  // The server inserts the default ascending direction into window ORDER BY.
  const canonical = tokenize(sql)
    .filter((t) => t.text.toUpperCase() !== "ASC")
    .map((t) => t.text)
    .join("")
  return tokenize(
    rewriteReferences(canonical, (parts, call) => {
      if (call) return parts.join(".").toLowerCase()
      if (parts.length === 1 && table && !KEYWORDS.has(parts[0].toUpperCase()))
        return [table, parts[0]].map(identifier).join(".")
      return parts.map((p) => p.toLowerCase()).join(".")
    }),
  )
    .filter((t) => !["space", "comment"].includes(t.kind))
    .map((t) => (t.kind === "identifier" ? t.value.toLowerCase() : t.text))
    .join(" ")
}

export function sqlKeyword(value: string) {
  return KEYWORDS.has(value.toUpperCase())
}

/** Compare scalar arithmetic trees, without reassociation or changing stored fingerprints. */
export function arithmeticShape(sql: string) {
  type Node = string | Node[]
  const tokens = tokenize(sql).filter((token) => !["space", "comment"].includes(token.kind))
  if (tokens.length > 1024) return
  const state = { index: 0 }
  const precedence = new Map([
    ["+", 1],
    ["-", 1],
    ["*", 2],
    ["/", 2],
    ["%", 2],
  ])
  function atom(depth: number): Node | undefined {
    if (depth > 128) return
    const token = tokens[state.index++]
    if (!token) return
    if (token.text === "(") {
      const value = parse(0, depth + 1)
      if (value === undefined || tokens[state.index++]?.text !== ")") return
      return value
    }
    if (token.text === "+" || token.text === "-") {
      const operand = parse(3, depth + 1)
      if (operand === undefined) return
      return ["unary", token.text, operand]
    }
    if (token.kind === "number") return ["number", token.text]
    if (token.kind === "identifier") {
      const parts = [token.value]
      while (tokens[state.index]?.text === ".") {
        state.index++
        const next = tokens[state.index++]
        if (next?.kind !== "identifier") return
        parts.push(next.value)
      }
      return ["reference", parts]
    }
  }
  function parse(minimum: number, depth: number): Node | undefined {
    let left = atom(depth)
    if (left === undefined) return
    while (state.index < tokens.length) {
      const operator = tokens[state.index].text
      const level = precedence.get(operator)
      if (level === undefined || level < minimum) break
      state.index++
      const right = parse(level + 1, depth + 1)
      if (right === undefined) return
      left = ["binary", operator, left, right]
    }
    return left
  }
  // Unsupported syntax (functions, CASE, windows, casts, comparisons) stays exact.
  const shape = parse(0, 0)
  return shape !== undefined && state.index === tokens.length ? JSON.stringify(shape) : undefined
}
