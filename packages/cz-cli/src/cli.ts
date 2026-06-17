import yargs from "yargs"
import { VERSION } from "./version.js"
import { defaultFormat, outputState, parseOutputArgs, renderOutput } from "./output/index.js"
import { withClickZettaProfileOption } from "./clickzetta-profile-option.js"

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

export function createCli(args: string[]) {
  return withClickZettaProfileOption(yargs(coalesceJsonArrayOptionArgs(args)))
    .scriptName("cz-cli")
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
      const aiMessage = "Run the command with --help to see available options and usage."
      const message = (msg && msg.trim() !== "") ? msg : (() => {
        const KNOWN_FLAGS = new Set(["profile", "p", "jdbc", "pat", "username", "password", "service", "protocol", "instance", "workspace", "schema", "s", "vcluster", "v", "format", "field", "debug", "d", "help", "h", "version", "target", "t"])
        const KNOWN_COMMANDS = new Set(["sql", "schema", "table", "workspace", "status", "profile", "task", "runs", "attempts", "job", "agent", "serve", "setup", "update", "datasource", "ai-gateway", "analytics-agent"])
        const unknownFlags = args.filter((a) => a.startsWith("-")).map((a) => a.replace(/^-+/, "").split("=")[0]).filter((a) => !KNOWN_FLAGS.has(a))
        if (unknownFlags.length > 0) return `Unknown argument: ${unknownFlags[0]}`
        const topLevelCmd = args.find((a) => !a.startsWith("-"))
        if (topLevelCmd !== undefined && !KNOWN_COMMANDS.has(topLevelCmd)) return `Unknown argument: ${topLevelCmd}`
        return "Unknown argument"
      })()
      const outputArgs = parseOutputArgs(args)
      const output = renderOutput({
        error: { code: "USAGE_ERROR", message },
        ai_message: aiMessage,
      }, outputArgs.format, outputArgs.field)
      process.stdout.write(output + "\n")
      process.exitCode = 2
      throw new Error(msg ?? "usage error")
    })
}
