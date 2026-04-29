/**
 * Split a SQL string into individual statements, respecting quoted identifiers,
 * string literals, and comments. Ported from the Python reference implementation.
 */
export function splitSql(query: string): string[] {
  const ret: string[] = []
  let c: string | null = null
  let p: string | null = null
  let b = 0

  const NORMAL = 1
  const IDENTIFIER = 2
  const SINGLE_QUOTATION = 3
  const DOUBLE_QUOTATION = 4
  const SINGLE_LINE_COMMENT = 5
  const MULTI_LINE_COMMENT = 6

  let state = NORMAL

  for (let i = 0; i < query.length; i++) {
    c = query[i]

    if (state === NORMAL) {
      if (c === ";") {
        if (i - b > 0) ret.push(query.slice(b, i))
        b = i + 1
        p = null
      } else if (p === "-" && c === "-") {
        state = SINGLE_LINE_COMMENT
        p = null
      } else if (p === "/" && c === "*") {
        state = MULTI_LINE_COMMENT
        p = null
      } else if (c === "`") {
        state = IDENTIFIER
        p = null
      } else if (c === "'") {
        state = SINGLE_QUOTATION
        p = null
      } else if (c === '"') {
        state = DOUBLE_QUOTATION
        p = null
      } else {
        p = c
      }
    } else if (state === IDENTIFIER) {
      if (c === "`" && p !== "\\") {
        state = NORMAL
        p = null
      } else {
        p = c
      }
    } else if (state === SINGLE_QUOTATION) {
      if (c === "'" && p !== "\\") {
        state = NORMAL
        p = null
      } else if (p === "\\") {
        p = null
      } else {
        p = c
      }
    } else if (state === DOUBLE_QUOTATION) {
      if (c === '"' && p !== "\\") {
        state = NORMAL
        p = null
      } else if (p === "\\") {
        p = null
      } else {
        p = c
      }
    } else if (state === SINGLE_LINE_COMMENT) {
      if (c === "\n") {
        state = NORMAL
        p = null
      } else {
        p = c
      }
    } else if (state === MULTI_LINE_COMMENT) {
      if (p === "*" && c === "/") {
        state = NORMAL
        p = null
      } else {
        p = c
      }
    }
  }

  if (b < query.length) ret.push(query.slice(b))
  return ret
}
