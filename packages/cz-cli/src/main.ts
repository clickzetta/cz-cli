#!/usr/bin/env bun
// Dev entry point (bun run src/main.ts). The compiled binary uses src/bootstrap/boot.ts.
import { checkAndUpdate } from "./auto-update.js"
import { runCliWithTracking } from "./run-cli.js"
import { createTraceparent } from "@clickzetta/sdk"
import { parseOutputArgs, renderErrorOutput } from "./output/index.js"

if (!process.env.CLICKZETTA_TRACEPARENT) {
  process.env.CLICKZETTA_TRACEPARENT = createTraceparent()
}

process.on("SIGINT", () => {
  const outputArgs = parseOutputArgs(process.argv.slice(2))
  // renderErrorOutput, matching sql.ts's SIGINT handler and error(): one error shape
  // per format, so Ctrl-C under --format text is an ERROR row like any other failure.
  process.stdout.write(renderErrorOutput({ error: { code: "ABORTED", message: "Operation aborted by user." } }, outputArgs.format, outputArgs.field) + "\n")
  process.exit(130)
})

const cliArgs = process.argv.slice(2)
await checkAndUpdate(cliArgs)
await runCliWithTracking(cliArgs)
if (process.exitCode) process.exit()
