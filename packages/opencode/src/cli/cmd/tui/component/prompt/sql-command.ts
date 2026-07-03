// Helpers for the `/sql` prompt command (execute SQL, equivalent to `cz-cli sql`).
import path from "node:path"

// Flags that consume the following token as their value (e.g. `--limit 5`).
// Anything not listed here is treated as a boolean flag (e.g. `--write`).
// Covers both `cz-cli` global value-flags and `cz-cli sql` subcommand value-flags
// so leading flags like `--profile prod` don't leak their value into the SQL body.
// Keep in sync with cli.ts KNOWN_GLOBAL_FLAGS and sql.ts option definitions.
const VALUE_FLAGS = new Set([
  // global
  "--profile", "-p", "--jdbc", "--pat", "--username", "--password", "--service",
  "--protocol", "--instance", "--workspace", "--schema", "-s", "--vcluster", "-v",
  "--format", "--field", "--target", "-t",
  // sql subcommand
  "--file", "-f", "--execute", "-e", "--timeout", "--variable", "--set",
  "--job-profile", "--limit",
])

// A leading token is a flag only if it looks like one: a long flag starting with
// a letter (`--write`, `--no-truncate`, `--limit=5`) or a single-letter short
// flag (`-f`, `-B`). This deliberately rejects `--` and `-- a comment` so a SQL
// line comment or a leading negative number is treated as SQL, not a flag.
const LONG_FLAG_RE = /^--[A-Za-z][\w-]*(=.*)?$/s
const SHORT_FLAG_RE = /^-[A-Za-z]$/

function flagName(token: string): string {
  const eq = token.indexOf("=")
  return eq === -1 ? token : token.slice(0, eq)
}

function isFlag(token: string): boolean {
  return LONG_FLAG_RE.test(token) || SHORT_FLAG_RE.test(token)
}

export interface ParsedSqlInput {
  // Leading flags, in order, e.g. ["--write", "--limit", "0"].
  flags: string[]
  // The SQL body with leading flags stripped, trimmed.
  sql: string
}

// Parses a `/sql` input into its leading flags and SQL body. Returns null when
// the input is not a `/sql` command at all. A bare `/sql` (or `/sql   `) yields
// { flags: [], sql: "" }.
//
// Flag parsing only consumes a contiguous run of leading flags; the first token
// that is not a flag (typically a SQL keyword) ends flag parsing, and everything
// from there on is taken as SQL verbatim (original spacing/newlines preserved).
export function parseSqlInput(input: string): ParsedSqlInput | null {
  if (input !== "/sql" && !input.startsWith("/sql ") && !input.startsWith("/sql\n")) return null
  const rest = input.slice(4)

  const flags: string[] = []
  let i = 0
  const len = rest.length
  // Walk leading whitespace + flag tokens until we hit the SQL body.
  while (i < len) {
    // Skip whitespace between tokens (and the leading separator after `/sql`).
    while (i < len && /\s/.test(rest[i]!)) i++
    if (i >= len) break
    // Read one whitespace-delimited token.
    let j = i
    while (j < len && !/\s/.test(rest[j]!)) j++
    const token = rest.slice(i, j)
    if (!isFlag(token)) break // start of SQL body
    flags.push(token)
    i = j
    // A value-flag in `--flag value` form consumes the next token as its value.
    if (VALUE_FLAGS.has(flagName(token)) && token.indexOf("=") === -1) {
      while (i < len && /\s/.test(rest[i]!)) i++
      if (i < len) {
        let k = i
        while (k < len && !/\s/.test(rest[k]!)) k++
        flags.push(rest.slice(i, k))
        i = k
      }
    }
  }

  return { flags, sql: rest.slice(i).trim() }
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

// POSIX single-quote a flag token so any shell metacharacters in user-supplied
// values (`$`, backtick, spaces, etc.) are passed literally to cz-cli. Tokens
// with no special chars are left bare to keep the common case readable.
function shellQuoteFlag(token: string): string {
  if (/^[A-Za-z0-9_\-=./:]+$/.test(token)) return token
  return `'${token.replace(/'/g, `'\\''`)}'`
}

// Renders the flag list for a command, injecting `--format table` only when the
// user did not pass their own `--format` (passing both would fail yargs' choices
// validation, since duplicate options collapse into an array).
function renderFlags(flags: string[]): string {
  const hasFormat = flags.some((f) => f === "--format" || f.startsWith("--format="))
  const parts = hasFormat ? [] : ["--format", "table"]
  for (const f of flags) parts.push(shellQuoteFlag(f))
  return parts.join(" ")
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

// Inline form: `cz-cli sql --format table 'SELECT 1'` (posix single-quoted;
// callers must ensure canInlineSql first). Leading flags are inserted after
// `sql` and before the SQL body.
export function buildSqlInlineCommand(sql: string, commandPrefix = "cz-cli", flags: string[] = []): string {
  return `${commandPrefix} sql ${renderFlags(flags)} '${sql}'`
}

// File form: path normalized to forward slashes (accepted by Node on Windows
// too) and double-quoted so it works across bash/zsh/fish/cmd/powershell.
export function buildSqlFileCommand(file: string, commandPrefix = "cz-cli", flags: string[] = []): string {
  return `${commandPrefix} sql ${renderFlags(flags)} --file "${file.replace(/\\/g, "/")}"`
}
