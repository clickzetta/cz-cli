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
  silent: boolean
  verbose: boolean
}

export function createCli(args: string[]) {
  return yargs(args)
    .scriptName("cz-cli")
    .version(VERSION)
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
    .option("silent", {
      type: "boolean",
      default: false,
      describe: "Suppress non-essential output",
    })
    .option("verbose", {
      type: "boolean",
      default: false,
      describe: "Verbose output",
    })
    .option("output_explicit", {
      type: "boolean",
      hidden: true,
      default: false,
    })
    .middleware((argv) => {
      // Detect whether --output was explicitly provided by the user
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
      const output = JSON.stringify({
        ok: false,
        error: {
          code: "USAGE_ERROR",
          message: msg,
        },
        ai_message: aiMessage,
      })
      process.stdout.write(output + "\n")
      process.exitCode = 2
      throw new Error(msg ?? "usage error")
    })
}
