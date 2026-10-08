import { appendFile, chmod, mkdir } from "node:fs/promises"
import { homedir } from "node:os"
import path from "node:path"
import { CLEANUP_ENV, createSqlSupervisor } from "./cleanup-scope.js"

/** Bootstrap before importing the agent or creating its Worker: both inherit the endpoint. */
export async function withSqlSupervisor<T>(run: () => Promise<T>): Promise<T> {
  const previous = process.env[CLEANUP_ENV]
  const directory = path.join(process.env.CLICKZETTA_TEST_HOME || homedir(), ".clickzetta")
  const logfile = path.join(directory, "sql-cleanup.jsonl")
  // Diagnostics are best effort: an unwritable ~/.clickzetta loses unconfirmed-cleanup
  // records, but must not withdraw supervision and refuse every agent SQL call.
  const diagnostics = await mkdir(directory, { recursive: true })
    .then(() => appendFile(logfile, "", { mode: 0o600 }))
    // mode only applies on creation; tighten a pre-existing file too.
    .then(() => chmod(logfile, 0o600))
    .then(() => true, () => false)
  const supervisor = await createSqlSupervisor({
    async onWarning(warning) {
      // Never write into a terminal owned by the TUI renderer or persist credentials.
      if (!diagnostics) return
      await appendFile(logfile, JSON.stringify({ time: new Date().toISOString(), ...warning }) + "\n")
    },
  }).catch(() => undefined)
  // Keep non-SQL tools usable if the loopback socket is unavailable.
  // SQL must still fail closed rather than silently run without supervision.
  process.env[CLEANUP_ENV] = supervisor?.env[CLEANUP_ENV] ?? "unavailable"
  try {
    return await run()
  } finally {
    if (previous === undefined) delete process.env[CLEANUP_ENV]
    else process.env[CLEANUP_ENV] = previous
    // A listener close error has nothing left to report; never replace run()'s exit code.
    await supervisor?.close().catch(() => {})
  }
}
