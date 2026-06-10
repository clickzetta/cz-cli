// Helpers for the `/sql` prompt command (execute SQL, equivalent to `cz-cli sql`).
import path from "node:path"

// Returns the trimmed query for a `/sql` input, "" for a bare `/sql`, or null
// when the input is not a `/sql` command at all.
export function parseSqlInput(input: string): string | null {
  if (input !== "/sql" && !input.startsWith("/sql ") && !input.startsWith("/sql\n")) return null
  return input.slice(4).trim()
}

// Whether the SQL can be passed inline (single-quoted) through session.shell's
// `eval "<cmd>"` layer without corruption. `$` (variable expansion), backtick
// (command substitution), `'` (closes the inline quote) and control chars
// (newlines/tabs) are unsafe and must go via a temp file instead. All other
// characters ("\ * ; | & () <> etc.) survive single-quoting unchanged.
export function canInlineSql(sql: string): boolean {
  return !/['`$]/.test(sql) && !/[\u0000-\u001F]/.test(sql)
}

function doubleQuote(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\$/g, "\\$").replace(/`/g, "\\`")}"`
}

export function buildSqlCommandPrefix(input: {
  execPath?: string
  argv?: string[]
  cwd?: string
} = {}): string {
  const execPath = input.execPath ?? process.execPath
  const argv = input.argv ?? process.argv
  const entry = argv[1]
  if (path.basename(execPath) === "bun" && entry && /\.(?:m?[tj]s)$/.test(entry)) {
    return `${doubleQuote(execPath)} run --conditions=browser ${doubleQuote(path.isAbsolute(entry) ? entry : path.resolve(input.cwd ?? process.cwd(), entry))}`
  }
  return doubleQuote(execPath)
}

// Inline form: `cz-cli sql 'SELECT 1'` (posix single-quoted; callers must
// ensure canInlineSql first).
export function buildSqlInlineCommand(sql: string, commandPrefix = "cz-cli"): string {
  return `${commandPrefix} sql --format table '${sql}'`
}

// File form: path normalized to forward slashes (accepted by Node on Windows
// too) and double-quoted so it works across bash/zsh/fish/cmd/powershell.
export function buildSqlFileCommand(file: string, commandPrefix = "cz-cli"): string {
  return `${commandPrefix} sql --format table --file "${file.replace(/\\/g, "/")}"`
}
