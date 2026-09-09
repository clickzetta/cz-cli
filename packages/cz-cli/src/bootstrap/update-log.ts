import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

export function updateLogPath(env: NodeJS.ProcessEnv = process.env) {
  const home = env.CLICKZETTA_TEST_HOME ?? os.homedir()
  return path.join(env.XDG_STATE_HOME ?? path.join(home, ".local", "state"), "clickzetta", "autoupdate.jsonl")
}

export function createUpdateLogger(version: string, env: NodeJS.ProcessEnv = process.env) {
  const file = updateLogPath(env)
  const run = crypto.randomUUID()
  // Bootstrap runs before the agent logger. Await each append so failures survive
  // process restart, but never let an unwritable log prevent the CLI from running.
  return async (event: string, fields: Record<string, string | number | boolean | null | undefined> = {}) => {
    await (async () => {
      await fs.mkdir(path.dirname(file), { recursive: true })
      const stat = await fs.stat(file).catch(() => undefined)
      if (stat && stat.size >= 1024 * 1024) await fs.rename(file, `${file}.1`)
      await fs.appendFile(file, JSON.stringify({
        timestamp: new Date().toISOString(),
        run_id: run,
        pid: process.pid,
        current_version: version,
        exec_path: process.execPath,
        event,
        ...fields,
        // Installer errors can include subprocess output; bound and redact it.
        ...(typeof fields.error === "string" ? { error: fields.error
          .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi, "$1[redacted]@")
          .replace(/(Bearer\s+)\S+/gi, "$1[redacted]")
          .replace(/((?:token|password|secret|api[_-]?key)\s*[=:]\s*)[^\s&,;]+/gi, "$1[redacted]")
          .slice(0, 4096) } : {}),
      }) + "\n", { mode: 0o600 })
    })().catch(() => {})
  }
}
