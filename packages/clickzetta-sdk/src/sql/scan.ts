/**
 * ClickZetta string scanning, not SQL parsing. Offsets use UTF-16, like slice().
 * Comments become spaces; quoted values become a placeholder plus spaces so a
 * quoted token cannot disappear and expose a different statement prefix.
 * Assumes the default backslash escape mode; callers must gate setting changes.
 */
export function scanSql(sql: string) {
  const text = sql.split("")
  const command = sql.split("")
  const boundaries = [-1]
  let quote = ""
  let comment = 0
  let commentStart = 0
  let line = false
  let depth = 0
  let reason: string | undefined

  for (let i = 0; i < sql.length; i++) {
    const char = sql[i]
    const next = sql[i + 1]
    if (line) {
      if (char === "\n" || char === "\r") line = false
      text[i] = " "
      command[i] = " "
      continue
    }
    if (comment) {
      text[i] = " "
      command[i] = " "
      if (char === "/" && next === "*") {
        comment++
        text[++i] = " "
        command[i] = " "
        continue
      }
      if (char === "*" && next === "/") {
        comment--
        text[++i] = " "
        command[i] = " "
        if (
          !comment &&
          sql[commentStart + 2] === "+" &&
          !/^\s*MAPJOIN\s*\(\s*[A-Za-z_]\w*(?:\s*,\s*[A-Za-z_]\w*)*\s*\)\s*$/i.test(sql.slice(commentStart + 3, i - 1))
        ) {
          reason ??= "Unreviewed optimizer hint"
        }
      }
      continue
    }
    if (quote) {
      text[i] = " "
      if (char === "\\" || (char === quote && next === quote)) {
        if (next !== undefined) text[++i] = " "
        continue
      }
      if (char === quote) quote = ""
      continue
    }
    if (char === "-" && next === "-") {
      line = true
      text[i] = command[i] = " "
      text[++i] = command[i] = " "
      continue
    }
    if (char === "/" && next === "*") {
      comment = 1
      commentStart = i
      text[i] = command[i] = " "
      text[++i] = command[i] = " "
      continue
    }
    if (char === "'" || char === '"' || char === "`") {
      quote = char
      text[i] = "?"
      continue
    }
    if (char === "(") depth++
    if (char === ")") {
      depth--
      if (depth < 0) reason ??= "Unbalanced parentheses"
    }
    if (char === ";") {
      boundaries.push(i)
      if (depth) reason ??= "Semicolon inside parentheses is unsupported"
    }
    if (char === "#" || char === "\\" || (char === "*" && next === "/")) {
      reason ??= "Unsupported SQL delimiter"
    }
    if (!reason && char === "$" && /^\$(?:[A-Za-z_][\w]*)?\$/.test(sql.slice(i))) {
      reason ??= "Dollar-quoted SQL is unsupported"
    }
  }

  if (quote) reason ??= "Unterminated quoted text"
  if (comment) reason ??= "Unterminated block comment"
  if (depth) reason ??= "Unbalanced parentheses"
  boundaries.push(sql.length)
  const masked = text.join("")
  const uncommented = command.join("")
  return {
    reason,
    statements: boundaries.slice(1).flatMap((end, index) => {
      const start = boundaries[index] + 1
      return end > start
        ? [
            {
              sql: sql.slice(start, end),
              text: masked.slice(start, end),
              command: uncommented.slice(start, end),
              start,
              end,
            },
          ]
        : []
    }),
  }
}
