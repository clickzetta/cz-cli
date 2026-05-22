import yargs from "yargs"
import { VERSION } from "./version.js"
import { outputState } from "./output/index.js"

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
  output: string
  output_explicit?: boolean
  field?: string
  debug: boolean
}

export function createCli(args: string[]) {
  return yargs(args)
    .scriptName("cz-cli")
    .version(VERSION)
    .exitProcess(false)
    .option("profile", {
      alias: "p",
      type: "string",
      describe: "Profile name from ~/.clickzetta/profiles.toml",
    })
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
    .option("output", {
      alias: "o",
      type: "string",
      choices: ["json", "pretty", "table", "csv", "text", "jsonl", "toon"] as const,
      default: "json",
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
    .option("output_explicit", {
      type: "boolean",
      hidden: true,
      default: false,
    })
    .middleware((argv) => {
      const rawArgs = args.map(a => String(a))
      const hasExplicitOutput = rawArgs.some(
        (a) => a === "-o" || a === "--output" || a.startsWith("--output=") || a.startsWith("-o=")
      )
      argv.output_explicit = hasExplicitOutput
      outputState.field = argv.field as string | undefined
    }, /* applyBeforeValidation */ true)
    .strict()
    .fail((msg, err, yargs) => {
      if (err) throw err
      const aiMessage = "Run the command with --help to see available options and usage."
      const message = (msg && msg.trim() !== "") ? msg : (() => {
        const KNOWN_FLAGS = new Set(["profile", "p", "jdbc", "pat", "username", "password", "service", "protocol", "instance", "workspace", "schema", "s", "vcluster", "v", "output", "o", "field", "debug", "d", "help", "h", "version"])
        const KNOWN_COMMANDS = new Set(["sql", "schema", "table", "workspace", "status", "profile", "task", "runs", "attempts", "job", "agent", "setup", "update", "ai-guide","datasource"])
        const unknownFlags = args.filter((a) => a.startsWith("-")).map((a) => a.replace(/^-+/, "").split("=")[0]).filter((a) => !KNOWN_FLAGS.has(a))
        if (unknownFlags.length > 0) return `Unknown argument: ${unknownFlags[0]}`
        const topLevelCmd = args.find((a) => !a.startsWith("-"))
        if (topLevelCmd !== undefined && !KNOWN_COMMANDS.has(topLevelCmd)) return `Unknown argument: ${topLevelCmd}`
        return "Unknown argument"
      })()
      const output = JSON.stringify({
        error: { code: "USAGE_ERROR", message },
        ai_message: aiMessage,
      })
      process.stdout.write(output + "\n")
      process.exitCode = 2
      throw new Error(msg ?? "usage error")
    })
}
