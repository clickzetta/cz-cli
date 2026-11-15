import { spawn } from "node:child_process"
import { chmodSync, createWriteStream, mkdirSync } from "node:fs"
import path from "node:path"
import { finished } from "node:stream/promises"

export async function executeReview(input: {
  binary: string
  home: string
  source: string
  directory: string
  model: string
  prompt: string
  schema: string
  timeoutMs?: number
}) {
  mkdirSync(input.directory, { recursive: true, mode: 0o700 })
  chmodSync(input.directory, 0o700)
  const output = path.join(input.directory, "response.txt")
  await Promise.all(
    Object.entries({ "response.txt": "", "prompt.txt": input.prompt, "events.jsonl": "", "stderr.log": "" }).map(
      async ([name, content]) => {
        const file = path.join(input.directory, name)
        await Bun.write(file, content, { mode: 0o600 })
        chmodSync(file, 0o600)
      },
    ),
  )
  const events = createWriteStream(path.join(input.directory, "events.jsonl"), { mode: 0o600 })
  const errors = createWriteStream(path.join(input.directory, "stderr.log"), { mode: 0o600 })
  const child = spawn(
    input.binary,
    [
      "-c",
      'approval_policy="never"',
      "exec",
      "--json",
      "--output-last-message",
      output,
      // --sandbox overrides named profiles; review always uses the restrictive host profile.
      "-c",
      'default_permissions="review"',
      "--ignore-rules",
      "--strict-config",
      "--model",
      input.model,
      "--output-schema",
      input.schema,
      "-",
    ],
    {
      cwd: input.source,
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        CODEX_HOME: input.home,
        GIT_CONFIG_GLOBAL: "/dev/null",
        GIT_CONFIG_NOSYSTEM: "1",
      },
      detached: true,
      stdio: ["pipe", "pipe", "pipe"],
    },
  )
  const state = { completed: false, failed: false, pending: "", stopping: false }
  const stop = () => {
    state.stopping = true
    signalGroup(child.pid, "SIGTERM")
  }
  const timeout = setTimeout(stop, input.timeoutMs ?? 900_000)
  const escalation = setInterval(() => {
    if (state.stopping) signalGroup(child.pid, "SIGKILL")
  }, 5000)
  process.once("SIGTERM", stop)
  process.once("SIGINT", stop)
  events.on("error", stop)
  errors.on("error", stop)
  child.stdout.pipe(events)
  child.stderr.pipe(errors)
  child.stdout.setEncoding("utf8")
  const parse = (line: string) => {
    if (!line.trim()) return
    if (line.length > 1_048_576) {
      stop()
      return
    }
    try {
      const event = JSON.parse(line)
      if (!event || typeof event !== "object" || typeof event.type !== "string") {
        state.failed = true
        return
      }
      // Codex 0.167.1 flattens recoverable StreamError notices into type:error.
      // Recovery requires later turn.completed, exit zero and a nonempty final response.
      if (event.type === "turn.failed" || (event.type === "error" && state.completed)) state.failed = true
      if (event.type === "turn.started" || event.type === "error") state.completed = false
      if (event.type === "turn.completed") state.completed = true
    } catch {
      state.failed = true
    }
  }
  child.stdout.on("data", (chunk: string) => {
    if (state.stopping) return
    state.pending += chunk
    const lines = state.pending.split("\n")
    state.pending = lines.pop() ?? ""
    lines.forEach(parse)
    if (state.pending.length > 1_048_576) {
      state.pending = ""
      stop()
    }
  })
  // Observe log-write failures while awaiting the process, rather than only after it exits.
  const transcripts = Promise.all([finished(events), finished(errors)]).catch(() => {
    stop()
    return false
  })
  try {
    const code = await new Promise<number | null>((resolve) => {
      child.once("error", () => {
        state.failed = true
        child.stdout.unpipe(events)
        child.stderr.unpipe(errors)
        events.end()
        errors.end()
        resolve(null)
      })
      child.once("close", resolve)
      child.stdin.on("error", () => {})
      child.stdin.end(input.prompt)
    })
    signalGroup(child.pid, "SIGKILL")
    if (state.pending) parse(state.pending)
    const written = await transcripts
    const response = await Bun.file(output).text()
    if (written !== false && code === 0 && state.completed && !state.failed && !state.stopping && response.trim())
      return response
  } finally {
    clearTimeout(timeout)
    clearInterval(escalation)
    process.removeListener("SIGTERM", stop)
    process.removeListener("SIGINT", stop)
    signalGroup(child.pid, "SIGKILL")
  }
}

function signalGroup(pid: number | undefined, signal: NodeJS.Signals) {
  if (!pid) return
  try {
    process.kill(-pid, signal)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error
  }
}
