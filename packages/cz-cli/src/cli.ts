import yargs from "yargs"
import { VERSION } from "./version.js"
import { HandledCliError, defaultFormat, outputState, parseOutputArgs, renderErrorOutput } from "./output/index.js"
import { withClickZettaProfileOption } from "./clickzetta-profile-option.js"
import { suggestClosest } from "./suggest.js"
import { SubcommandHelpShown } from "./subcommand-help.js"
import { UsageError } from "./usage-error.js"

export interface GlobalArgs {
  profile?: string
  jdbc?: string
  pat?: string
  username?: string
  password?: string
  service?: string
  protocol?: string
  instance?: string
  workspace?: string
  schema?: string
  vcluster?: string
  format: string
  format_explicit?: boolean
  field?: string
  debug: boolean
}

// Options that take a single JSON-array value. Shells and AI agent runtimes may
// strip the surrounding quotes and split the JSON on internal whitespace, leaving
// stray positional fragments that yargs would reject with "Unknown command". These
// options never precede a positional argument, so any non-flag tokens immediately
// following them are fragments of the same value and are merged back together here.
const JSON_ARRAY_OPTIONS = new Set(["--output-tables"])

// Canonical global option/command names, used by both the top-level fail
// handler and the nested commandGroup fail handler for "did you mean"
// suggestions. Kept here as the single source of truth to avoid drift.
// NOTE: "v" is listed as an alias of --version, not --vcluster. --vcluster is
// long-form only. See the --vcluster option comment in createCli().
export const KNOWN_GLOBAL_FLAGS = ["profile", "p", "jdbc", "pat", "username", "password", "service", "protocol", "instance", "workspace", "schema", "s", "vcluster", "format", "field", "debug", "d", "help", "h", "version", "v", "target", "t"]
export const KNOWN_TOP_COMMANDS = ["sql", "schema", "table", "workspace", "workspace-param", "status", "auth", "login", "profile", "task", "runs", "attempts", "job", "agent", "serve", "setup", "update", "datasource", "ai-gateway", "analytics-agent", "dqc", "mcp", "fs"]

/**
 * Collapse a repeated scalar option to its last occurrence, leaving options
 * declared `array: true` alone. See the call site in createCli for why.
 *
 * Typed loosely and passed as `never`: yargs' published MiddlewareFunction type
 * takes only argv, while the runtime also hands in the yargs instance — which is
 * the only way to learn what the CURRENT subcommand declared as an array.
 */
function collapseDuplicateScalars(argv: Record<string, unknown>, instance: unknown): void {
  const declaredArrays = new Set<string>(readDeclaredArrayKeys(instance))
  for (const [key, value] of Object.entries(argv)) {
    // `_` and `--` are yargs' operand lists and `$0` is the script name: all three
    // are arrays by definition, never a repeated option.
    if (key === "_" || key === "$0" || key === "--") continue
    if (Array.isArray(value) && !declaredArrays.has(key) && value.length > 1) {
      argv[key] = value[value.length - 1]
    }
  }
}

/** yargs' list of keys declared `array: true` on the instance in scope. */
function readDeclaredArrayKeys(instance: unknown): string[] {
  try {
    const options = (instance as { getOptions?: () => Record<string, unknown> } | undefined)?.getOptions?.()
    const keys = options?.array
    return Array.isArray(keys) ? keys.filter((key): key is string => typeof key === "string") : []
  } catch {
    return []
  }
}

function isNaNValue(value: unknown): boolean {
  if (typeof value === "number") return Number.isNaN(value)
  return Array.isArray(value) && value.some((item) => typeof item === "number" && Number.isNaN(item))
}

/** `pageSize` → `page-size`, so the error names the flag the user typed. */
function kebab(key: string): string {
  return key.replace(/[A-Z]/g, (upper) => `-${upper.toLowerCase()}`)
}

/** Does `text` begin a JSON array/object literal? */
function startsJson(text: string): boolean {
  const trimmed = text.trimStart()
  return trimmed.startsWith("[") || trimmed.startsWith("{")
}

/**
 * Is every bracket `text` opened closed again, ending outside a string? Only what
 * the fragment merging below needs — "is this value still incomplete", not "is this
 * valid JSON", which JSON.parse decides later in the command.
 */
function isClosedJson(text: string): boolean {
  let depth = 0
  let inString = false
  let escaped = false
  for (const char of text) {
    if (escaped) { escaped = false; continue }
    if (inString) {
      if (char === "\\") escaped = true
      else if (char === '"') inString = false
      continue
    }
    if (char === '"') inString = true
    else if (char === "[" || char === "{") depth++
    else if (char === "]" || char === "}") depth--
  }
  return !inString && depth === 0
}

/** Globals that take no value, so the token after them is a positional, not their value. */
const VALUELESS_GLOBAL_FLAGS = new Set(["debug", "d", "help", "h", "version", "v"])

/**
 * Index of the top-level command token, or -1.
 *
 * `args.find((a) => !a.startsWith("-"))` reads as "the first positional" and is
 * wrong twice over: it returns a global's VALUE (`--schema sql task list` hands
 * back "sql", `--schema tabel bogus` hands back "tabel"), and it returns an
 * empty-string token, which forward.ts passes through verbatim by design. Only
 * globals can precede the command, so KNOWN_GLOBAL_FLAGS is the complete set of
 * value-takers to step over here. Mirrors run-cli.ts's subcommandIndex.
 */
function commandTokenIndex(args: string[]): number {
  for (let index = 0; index < args.length; index++) {
    const value = args[index]
    if (!value) continue
    if (value === "--") return -1
    if (!value.startsWith("-")) return index
    const flag = value.replace(/^-+/, "").split("=")[0]
    if (!flag || value.includes("=") || VALUELESS_GLOBAL_FLAGS.has(flag)) continue
    if (KNOWN_GLOBAL_FLAGS.includes(flag)) index++
  }
  return -1
}

/**
 * Whether a `sql` usage error looks like the shell tore a quote-heavy statement
 * into separate argv tokens.
 *
 * Deliberately a coarse heuristic, not a parser. The root cause is always
 * caller-side: quotes or escapes the shell consumed before cz-cli ran. We do not
 * try to reassemble the fragments or to prove they were once one statement — the
 * fragments that arrive are not a reliable record of what was typed. Two
 * consequences are accepted on purpose:
 *   - It stays silent on shapes that carry only one bare keyword (`SELECT a, b, c
 *     FROM t`). Catching those needs a 1-keyword threshold, which fires on almost
 *     any stray positional.
 *   - It fires on correctly quoted SQL followed by stray positionals (`sql
 *     "SELECT 1" ON ALL`). The advice still resolves that case, so a false
 *     positive costs wording, not correctness.
 * The statement is located by SQL shape rather than by position because `sql`
 * declares ~18 local flags; scanning for the first SQL-looking token keeps this
 * out of sync with none of them.
 */
export function looksLikeShellSplitSql(args: string[], message: string | undefined): boolean {
  const commandIndex = commandTokenIndex(args)
  if (commandIndex < 0 || args[commandIndex] !== "sql") return false
  const statement = args
    .slice(commandIndex + 1)
    .find((arg) =>
      arg && !arg.startsWith("-") &&
      /^(?:SELECT|WITH|SHOW|DESC|DESCRIBE|VALUES|EXPLAIN|INSERT|UPDATE|DELETE|MERGE|CREATE|ALTER|DROP)\b/i.test(arg)
    )
  if (!statement) return false
  // [\s\S] rather than `.`: a fragment can carry an embedded newline when multi-line
  // SQL loses only some of its quotes, and `.` stopping at that newline (with `$`
  // unable to match mid-string) abandoned detection for the whole message.
  const unknown = message?.match(/^Unknown arguments?: ([\s\S]+)$/)?.[1]
  if (!unknown) return false
  const keywords = unknown
    .split(",")
    .map((fragment) => fragment.trim())
    .filter((fragment) =>
      /^(?:SELECT|FROM|WHERE|CASE|WHEN|THEN|ELSE|END|LIKE|ILIKE|UNION|ALL|JOIN|LEFT|RIGHT|FULL|INNER|OUTER|ON|AND|OR|GROUP|ORDER|BY|HAVING|LIMIT|OFFSET|AS|WITH|DISTINCT)$/i.test(
        fragment,
      )
    )
  return keywords.length >= 2
}

export function coalesceJsonArrayOptionArgs(args: string[]): string[] {
  const result: string[] = []
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!
    const isLongForm = JSON_ARRAY_OPTIONS.has(arg)
    const eqName = isLongForm ? undefined : [...JSON_ARRAY_OPTIONS].find((name) => arg.startsWith(name + "="))
    if (!isLongForm && !eqName) {
      result.push(arg)
      continue
    }
    // Long form needs a value token that is not itself a flag; otherwise leave it for yargs.
    if (isLongForm && (args[i + 1] === undefined || args[i + 1]!.startsWith("-"))) {
      result.push(arg)
      continue
    }
    const prefix = eqName ? `${eqName}=` : ""
    let value = eqName ? arg.slice(prefix.length) : args[i + 1]!
    let j = isLongForm ? i + 2 : i + 1
    // Absorb following tokens only while the value is an UNCLOSED JSON literal.
    // Merging every non-flag token instead ate the command's own positional:
    // `--output-tables '[{"a": 1}]' mytask` (quotes stripped by the caller, so the
    // JSON arrives split on its inner space) swallowed `mytask`, and the command
    // then failed with "Not enough non-option arguments". A value that never
    // started a JSON literal absorbs nothing at all.
    while (j < args.length && !args[j]!.startsWith("-") && startsJson(value) && !isClosedJson(value)) {
      value += args[j]!
      j++
    }
    if (isLongForm) result.push(arg, value)
    else result.push(prefix + value)
    i = j - 1
  }
  return result
}

// Property key under which createCli stashes the raw invocation args on the
// yargs instance. The nested commandGroup fail handler reads it (instead of the
// process-global argv) so that --format/--field are honored even on the
// same-process execute() path, where process.argv belongs to the host (the TUI
// or MCP server), not this cz-cli invocation. Non-enumerable to stay invisible
// to yargs' own option introspection.
export const INVOCATION_ARGS_KEY = "__czInvocationArgs"

export function createCli(args: string[]) {
  const cli = withClickZettaProfileOption(yargs(coalesceJsonArrayOptionArgs(args)))
  Object.defineProperty(cli, INVOCATION_ARGS_KEY, {
    value: args,
    enumerable: false,
    configurable: true,
    writable: false,
  })
  return cli
    .scriptName("cz-cli")
    // Force English so yargs' built-in messages (missing args, invalid choices,
    // help labels) never localize to the shell's LANG. Agents and our error
    // assertions expect stable English text in `message`/`ai_message`.
    .locale("en")
    .version(VERSION)
    // cz_change: -v is --version here too, so the short flag means the same thing
    // in this tree as in the agent runtime. See the --vcluster comment below.
    .alias("version", "v")
    .exitProcess(false)
    .option("jdbc", {
      type: "string",
      describe: "JDBC connection URL",
    })
    .option("pat", {
      type: "string",
      describe: "Personal Access Token",
    })
    .option("username", {
      type: "string",
      describe: "Username",
    })
    .option("password", {
      type: "string",
      describe: "Password",
    })
    .option("service", {
      type: "string",
      describe: "Service endpoint",
    })
    .option("protocol", {
      type: "string",
      choices: ["https", "http"] as const,
      describe: "Protocol (https/http)",
    })
    .option("instance", {
      type: "string",
      describe: "Instance name",
    })
    .option("workspace", {
      type: "string",
      describe: "Workspace name",
    })
    .option("schema", {
      alias: "s",
      type: "string",
      describe: "Default schema",
    })
    // cz_change: --vcluster has NO -v alias. `-v` is --version across the whole
    // CLI, matching the agent runtime (bootstrap/runtime.ts), which binds
    // .alias("version", "v"). Previously the two parser trees disagreed: `-v` meant
    // --vcluster at the top level but --version under `agent`, so
    // `cz-cli agent -v myvc session list` printed the version string and silently
    // discarded the command. One short flag, one meaning.
    .option("vcluster", {
      type: "string",
      describe: "Virtual cluster (no -v short form; -v is --version)",
    })
    .option("format", {
      type: "string",
      choices: ["json", "pretty", "table", "csv", "text", "jsonl", "toon"] as const,
      default: defaultFormat(),
      describe: "Output format",
    })
    .option("field", {
      type: "string",
      describe: "Extract a single field from the response",
    })
    .option("debug", {
      alias: "d",
      type: "boolean",
      default: false,
      describe: "Enable debug mode",
    })
    .option("format_explicit", {
      type: "boolean",
      hidden: true,
      default: false,
    })
    // Repeating a scalar option is a user slip, and yargs' answer to it is an
    // ARRAY: `--field a --field b` reached extractField as ["a","b"] and crashed
    // on field.replace, `--protocol http --protocol https` crashed in
    // normalizeProtocol, and `--profile p1 --profile p2` silently resolved to no
    // profile at all. Collapse to last-wins here — the GNU convention — but only
    // for options NOT declared `array: true`, of which this CLI has 15 (`--set`,
    // `--variable`, `--header`, …) that must keep collecting. yargs' global
    // `duplicate-arguments-array: false` cannot make that distinction: it would
    // reduce those to their last element too.
    //
    // Runs before validation so `choices` sees the scalar, and takes the yargs
    // instance from the middleware's 2nd argument, which in a subcommand reports
    // that subcommand's own declarations.
    .middleware(collapseDuplicateScalars as never, /* applyBeforeValidation */ true)
    // A `type: "number"` option fed a non-number becomes NaN, and nothing else in
    // the CLI checks: `task cron-preview '0 0 * * *' --count abc` answered "0
    // upcoming runs" for a valid cron, and paginated commands sent `null` for a
    // page. NaN can only originate from a number-typed option, so no schema is
    // needed here — a NaN in argv IS a rejected value. check() reports through
    // the fail handler, i.e. USAGE_ERROR with exit 2, like any other bad value.
    .check((argv) => {
      const invalid = new Set<string>()
      for (const [key, value] of Object.entries(argv)) {
        if (key === "_" || key === "$0" || key === "--") continue
        if (isNaNValue(value)) invalid.add(kebab(key))
      }
      if (invalid.size > 0) {
        const names = [...invalid].map((name) => `--${name}`).join(", ")
        throw new UsageError(`Invalid number value for: ${names}`)
      }
      return true
    })
    .middleware((argv) => {
      const rawArgs = args.map(a => String(a))
      const hasExplicitFormat = rawArgs.some(
        (a) => a === "--format" || a.startsWith("--format=")
      )
      argv.format_explicit = hasExplicitFormat
      outputState.field = argv.field as string | undefined
    }, /* applyBeforeValidation */ true)
    .strict()
    .fail((msg, err, failYargs) => {
      // Our own validators (see the check() above) report through UsageError so
      // they get the USAGE_ERROR envelope; anything else is a real exception and
      // must keep propagating rather than being relabelled as bad usage.
      if (err && !(err instanceof UsageError)) throw err
      if (err instanceof UsageError) msg = err.message
      // Defensive net: a group built with raw `.demandCommand()` (no commandGroup
      // fail handler of its own, e.g. mcp / some agent.ts subtrees) bubbles its
      // "Missing subcommand for 'X'" failure straight up here. Resolve it like
      // commandGroup does: render that group's help from the failing instance
      // (yargs hands it in as the 3rd arg) and throw SubcommandHelpShown so the
      // parse boundary exits 0. Groups built via commandGroup handle this in
      // their own fail handler and never reach here. See subcommand-help.ts.
      if (msg && msg.startsWith("Missing subcommand for '")) {
        failYargs.showHelp((help: string) => process.stdout.write(help + "\n"))
        throw new SubcommandHelpShown()
      }
      // A UsageError carries OUR message, already complete. Running it through the
      // scan below could append "Did you mean '--limit'?" to a message about a
      // perfectly valid flag, because the scan only looks at the raw tokens.
      const selfReported = err instanceof UsageError
      const KNOWN_FLAGS = KNOWN_GLOBAL_FLAGS
      const KNOWN_COMMANDS = KNOWN_TOP_COMMANDS
      const knownFlagSet = new Set(KNOWN_FLAGS)
      const knownCommandSet = new Set(KNOWN_COMMANDS)

      // Identify the offending token so we can offer a "did you mean" suggestion.
      // A bad flag takes priority over a bad command (yargs reports flags first).
      let badToken: string | undefined
      let suggestion: string | undefined
      let isFlag = false
      const unknownFlags = selfReported
        ? []
        : args.filter((a) => a.startsWith("-")).map((a) => a.replace(/^-+/, "").split("=")[0]).filter((a) => a && !knownFlagSet.has(a))
      if (unknownFlags.length > 0) {
        isFlag = true
        badToken = unknownFlags[0]
        const hit = suggestClosest(badToken!, KNOWN_FLAGS.filter((f) => f.length > 1))
        if (hit) suggestion = `--${hit}`
      } else if (!selfReported) {
        // commandTokenIndex, not args.find(): a global's VALUE is not a command, so
        // `--schema tabel bogus` must not suggest 'table' for a token nobody typed
        // as a command — and must not let that phantom suggestion suppress the
        // shell-split advice below.
        const commandIndex = commandTokenIndex(args)
        const topLevelCmd = commandIndex < 0 ? undefined : args[commandIndex]
        if (topLevelCmd !== undefined && !knownCommandSet.has(topLevelCmd)) {
          badToken = topLevelCmd
          suggestion = suggestClosest(topLevelCmd, KNOWN_COMMANDS)
        }
      }

      const baseMessage = (msg && msg.trim() !== "")
        ? msg
        : (badToken !== undefined ? `Unknown argument: ${badToken}` : "Unknown argument")
      // Gated on selfReported, not on !suggestion: a flag typo and split SQL
      // routinely arrive together (`sql SELECT CASE … END -formt x`), and showing
      // only the typo costs the caller a second round trip on the same split. The
      // selfReported gate matches lines 383 and 391 — a UsageError already carries
      // OUR complete message and must not get advice appended.
      const shellSplitSql = !selfReported && looksLikeShellSplitSql(args, msg)
      const message = [
        baseMessage,
        suggestion ? `. Did you mean '${suggestion}'?` : "",
        shellSplitSql
          ? ". The SQL appears to have been split by the shell — quote the whole statement, or put it in a file and run `cz-cli sql -f /tmp/query.sql` (or `cz-cli sql --stdin < /tmp/query.sql`)."
          : "",
      ].join("")
      // Says "rewrite", not "reconstruct": the fragments that survived the shell are
      // not a faithful copy of the statement, so telling an agent to reassemble them
      // while also forbidding it is a contradiction it cannot satisfy. The allowlist
      // includes write verbs, hence the --write note.
      const aiParts: string[] = []
      if (suggestion) {
        aiParts.push(
          `Unknown ${isFlag ? "argument" : "command"} '${isFlag ? `--${badToken}` : badToken}'. Did you mean '${suggestion}'?`,
        )
      }
      if (shellSplitSql) {
        aiParts.push(
          "The shell split a quote-heavy SQL statement into multiple arguments, so the statement cz-cli received is incomplete. Rewrite the SQL you intended as one complete statement into /tmp/query.sql, then run `cz-cli sql -f /tmp/query.sql` (add --write if it modifies data) or `cz-cli sql --stdin < /tmp/query.sql`. Do not retry the same inline command.",
        )
      } else if (suggestion) {
        aiParts.push("Run cz-cli --help to see all available commands.")
      }
      const aiMessage = aiParts.length > 0
        ? aiParts.join(" ")
        : "Run the command with --help to see available options and usage."

      const outputArgs = parseOutputArgs(args)
      const errorObj: Record<string, unknown> = { code: "USAGE_ERROR", message }
      if (suggestion) errorObj.did_you_mean = suggestion
      // renderErrorOutput, not renderOutput: a usage error must look like every
      // other error in the chosen format — `ERROR USAGE_ERROR: …` under
      // text/csv/table/jsonl, JSON under json/pretty/toon.
      const output = renderErrorOutput({
        error: errorObj,
        ai_message: aiMessage,
      }, outputArgs.format, outputArgs.field)
      process.stdout.write(output + "\n")
      process.exitCode = 2
      // HandledCliError, not a bare Error: the envelope above IS the report, and a
      // catch further out (runCliWithTracking's last-resort envelope, runLlm's
      // stderr line) must be able to tell "already reported" from a real exception.
      throw new HandledCliError("USAGE_ERROR", message)
    })
}
