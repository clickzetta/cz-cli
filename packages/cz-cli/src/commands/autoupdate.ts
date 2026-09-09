import type { Argv } from "yargs"
import type { GlobalArgs } from "../cli.js"
import { renderOutput } from "../output/index.js"
import { ConfigAutoupdate } from "../config/autoupdate.js"
import { updateLogPath } from "../bootstrap/update-log.js"

function parseAutoupdate(value: string): ConfigAutoupdate.Value {
  const normalized = value.trim().toLowerCase()
  if (["true", "on", "yes", "enable", "enabled"].includes(normalized)) return true
  if (["false", "off", "no", "disable", "disabled"].includes(normalized)) return false
  if (normalized === "notify") return "notify"
  throw new Error("autoupdate must be one of: true, false, notify")
}

function output(rawArgv: Record<string, unknown>, data: Record<string, unknown>, message: string) {
  const format = typeof rawArgv.format === "string" ? rawArgv.format : undefined
  const field = typeof rawArgv.field === "string" ? rawArgv.field : undefined
  if (rawArgv.format_explicit === true || !process.stdout.isTTY) {
    process.stdout.write(renderOutput({ data, ai_message: message }, format, field) + "\n")
    return
  }
  process.stdout.write(message + "\n")
}

export function registerAutoupdateCommand(cli: Argv<GlobalArgs>) {
  cli.command(
    "autoupdate [value]",
    "Show or set automatic update behavior",
    (yargs) =>
      yargs.positional("value", {
        type: "string",
        choices: ["true", "false", "notify", "on", "off"] as const,
        describe: "Automatic update behavior. Omit to show the current value.",
      }),
    async (argv) => {
      try {
        if (argv.value !== undefined) {
          await ConfigAutoupdate.write(parseAutoupdate(String(argv.value)))
        }
        const config = await ConfigAutoupdate.read()
        const saved = argv.value === undefined ? "" : `Saved autoupdate=${config.configured} in ${config.path}. `
        output(argv, { ...config, log_path: updateLogPath() }, `${saved}autoupdate=${config.value} (source: ${config.source}). Log: ${updateLogPath()}`)
      } catch (error) {
        process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
        process.exitCode = 2
      }
    },
  )
}
