import { appendFile, mkdir } from "node:fs/promises"
import { homedir } from "node:os"
import path from "node:path"
import { CLEANUP_ENV, createSqlSupervisor } from "./cleanup-scope.js"

/** Bootstrap before importing the agent or creating its Worker: both inherit the endpoint. */
export async function withSqlSupervisor<T>(run: () => Promise<T>): Promise<T> {
  const previous = process.env[CLEANUP_ENV]
  const directory = path.join(process.env.CLICKZETTA_TEST_HOME || homedir(), ".clickzetta")
  const logfile = path.join(directory, "sql-cleanup.jsonl")
  const supervisor = await (async () => {
    // Open diagnostics before admitting jobs, not in a failing finalizer.
    await mkdir(directory, { recursive: true })
    await appendFile(logfile, "", { mode: 0o600 })
    return createSqlSupervisor({
      async onWarning(warning) {
        // Never write into a terminal owned by the TUI renderer or persist credentials.
        await appendFile(logfile, JSON.stringify({ time: new Date().toISOString(), ...warning }) + "\n")
      },
    })
  })().catch(() => undefined)
  // Keep non-SQL tools usable if local sockets/diagnostics are unavailable.
  // SQL must still fail closed rather than silently run without supervision.
  process.env[CLEANUP_ENV] = supervisor?.env[CLEANUP_ENV] ?? "unavailable"
  try {
    return await run()
  } finally {
    if (previous === undefined) delete process.env[CLEANUP_ENV]
    else process.env[CLEANUP_ENV] = previous
    await supervisor?.close()
  }
}
