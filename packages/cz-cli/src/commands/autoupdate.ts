import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import type { Argv } from "yargs"
import type { GlobalArgs } from "../cli.js"
import { renderOutput } from "../output/index.js"

type AutoupdateValue = boolean | "notify"

function statePath() {
  const home = process.env.CLICKZETTA_TEST_HOME || homedir()
  const stateHome = process.env.XDG_STATE_HOME || join(home, ".local", "state")
  return join(stateHome, "clickzetta", "update-check.json")
}

function readState() {
  const file = statePath()
  if (!existsSync(file)) return {}
  const parsed = JSON.parse(readFileSync(file, "utf-8")) as unknown
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}
}

function writeState(state: Record<string, unknown>) {
  const file = statePath()
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify(state, null, 2) + "\n")
  return file
}

function parseAutoupdate(value: string): AutoupdateValue {
  const normalized = value.trim().toLowerCase()
  if (["true", "on", "yes", "enable", "enabled"].includes(normalized)) return true
  if (["false", "off", "no", "disable", "disabled"].includes(normalized)) return false
  if (normalized === "notify") return "notify"
  throw new Error("autoupdate must be one of: true, false, notify")
}

function currentAutoupdate() {
  const value = readState().autoupdate
  return value === false || value === "notify" ? value : true
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
    (argv) => {
      try {
        if (argv.value === undefined) {
          const state = readState()
          const value = currentAutoupdate()
          output(argv, { value, path: statePath(), defaulted: !("autoupdate" in state) }, `autoupdate=${value}`)
          return
        }
        const state = readState()
        const value = parseAutoupdate(String(argv.value))
        state.autoupdate = value
        const file = writeState(state)
        output(argv, { value, path: file }, `Set autoupdate=${value} in ${file}`)
      } catch (error) {
        process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
        process.exitCode = 2
      }
    },
  )
}
