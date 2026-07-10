#!/usr/bin/env bun
// Dev entry point (bun run src/main.ts). The compiled binary uses src/bootstrap/boot.ts.
import { checkAndUpdate } from "./auto-update.js"
import { runCliWithTracking } from "./run-cli.js"
import { createTraceparent } from "@clickzetta/sdk"
import { parseOutputArgs, renderOutput } from "./output/index.js"

if (!process.env.CLICKZETTA_TRACEPARENT) {
  process.env.CLICKZETTA_TRACEPARENT = createTraceparent()
}

process.on("SIGINT", () => {
  const outputArgs = parseOutputArgs(process.argv.slice(2))
  process.stdout.write(renderOutput({ error: { code: "ABORTED", message: "Operation aborted by user." } }, outputArgs.format, outputArgs.field) + "\n")
  process.exit(130)
})

const cliArgs = process.argv.slice(2)
await checkAndUpdate(cliArgs)
await runCliWithTracking(cliArgs)
if (process.exitCode) process.exit()
