/**
 * True when a statement is a DELETE or UPDATE (optionally behind a leading WITH
 * list) that has no WHERE at parenthesis depth 0. Only top-level words count:
 * a WHERE inside a subquery, string literal, quoted identifier, or comment does
 * not restrict the rows the statement touches.
 */
export function isUnrestrictedWrite(sql: string) {
  const words = topLevelWords(sql)
  const start = words[0] === "WITH" ? words.findIndex((w, i) => i > 0 && STATEMENT_KEYWORDS.has(w)) : 0
  const kind = words[start]
  return (kind === "DELETE" || kind === "UPDATE") && !words.slice(start + 1).includes("WHERE")
}

const STATEMENT_KEYWORDS = new Set(["SELECT", "INSERT", "DELETE", "UPDATE", "MERGE", "VALUES", "TABLE"])

function topLevelWords(sql: string) {
  const words: string[] = []
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
      continue
    }
    if (c === "(") depth++
    else if (c === ")") depth = Math.max(0, depth - 1)
    else if (/[A-Za-z_]/.test(c) && !/[\w$]/.test(sql[i - 1] ?? "")) {
      const word = /^[\w$]+/.exec(sql.slice(i))![0]
      if (depth === 0) words.push(word.toUpperCase())
      i += word.length
      continue
    }
    i++
  }
  return words
}
