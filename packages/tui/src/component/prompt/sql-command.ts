// cz_change: helpers for the `/sql` prompt command, which runs SQL through
// `cz-cli sql` and renders the result as a tool part — no LLM in the loop.
//
// This file exists because the command string we build is not exec'd directly:
// Shell.args (core/src/shell.ts) wraps it in `eval "<cmd>"`, so the SQL text is
// parsed once as shell code on its way to cz-cli. Everything below is about
// getting arbitrary SQL through that layer intact.
//
// Kept as pure functions with no I/O so it is testable without a TUI.
import path from "node:path"

// Flags that consume the following token as their value (e.g. `--limit 5`).
// Anything not listed here is treated as a boolean flag (e.g. `--write`).
// Covers both `cz-cli` global value-flags and `cz-cli sql` subcommand value-flags
// so leading flags like `--profile prod` don't leak their value into the SQL body.
// Keep in sync with cz-cli's cli.ts KNOWN_GLOBAL_FLAGS and sql.ts options.
const VALUE_FLAGS = new Set([
  // global
  "--profile", "-p", "--jdbc", "--pat", "--username", "--password", "--service",
  "--protocol", "--instance", "--workspace", "--schema", "-s", "--vcluster",
  "--format", "--field", "--target", "-t",
  // sql subcommand
  "--file", "-f", "--execute", "-e", "--timeout", "--variable", "--set",
  "--job-profile", "--limit",
])

// A leading token is a flag only if it looks like one: a long flag starting with
// a letter (`--write`, `--no-limit`, `--limit=5`) or a single-letter short flag
// (`-f`, `-N`). This deliberately rejects `--` and `-- a comment` so a SQL line
// comment or a leading negative number is treated as SQL, not a flag.
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
    while (i < len && /\s/.test(rest[i])) i++
    if (i >= len) break
    // Read one whitespace-delimited token.
    let j = i
    while (j < len && !/\s/.test(rest[j])) j++
    const token = rest.slice(i, j)
    if (!isFlag(token)) break // start of SQL body
    flags.push(token)
    i = j
    // A value-flag in `--flag value` form consumes the next token as its value.
    if (VALUE_FLAGS.has(flagName(token)) && token.indexOf("=") === -1) {
      while (i < len && /\s/.test(rest[i])) i++
      if (i < len) {
        let k = i
        while (k < len && !/\s/.test(rest[k])) k++
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
export function canInlineSql(sql: string, platform = process.platform): boolean {
  if (platform === "win32") return false
  return !/['`$]/.test(sql) && !/[\u0000-\u001F]/.test(sql)
}

function doubleQuote(value: string, platform = process.platform): string {
  if (platform === "win32") return `"${value.replace(/"/g, '""')}"`
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\$/g, "\\$").replace(/`/g, "\\`")}"`
}

// POSIX single-quote a flag token so any shell metacharacters in user-supplied
// values (`$`, backtick, spaces, etc.) are passed literally to cz-cli. Tokens
// with no special chars are left bare to keep the common case readable.
function shellQuoteFlag(token: string, platform = process.platform): string {
  if (/^[A-Za-z0-9_\-=./:]+$/.test(token)) return token
  if (platform === "win32") return doubleQuote(token, platform)
  return `'${token.replace(/'/g, `'\\''`)}'`
}

function renderFlags(flags: string[], platform = process.platform): string {
  const formatted = flags.some((token) => flagName(token) === "--format") ? flags : ["--format", "table", ...flags]
  return formatted.map((token) => shellQuoteFlag(token, platform)).join(" ")
}

// `table` is the right terminal default. Add it only when the user did not pass
// --format, avoiding both duplicate yargs values and POSIX-only `VAR=value cmd`
// syntax on Windows.

// Resolve how to invoke cz-cli. Not hardcoded to `cz-cli`: during development
// the TUI runs from source via `bun run src/main.ts`, where no `cz-cli` is on
// PATH, so we re-invoke the current executable (and entrypoint) instead.
export function buildSqlCommandPrefix(
  input: { execPath?: string; argv?: string[]; cwd?: string; platform?: NodeJS.Platform; shell?: string } = {},
): string {
  const execPath = input.execPath ?? process.execPath
  const argv = input.argv ?? process.argv
  const platform = input.platform ?? process.platform
  const paths = platform === "win32" ? path.win32 : path
  const entry = argv[1]
  const call = platform === "win32" && (!input.shell || /(?:^|[\\/])(?:pwsh|powershell)(?:\.exe)?$/i.test(input.shell)) ? "& " : ""
  if (paths.basename(execPath).replace(/\.exe$/i, "") === "bun" && entry && /\.(?:m?[tj]s)$/.test(entry)) {
    const resolved = paths.isAbsolute(entry) ? entry : paths.resolve(input.cwd ?? process.cwd(), entry)
    return `${call}${doubleQuote(execPath, platform)} run --conditions=browser ${doubleQuote(resolved, platform)}`
  }
  return call + doubleQuote(execPath, platform)
}

// Inline form: `cz-cli sql 'SELECT 1'` (posix single-quoted; callers must ensure
// canInlineSql first). Leading flags go after `sql`, before the SQL body.
export function buildSqlInlineCommand(sql: string, commandPrefix = "cz-cli", flags: string[] = []): string {
  const rendered = renderFlags(flags, "linux")
  return `${commandPrefix} sql ${rendered ? rendered + " " : ""}'${sql}'`
}

// File form: the only way to keep SQL completely out of shell parsing. The path
// is normalized to forward slashes (accepted by Node on Windows too) and
// double-quoted so it survives bash/zsh/fish/cmd/powershell alike.
export function buildSqlFileCommand(
  file: string,
  commandPrefix = "cz-cli",
  flags: string[] = [],
  platform = process.platform,
): string {
  const rendered = renderFlags(flags, platform)
  return `${commandPrefix} sql ${rendered ? rendered + " " : ""}--file ${doubleQuote(file.replace(/\\/g, "/"), platform)}`
}
