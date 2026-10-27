/**
 * Replay a historical invocation through the real parser, in-process, without
 * running its handler.
 *
 * The mechanism is the post-validation middleware + sentinel pattern the CLI
 * already uses for its NO_PROFILE gate (src/execute.ts:70-80,
 * src/run-cli.ts:351-357): a middleware registered with
 * `applyBeforeValidation: false` runs after yargs has finished strict checking,
 * alias resolution, choices validation and type coercion, but before the handler
 * is invoked. Throwing from there yields the real, fully-resolved argv with zero
 * side effects — no network, no writes, nothing touching the production
 * lakehouses these commands were originally pointed at. Root-level middleware
 * reaches subcommands, which is what makes one registration enough (the
 * NO_PROFILE gate depends on the same property).
 *
 * Positional VALUES are synthesized here rather than taken from history: the
 * fixture deliberately carries no positional text, because in the source logs
 * that field holds customer table names, SQL and task ids. Synthesizing from the
 * yargs declaration string also means the suite adapts when a declaration
 * changes, instead of needing a fixture regeneration.
 */
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createCli } from "../../src/cli.js"
import { registerCommands } from "../../src/register-commands.js"
import { SubcommandHelpShown } from "../../src/subcommand-help.js"
import {
  buildSurface,
  camelCase,
  effectiveOptions,
  resolveCommand,
  type DeclaredOption,
  type Surface,
} from "./cli-surface.js"

export type Verdict =
  /** Parsed, argv captured, and every historical flag landed in argv. */
  | "PASS"
  /** yargs short-circuited on --help/--version before validation. */
  | "HELP_OR_VERSION"
  /** A bare command group rendered its own help (equivalent to --help). */
  | "SUBCOMMAND_HELP"
  /** An option the invocation used no longer exists. */
  | "FLAG_REMOVED"
  /** A subcommand the invocation used no longer exists under that parent. */
  | "COMMAND_REMOVED"
  /** A positional is now required that the declaration does not let us satisfy. */
  | "POSITIONAL_REQUIRED"
  /** An option's `choices` no longer admits a value that was accepted before. */
  | "CHOICE_NARROWED"
  /** An option is now mandatory that was not before. */
  | "OPTION_REQUIRED"
  /** Parsed, but a historical flag is absent from argv under any spelling. */
  | "FLAG_NOT_IN_ARGV"
  /** Rejected by something other than the structural checks above. */
  | "VALUE_REJECTED"

export interface ReplayResult {
  verdict: Verdict
  /** Exactly the argv this replay passed to the parser. */
  argv: string[]
  /** yargs' own failure text, when it failed. */
  message?: string
  /** Historical flags that did not reach argv (FLAG_REMOVED / FLAG_NOT_IN_ARGV). */
  missing?: string[]
  /** Command path the surface resolved the tokens to. */
  resolvedPath?: string
  /**
   * Recorded tokens dropped before replay. `positional[]` in the source logs
   * contains flag VALUES as well as real tokens (src/telemetry.ts:37), so a value
   * that happens to spell a command name — `--table table`, `--like agent` — is
   * indistinguishable from a subcommand at export time. When the resolved command
   * takes no positionals such a token cannot be part of the real invocation, so it
   * is dropped here rather than replayed into a guaranteed false failure.
   */
  droppedTokens?: string[]
}

export interface HistoricalFlag {
  key: string
  hadValue: boolean
  /** Replay this exact value instead of a synthesized one (choices coverage). */
  value?: string
}

class Captured extends Error {
  constructor(readonly argv: Record<string, unknown>) {
    super("captured")
  }
}

let surfaceSingleton: Surface | undefined
export function surface(): Surface {
  return (surfaceSingleton ??= buildSurface())
}

let scratchFile: string | undefined
/** A real path, for options and positionals whose value must name a file. */
function filePath(): string {
  if (!scratchFile) {
    const dir = mkdtempSync(join(tmpdir(), "cz-history-replay-"))
    scratchFile = join(dir, "input.sql")
    writeFileSync(scratchFile, "select 1\n")
  }
  return scratchFile
}

const NUMERIC_NAME = /(^|-)(id|ids|port|limit|offset|count|size|level|page|parallelism|retry|timeout|interval|seconds|ms|num|index|line|attempt|version)($|-)/
const FILE_NAME = /(^|-)(file|path|dir|output|local-file)($|-)/

/** A value the parser will accept for an option, chosen from its declaration. */
function synthesizeValue(name: string, option?: DeclaredOption): string {
  if (option?.choices?.length) return option.choices[0]!
  if (option?.type === "number") return "1"
  if (name === "cron") return "0 0 * * *"
  if (name === "output-tables" || name === "tables" || name === "source-tables") return "[]"
  if (name === "sql" || name === "statement" || name === "ddl" || name === "execute") return "select 1"
  if (FILE_NAME.test(name)) return filePath()
  if (NUMERIC_NAME.test(name)) return "1"
  return "x"
}

function synthesizePositional(name: string): string {
  if (name === "cron") return "0 0 * * *"
  if (name === "statement" || name === "ddl") return "select 1"
  if (name === "model") return "openai/gpt-4o"
  if (name === "provider") return "openai"
  if (name === "prompt") return "hello"
  if (FILE_NAME.test(name)) return filePath()
  if (NUMERIC_NAME.test(name) || /id$/i.test(name)) return "1"
  return "t1"
}

function kebabCase(name: string): string {
  return name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)
}

/**
 * yargs' own boolean flags. buildSurface() omits them (they are not declared by
 * our source), but history is full of them — including `-v`, which this tree
 * deliberately rebound from `--vcluster` to `--version` (src/cli.ts:88-90).
 */
const BUILTIN_BOOLEANS = new Set(["help", "h", "version", "v"])

/** What must be true of the parsed argv for a flag to count as "landed". */
interface Expectation {
  key: string
  names: string[]
  holds: (value: unknown) => boolean
}

function lookup(options: Map<string, DeclaredOption>, key: string): DeclaredOption | undefined {
  return options.get(key) ?? options.get(camelCase(key)) ?? options.get(kebabCase(key))
}

function spellings(...names: string[]): string[] {
  const out = new Set<string>()
  for (const name of names) {
    out.add(name)
    out.add(camelCase(name))
    out.add(kebabCase(name))
  }
  return [...out]
}

/**
 * Build the argv for a historical invocation: the command tokens, the positionals
 * the resolved declaration still demands, then one token per historical flag —
 * plus, for each flag, what the parsed argv must look like for it to have landed.
 *
 * Value-taking flags use `--key=value` so a synthesized value can never be
 * mistaken for a positional and turn a flag verdict into a positional one.
 */
export interface BuildOptions {
  /**
   * Also supply every `demandOption` option the flag set does not mention.
   *
   * Off by default and must stay off for signature replay: a newly mandatory
   * option is exactly the regression Tier A exists to catch, and filling it in
   * would hide it. On for single-value probes, where the point is one option's
   * accepted values and the command's other requirements are noise.
   */
  fillRequired?: boolean
}

export function buildArgv(
  tokens: string[],
  flags: HistoricalFlag[],
  options: BuildOptions = {},
): { argv: string[]; resolvedPath: string; droppedTokens: string[]; expectations: Expectation[] } {
  const s = surface()
  const { node, matched, rest } = resolveCommand(s, tokens)
  const byName = new Map<string, DeclaredOption>()
  for (const option of effectiveOptions(s, matched).values()) {
    for (const name of [option.key, ...option.aliases]) byName.set(name, option)
  }

  const declared = node?.positionals ?? []
  // A recorded token beyond what the declaration can hold is a flag value or a
  // word of a quoted SQL statement, never an argument of this command: `cz-cli sql
  // "show create table t"` records show/create/table as positional tokens.
  const capacity = declared.some((p) => p.variadic) ? rest.length : declared.length
  const keptTokens = rest.slice(0, capacity)
  const argv = [...matched, ...keptTokens]
  for (const positional of declared.slice(keptTokens.length)) {
    if (!positional.required) break
    argv.push(synthesizePositional(positional.name))
  }

  const expectations: Expectation[] = []
  for (const flag of flags) {
    if (BUILTIN_BOOLEANS.has(flag.key)) {
      // Short-circuits the parser before validation; replay it as the bare flag so
      // the verdict is HELP_OR_VERSION rather than a bogus value rejection.
      argv.push(`--${flag.key}`)
      continue
    }
    // `--no-x` is yargs boolean negation, not an option named "no-x": it lands as
    // x === false. Emitting it as `--no-x=value` (or looking for a "no-x" key in
    // argv) reports a removed flag for something that works.
    const negated = flag.key.startsWith("no-") ? flag.key.slice(3) : undefined
    const negatedOption = negated ? lookup(byName, negated) : undefined
    if (negated && negatedOption) {
      argv.push(`--no-${negated}`)
      // Negation of a boolean yields false; of a number (`--no-limit` on
      // `--limit`, which the sql help documents) it yields 0.
      const falsy = negatedOption.type === "number" ? 0 : false
      expectations.push({
        key: flag.key,
        names: spellings(negated, negatedOption.key),
        holds: (v) => v === falsy,
      })
      continue
    }
    const option = lookup(byName, flag.key)
    const names = spellings(flag.key, ...(option ? [option.key, ...option.aliases] : []))
    if (option?.type === "boolean") {
      argv.push(`--${flag.key}`)
      expectations.push({ key: flag.key, names, holds: (v) => v === true })
      continue
    }
    if (!option && !flag.hadValue) {
      argv.push(`--${flag.key}`)
      expectations.push({ key: flag.key, names, holds: (v) => v !== undefined })
      continue
    }
    const value = flag.value ?? synthesizeValue(flag.key, option)
    argv.push(`--${flag.key}=${value}`)
    expectations.push({
      key: flag.key,
      names,
      holds: (v) =>
        Array.isArray(v) ? v.map(String).includes(value) : v !== undefined && String(v) === value,
    })
  }
  if (options.fillRequired) {
    const supplied = new Set(flags.flatMap((flag) => spellings(flag.key)))
    for (const option of new Set(byName.values())) {
      if (!option.demanded || supplied.has(option.key)) continue
      argv.push(`--${option.key}=${synthesizeValue(option.key, option)}`)
    }
  }

  return {
    // An invocation with no tokens and no flags is `cz-cli` with no arguments,
    // which the real entry point turns into a help request (src/run-cli.ts:427).
    argv: argv.length === 0 ? ["--help"] : argv,
    resolvedPath: matched.join(" "),
    droppedTokens: rest.slice(capacity),
    expectations,
  }
}

/**
 * Whether `key` is an option the resolved command actually declares.
 *
 * Used to scope the value-coverage layer. Command normalization derives the path
 * from a token stream that also contains flag values, so a (path, key, value)
 * triple can pair an option with a command it never ran against. Asking "is this
 * value still admitted" only means something where the option exists; whether the
 * option itself survived is Tier A's question, on the recorded flag set.
 */
export function isDeclaredOption(tokens: string[], key: string): boolean {
  if (BUILTIN_BOOLEANS.has(key)) return true
  const s = surface()
  const { matched } = resolveCommand(s, tokens)
  const byName = new Map<string, DeclaredOption>()
  for (const option of effectiveOptions(s, matched).values()) {
    for (const name of [option.key, ...option.aliases]) byName.set(name, option)
  }
  const negated = key.startsWith("no-") ? key.slice(3) : undefined
  return Boolean(lookup(byName, key) ?? (negated ? lookup(byName, negated) : undefined))
}

function classifyFailure(message: string): Verdict {
  if (/^Unknown arguments?:/.test(message)) return "FLAG_REMOVED"
  if (/^Unknown commands?:/.test(message)) return "COMMAND_REMOVED"
  if (/^Not enough non-option arguments/.test(message)) return "POSITIONAL_REQUIRED"
  if (/^Missing required arguments?:/.test(message)) return "OPTION_REQUIRED"
  if (/^Invalid values:/.test(message)) return "CHOICE_NARROWED"
  // Groups built with a raw `.demandCommand(1, msg)` instead of commandGroup()
  // phrase their bare-invocation failure in their own words; it is still just
  // "no subcommand chosen", the same as SubcommandHelpShown.
  if (/see available subcommands|Missing subcommand/.test(message)) return "SUBCOMMAND_HELP"
  return "VALUE_REJECTED"
}

const originalStdoutWrite = process.stdout.write.bind(process.stdout)
const originalStderrWrite = process.stderr.write.bind(process.stderr)

/**
 * Parse `argv` with the full command tree and report what the parser did with it.
 * Handlers never run: the capture middleware throws first.
 */
export async function replayArgv(argv: string[]): Promise<{ verdict: Verdict; message?: string; parsed?: Record<string, unknown> }> {
  const chunks: string[] = []
  const savedExitCode = process.exitCode
  const sink = ((chunk: string | Uint8Array) => {
    chunks.push(typeof chunk === "string" ? chunk : chunk.toString())
    return true
  }) as typeof process.stdout.write
  process.stdout.write = sink
  process.stderr.write = sink
  // yargs prints help and the version string through console.log, which under Bun
  // does not route via process.stdout.write — so silencing the console too is what
  // actually keeps a --help/--version replay from flooding the test output.
  const savedConsole = { log: console.log, error: console.error, warn: console.warn }
  const collect = (...args: unknown[]) => chunks.push(args.join(" "))
  console.log = collect
  console.error = collect
  console.warn = collect
  process.exitCode = 0
  try {
    const cli = registerCommands(createCli(argv)).demandCommand(1, "").help()
    cli.middleware((parsed) => {
      throw new Captured(parsed as Record<string, unknown>)
    }, /* applyBeforeValidation */ false)
    await cli.parseAsync()
    // No middleware hit and no failure: yargs answered --help/--version itself.
    return { verdict: "HELP_OR_VERSION" }
  } catch (error) {
    if (error instanceof Captured) return { verdict: "PASS", parsed: error.argv }
    if (error instanceof SubcommandHelpShown) return { verdict: "SUBCOMMAND_HELP" }
    const message = error instanceof Error ? error.message : String(error)
    return { verdict: classifyFailure(message), message }
  } finally {
    process.stdout.write = originalStdoutWrite
    process.stderr.write = originalStderrWrite
    console.log = savedConsole.log
    console.error = savedConsole.error
    console.warn = savedConsole.warn
    process.exitCode = savedExitCode ?? 0
  }
}

/**
 * Replay one historical (command, flag-set) combination and additionally assert
 * that each flag actually reached argv — a flag can survive strict validation and
 * still be dropped, which the failure text alone would not reveal.
 */
export async function replayHistorical(
  tokens: string[],
  flags: HistoricalFlag[],
  options: BuildOptions = {},
): Promise<ReplayResult> {
  const { argv, resolvedPath, droppedTokens, expectations } = buildArgv(tokens, flags, options)
  const outcome = await replayArgv(argv)
  const result: ReplayResult = {
    verdict: outcome.verdict,
    argv,
    message: outcome.message,
    resolvedPath,
    ...(droppedTokens.length > 0 ? { droppedTokens } : {}),
  }
  if (outcome.verdict !== "PASS" || !outcome.parsed) return result

  const parsed = outcome.parsed
  const missing = expectations
    .filter((expectation) => !expectation.names.some((name) => expectation.holds(parsed[name])))
    .map((expectation) => expectation.key)
  if (missing.length > 0) return { ...result, verdict: "FLAG_NOT_IN_ARGV", missing }
  return result
}
