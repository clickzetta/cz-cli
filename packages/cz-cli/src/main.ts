#!/usr/bin/env bun
import { checkAndUpdate } from "./auto-update.js"
import { runCli } from "./run-cli.js"
import { trackCommand } from "./telemetry.js"

const startMs = Date.now()

process.on("SIGINT", () => {
  process.stdout.write(JSON.stringify({ error: { code: "ABORTED", message: "Operation aborted by user." } }) + "\n")
  process.exit(130)
})

const cliArgs = process.argv.slice(2)
const positional = cliArgs.filter((arg) => !arg.startsWith("-"))
const args: Record<string, string> = {}

if (positional.length > 2) {
  args["_positional"] = positional.slice(2).join(" ")
}

for (let i = 0; i < cliArgs.length; i++) {
  const arg = cliArgs[i]
  if (!arg.startsWith("-")) continue
  const eqIdx = arg.indexOf("=")
  if (eqIdx > 0) {
    args[arg.slice(0, eqIdx).replace(/^-+/, "")] = arg.slice(eqIdx + 1)
    continue
  }
  const next = cliArgs[i + 1]
  const key = arg.replace(/^-+/, "")
  if (next && !next.startsWith("-")) {
    args[key] = next
    i++
    continue
  }
  args[key] = "true"
}

const track = (success: boolean, error?: string) =>
  trackCommand({
    command: positional[0] ?? "unknown",
    subcommand: positional[1],
    args: Object.keys(args).length > 0 ? args : undefined,
    duration_ms: Date.now() - startMs,
    success,
    error,
    response_bytes: (process as unknown as Record<string, unknown>).responseBytes as number | undefined,
  })

try {
  await runCli(cliArgs)
  const lastError = (process as unknown as Record<string, unknown>).lastError as string | undefined
  if (positional[0] !== "setup") {
    await track(!process.exitCode, process.exitCode ? lastError ?? `exit_code=${process.exitCode}` : undefined)
  }
} catch (error) {
  if (positional[0] !== "setup") {
    await track(false, error instanceof Error ? error.message : `exit_code=${process.exitCode ?? 1}`)
  }
  throw error
}

if (process.exitCode) process.exit()

checkAndUpdate().catch(() => {})
