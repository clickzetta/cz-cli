import yargs from "yargs"
import { VERSION } from "./version.js"

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
  debug: boolean
  silent: boolean
  verbose: boolean
}

export function createCli(args: string[]) {
  return yargs(args)
    .scriptName("cz-tool")
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
      choices: ["json", "pretty", "table", "csv", "jsonl", "toon"] as const,
      default: "json",
      describe: "Output format",
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
    .strict()
    .fail((msg, err) => {
      const output = JSON.stringify({
        ok: false,
        error: { code: "USAGE_ERROR", message: msg || err?.message },
      })
      process.stdout.write(output + "\n")
      process.exit(2)
    })
}
