#!/usr/bin/env bun
// Dev entry point (bun run src/main.ts). The compiled binary uses opencode/src/index.ts.
import { checkAndUpdate } from "./auto-update.js"
import { runCliWithTracking } from "./run-cli.js"
import { createTraceparent } from "@clickzetta/sdk"

if (!process.env.CLICKZETTA_TRACEPARENT) {
  process.env.CLICKZETTA_TRACEPARENT = createTraceparent()
}

process.on("SIGINT", () => {
  process.stdout.write(JSON.stringify({ error: { code: "ABORTED", message: "Operation aborted by user." } }) + "\n")
  process.exit(130)
})

const cliArgs = process.argv.slice(2)
await checkAndUpdate(cliArgs)
await runCliWithTracking(cliArgs)
if (process.exitCode) process.exit()
