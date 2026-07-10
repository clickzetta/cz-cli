import yargs from "yargs"
import { VERSION } from "./version.js"
import { defaultFormat, outputState, parseOutputArgs, renderOutput } from "./output/index.js"
import { withClickZettaProfileOption } from "./clickzetta-profile-option.js"
import { suggestClosest } from "./suggest.js"

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
export const KNOWN_GLOBAL_FLAGS = ["profile", "p", "jdbc", "pat", "username", "password", "service", "protocol", "instance", "workspace", "schema", "s", "vcluster", "v", "format", "field", "debug", "d", "help", "h", "version", "target", "t"]
export const KNOWN_TOP_COMMANDS = ["sql", "schema", "table", "workspace", "workspace-param", "status", "profile", "task", "runs", "attempts", "job", "agent", "serve", "setup", "update", "datasource", "ai-gateway", "analytics-agent"]

export function coalesceJsonArrayOptionArgs(args: string[]): string[] {
  const result: string[] = []
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!
    const isLongForm = JSON_ARRAY_OPTIONS.has(arg)
    const isEqForm = !isLongForm && [...JSON_ARRAY_OPTIONS].some((name) => arg.startsWith(name + "="))
    // Long form needs a value token that is not itself a flag; otherwise leave it for yargs.
    if (!isEqForm && (!isLongForm || args[i + 1] === undefined || args[i + 1]!.startsWith("-"))) {
      result.push(arg)
      continue
    }
    let value = isLongForm ? args[i + 1]! : arg
    let j = isLongForm ? i + 2 : i + 1
    while (j < args.length && !args[j]!.startsWith("-")) {
      value += args[j]!
      j++
    }
    if (isLongForm) result.push(arg, value)
    else result.push(value)
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
    .option("vcluster", {
      alias: "v",
      type: "string",
      describe: "Virtual cluster",
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
    .middleware((argv) => {
      const rawArgs = args.map(a => String(a))
      const hasExplicitFormat = rawArgs.some(
        (a) => a === "--format" || a.startsWith("--format=")
      )
      argv.format_explicit = hasExplicitFormat
      outputState.field = argv.field as string | undefined
    }, /* applyBeforeValidation */ true)
    .strict()
    .fail((msg, err, yargs) => {
      if (err) throw err
      const KNOWN_FLAGS = KNOWN_GLOBAL_FLAGS
      const KNOWN_COMMANDS = KNOWN_TOP_COMMANDS
      const knownFlagSet = new Set(KNOWN_FLAGS)
      const knownCommandSet = new Set(KNOWN_COMMANDS)

      // Identify the offending token so we can offer a "did you mean" suggestion.
      // A bad flag takes priority over a bad command (yargs reports flags first).
      let badToken: string | undefined
      let suggestion: string | undefined
      let isFlag = false
      const unknownFlags = args.filter((a) => a.startsWith("-")).map((a) => a.replace(/^-+/, "").split("=")[0]).filter((a) => a && !knownFlagSet.has(a))
      if (unknownFlags.length > 0) {
        isFlag = true
        badToken = unknownFlags[0]
        const hit = suggestClosest(badToken!, KNOWN_FLAGS.filter((f) => f.length > 1))
        if (hit) suggestion = `--${hit}`
      } else {
        const topLevelCmd = args.find((a) => !a.startsWith("-"))
        if (topLevelCmd !== undefined && !knownCommandSet.has(topLevelCmd)) {
          badToken = topLevelCmd
          suggestion = suggestClosest(topLevelCmd, KNOWN_COMMANDS)
        }
      }

      const baseMessage = (msg && msg.trim() !== "")
        ? msg
        : (badToken !== undefined ? `Unknown argument: ${badToken}` : "Unknown argument")
      const message = suggestion ? `${baseMessage}. Did you mean '${suggestion}'?` : baseMessage
      const aiMessage = suggestion
        ? `Unknown ${isFlag ? "argument" : "command"} '${isFlag ? `--${badToken}` : badToken}'. Did you mean '${suggestion}'? Run cz-cli --help to see all available commands.`
        : "Run the command with --help to see available options and usage."

      const outputArgs = parseOutputArgs(args)
      const errorObj: Record<string, unknown> = { code: "USAGE_ERROR", message }
      if (suggestion) errorObj.did_you_mean = suggestion
      const output = renderOutput({
        error: errorObj,
        ai_message: aiMessage,
      }, outputArgs.format, outputArgs.field)
      process.stdout.write(output + "\n")
      process.exitCode = 2
      throw new Error(msg ?? "usage error")
    })
}
