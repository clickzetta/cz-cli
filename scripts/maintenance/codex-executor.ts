import { spawn } from "node:child_process"
import { chmodSync, createWriteStream, mkdirSync } from "node:fs"
import path from "node:path"
import { finished } from "node:stream/promises"
import type { Role } from "./service-store"

export type CodexSettings = {
  binary: string
  home: string
  model?: string
  profile?: string
  sandbox: "read-only" | "workspace-write" | "danger-full-access"
  timeoutSeconds: number
}

export function codexSettings(value: unknown): CodexSettings {
  if (!value || typeof value !== "object") throw new Error("Configure native.codex before starting the service")
  const settings = value as Partial<CodexSettings>
  if (
    typeof settings.binary !== "string" ||
    !path.isAbsolute(settings.binary) ||
    typeof settings.home !== "string" ||
    !path.isAbsolute(settings.home) ||
    !["read-only", "workspace-write", "danger-full-access"].includes(settings.sandbox ?? "") ||
    !Number.isInteger(settings.timeoutSeconds) ||
    settings.timeoutSeconds! < 60 ||
    settings.timeoutSeconds! > 7200 ||
    (settings.model !== undefined && (typeof settings.model !== "string" || !settings.model.trim())) ||
    (settings.profile !== undefined && (typeof settings.profile !== "string" || !settings.profile.trim()))
  )
    throw new Error("native.codex requires absolute binary/home, explicit sandbox and timeoutSeconds (60..7200)")
  return settings as CodexSettings
}

export async function executeCodex(input: {
  root: string
  directory: string
  id: string
  role: Role
  settings: CodexSettings
  prompt: string
  schema?: string
  env?: NodeJS.ProcessEnv
  signal: AbortSignal
  onThread: (thread: string) => void
}) {
  if (input.signal.aborted) return { success: false, thread: undefined, detail: "Execution stopped before launch" }
  const directory = path.join(input.directory, "control", "runs", input.id)
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  const output = path.join(directory, "response.txt")
  await Bun.write(path.join(directory, "prompt.txt"), input.prompt, { mode: 0o600 })
  chmodSync(path.join(directory, "prompt.txt"), 0o600)
  const events = createWriteStream(path.join(directory, "events.jsonl"), { mode: 0o600 })
  const errors = createWriteStream(path.join(directory, "stderr.log"), { mode: 0o600 })
  const args = [
    "-c",
    'approval_policy="never"',
    "exec",
    "--json",
    "--sandbox",
    input.settings.sandbox,
    "--output-last-message",
    output,
  ]
  if (input.settings.model) args.push("--model", input.settings.model)
  if (input.settings.profile) args.push("--profile", input.settings.profile)
  if (input.schema) args.push("--output-schema", input.schema)
  args.push("-")
  const child = spawn(input.settings.binary, args, {
    cwd: input.root,
    env: { ...(input.env ?? process.env), CODEX_HOME: input.settings.home },
    detached: true,
    stdio: ["pipe", "pipe", "pipe"],
  })
  const state = { completed: false, failed: false, thread: "", detail: "", pending: "", stopping: false }
  const stop = () => {
    state.stopping = true
    signalGroup(child.pid, "SIGTERM")
  }
  const timeout = setTimeout(stop, input.settings.timeoutSeconds * 1000)
  input.signal.addEventListener("abort", stop, { once: true })
  if (input.signal.aborted) stop()
  const escalation = setInterval(() => {
    if (state.stopping) signalGroup(child.pid, "SIGKILL")
  }, 5000)
  child.stdout.pipe(events)
  child.stderr.pipe(errors)
  child.stdout.setEncoding("utf8")
  const parse = (line: string) => {
    if (!line.trim()) return
    try {
      const event = JSON.parse(line)
      if (event.type === "thread.started" && typeof event.thread_id === "string") {
        state.thread = event.thread_id
        input.onThread(state.thread)
      }
      if (event.type === "turn.completed") state.completed = true
      if (event.type === "turn.failed" || event.type === "error") {
        state.failed = true
        state.detail = "Codex reported an error; inspect the private run transcript"
      }
    } catch {
      state.failed = true
      state.detail = "Invalid Codex JSONL output"
    }
  }
  child.stdout.on("data", (chunk: string) => {
    if (state.stopping) return
    state.pending += chunk
    const lines = state.pending.split("\n")
    state.pending = lines.pop() ?? ""
    lines.forEach(parse)
    if (state.pending.length > 1_048_576) {
      state.detail = "Oversized Codex protocol line"
      state.pending = ""
      stop()
    }
  })
  const code = await new Promise<number | null>((resolve) => {
    child.once("error", () => {
      state.detail = "Codex could not be started; check executable and credentials"
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
  clearTimeout(timeout)
  clearInterval(escalation)
  input.signal.removeEventListener("abort", stop)
  // Delegates must finish within their parent round. Terminate surviving process-group children.
  signalGroup(child.pid, "SIGKILL")
  if (state.pending) parse(state.pending)
  await Promise.all([finished(events), finished(errors)])
  if (await Bun.file(output).exists()) chmodSync(output, 0o600)
  const response = await Bun.file(output)
    .text()
    .catch(() => "")
  const success = code === 0 && state.completed && !state.failed && !state.stopping && response.trim().length > 0
  return {
    success,
    thread: state.thread || undefined,
    detail: success
      ? undefined
      : state.detail ||
        (state.stopping
          ? "Execution stopped or timed out; reconcile before resume"
          : "Codex did not produce a completed turn and final response"),
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
