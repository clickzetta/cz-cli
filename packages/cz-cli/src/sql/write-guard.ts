/**
 * True when a statement is a DELETE or UPDATE (optionally parenthesized and/or
 * behind a WITH list) that has no WHERE at its own parenthesis depth. Words in
 * subqueries, string literals, quoted identifiers, and comments do not count.
 * Fails closed: a WITH list that cannot be followed is treated as unrestricted
 * when a DELETE or UPDATE appears anywhere in the statement.
 */
export function isUnrestrictedWrite(sql: string) {
  const tokens = tokenize(sql)
  const start = findStatement(tokens)
  if (start === undefined) return tokens.some((t) => t.text === "DELETE" || t.text === "UPDATE")
  const kind = tokens[start]
  if (kind.text !== "DELETE" && kind.text !== "UPDATE") return false
  const end = tokens.findIndex((t, i) => i > start && t.depth < kind.depth)
  return !tokens.slice(start + 1, end === -1 ? undefined : end).some((t) => t.text === "WHERE" && t.depth === kind.depth)
}

type Token = { text: string; depth: number }

/** Index of the statement keyword after leading parens and a WITH list, or undefined if the WITH list is malformed. */
function findStatement(tokens: Token[]) {
  let i = 0
  while (tokens[i]?.text === "(") i++
  if (tokens[i]?.text !== "WITH") return i < tokens.length ? i : undefined
  i++
  if (tokens[i]?.text === "RECURSIVE") i++
  while (true) {
    // name, optional column list, AS, optional [NOT] MATERIALIZED, parenthesized body
    if (tokens[i]?.text !== "Q" && !/^[A-Z_$]/.test(tokens[i]?.text ?? "")) return undefined
    i++
    if (tokens[i]?.text === "(") i = skipGroup(tokens, i)
    if (tokens[i]?.text !== "AS") return undefined
    i++
    if (tokens[i]?.text === "NOT") i++
    if (tokens[i]?.text === "MATERIALIZED") i++
    if (tokens[i]?.text !== "(") return undefined
    i = skipGroup(tokens, i)
    if (i < 0) return undefined
    if (tokens[i]?.text !== ",") break
    i++
  }
  while (tokens[i]?.text === "(") i++
  return i < tokens.length ? i : undefined
}

/** Index just past the group opened at `open`, or -1 when unbalanced. */
function skipGroup(tokens: Token[], open: number) {
  const depth = tokens[open].depth
  const close = tokens.findIndex((t, i) => i > open && t.text === ")" && t.depth === depth)
  return close === -1 ? -1 : close + 1
}

// Words are upper-cased; every quoted run becomes "Q". Parens and commas are tokens.
// An opening paren carries the outer depth, and its matching close carries it too.
function tokenize(sql: string) {
  const tokens: Token[] = []
  let depth = 0
  let i = 0
  while (i < sql.length) {
    const c = sql[i]
    const next = sql[i + 1]
    if (c === "-" && next === "-") {
      const end = sql.indexOf("\n", i)
      i = end === -1 ? sql.length : end + 1
      continue
    }
    if (c === "/" && next === "*") {
      const end = sql.indexOf("*/", i + 2)
      i = end === -1 ? sql.length : end + 2
      continue
    }
    if (c === "'" || c === '"' || c === "`") {
      i++
      while (i < sql.length) {
        if (sql[i] === "\\" && c !== "`") i += 2
        else if (sql[i] === c && sql[i + 1] === c) i += 2
        else if (sql[i] === c) break
        else i++
      }
      i++
      tokens.push({ text: "Q", depth })
      continue
    }
    if (c === "(") {
      tokens.push({ text: "(", depth })
      depth++
    } else if (c === ")") {
      depth = Math.max(0, depth - 1)
      tokens.push({ text: ")", depth })
    } else if (c === ",") tokens.push({ text: ",", depth })
    else if (/[A-Za-z_]/.test(c) && !/[\w$]/.test(sql[i - 1] ?? "")) {
      const word = /^[\w$]+/.exec(sql.slice(i))![0]
      tokens.push({ text: word.toUpperCase(), depth })
      i += word.length
      continue
    }
    i++
  }
  return tokens
}
