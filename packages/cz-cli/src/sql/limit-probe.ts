/**
 * Locate the outermost `LIMIT <n>` of a statement. Limits nested in parentheses
 * (subqueries, CTE bodies, UNION branches) are left alone, as are words inside
 * string literals, quoted identifiers, and comments.
 */
export function findTopLevelLimit(sql: string) {
  let depth = 0
  let found: { index: number; length: number; value: number } | undefined
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
    else if (depth === 0 && /[A-Za-z_]/.test(c) && !/[\w$]/.test(sql[i - 1] ?? "")) {
      const word = /^[\w$]+/.exec(sql.slice(i))![0]
      if (word.toUpperCase() === "LIMIT") {
        const m = /^LIMIT\s+(\d+)\b(?!\s*,)/i.exec(sql.slice(i))
        if (m) found = { index: i, length: m[0].length, value: parseInt(m[1], 10) }
      }
      i += word.length
      continue
    }
    i++
  }
  return found
}
