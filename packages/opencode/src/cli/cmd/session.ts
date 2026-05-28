import type { Argv } from "yargs"
import { cmd } from "./cmd"
import { Session } from "../../session"
import { MessageV2 } from "../../session/message-v2"
import { SessionID } from "../../session/schema"
import { bootstrap } from "../bootstrap"
import { UI } from "../ui"
import { Locale } from "../../util"
import { Flag } from "../../flag/flag"
import { Filesystem } from "../../util"
import { Database } from "../../storage"
import { Process } from "../../util"
import { EOL } from "os"
import path from "path"
import { which } from "../../util/which"
import { AppRuntime } from "@/effect/app-runtime"
import { commandGroup } from "@clickzetta/cli/command-group"
import { SessionStatus } from "../../session/status"
import { progressLine } from "../../session/render"
import { Cause } from "effect"
import { NotFoundError } from "../../storage"

function pagerCmd(): string[] {
  const lessOptions = ["-R", "-S"]
  if (process.platform !== "win32") {
    return ["less", ...lessOptions]
  }

  // user could have less installed via other options
  const lessOnPath = which("less")
  if (lessOnPath) {
    if (Filesystem.stat(lessOnPath)?.size) return [lessOnPath, ...lessOptions]
  }

  if (Flag.CLICKZETTA_GIT_BASH_PATH) {
    const less = path.join(Flag.CLICKZETTA_GIT_BASH_PATH, "..", "..", "usr", "bin", "less.exe")
    if (Filesystem.stat(less)?.size) return [less, ...lessOptions]
  }

  const git = which("git")
  if (git) {
    const less = path.join(git, "..", "..", "usr", "bin", "less.exe")
    if (Filesystem.stat(less)?.size) return [less, ...lessOptions]
  }

  // Fall back to Windows built-in more (via cmd.exe)
  return ["cmd", "/c", "more"]
}

/**
 * Stable dedupe key for `--wait` mode. Each tool emits one event per status
 * transition (pending/running/completed/error); non-tool parts emit once.
 */
export function partWaitKey(part: MessageV2.Part): string {
  if (part.type === "tool") return `${part.id}:${part.state.status}`
  if (part.type === "text") return `${part.id}:text:${Math.floor(part.text.trim().length / 120)}`
  return `${part.id}:${part.type}`
}

/**
 * Walk parts oldest→newest, drop non-informative and already-seen ones,
 * mutate `seen` with the keys we emit. Used by `--wait` to turn a sequence
 * of `recentParts` snapshots into an ordered, deduplicated event stream.
 *
 * @param recent — `recentParts(N)` output (DESC by time)
 */
export function extractNewParts(recent: MessageV2.Part[], seen: Set<string>): MessageV2.Part[] {
  const out: MessageV2.Part[] = []
  for (let i = recent.length - 1; i >= 0; i--) {
    const part = recent[i]
    if (!isInformativePart(part)) continue
    const key = partWaitKey(part)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(part)
  }
  return out
}

/**
 * A part is "informative" if it describes a real activity the user can read.
 * Boundary markers (step-start, step-finish) and tools whose input hasn't
 * streamed in yet are skipped so `progress` reflects what's actually happening
 * instead of "Step done" repeated four times in a row.
 */
function isInformativePart(part: MessageV2.Part): boolean {
  if (part.type === "step-start" || part.type === "step-finish") return false
  if (part.type === "text") return part.text.trim().length > 0
  if (part.type === "tool") {
    const state = part.state
    if (state.status === "pending") {
      const input = ("input" in state ? state.input : undefined) as Record<string, unknown> | undefined
      if (!input || Object.keys(input).length === 0) return false
      // For known tools, require the primary identifying input field to exist.
      const hasField = (k: string) => typeof input[k] === "string" && (input[k] as string).length > 0
      switch (part.tool) {
        case "bash":
          return hasField("command")
        case "read":
        case "write":
        case "edit":
          return hasField("filePath")
        case "glob":
        case "grep":
          return hasField("pattern")
        case "webfetch":
          return hasField("url")
        case "codesearch":
        case "websearch":
          return hasField("query")
        case "skill":
          return hasField("name")
        default:
          return true
      }
    }
  }
  return true
}

export const SessionCommand = cmd({
  command: "session",
  describe: "manage sessions",
  builder: (yargs: Argv) =>
    commandGroup(yargs.command(SessionListCommand).command(SessionDeleteCommand).command(SessionStatusCommand), "agent session"),
  async handler() {},
})

export const SessionDeleteCommand = cmd({
  command: "delete <sessionID>",
  describe: "delete a session",
  builder: (yargs: Argv) => {
    return yargs.positional("sessionID", {
      describe: "session ID to delete",
      type: "string",
      demandOption: true,
    })
  },
  handler: async (args) => {
    await bootstrap(process.cwd(), async () => {
      const sessionID = SessionID.make(args.sessionID)
      try {
        await AppRuntime.runPromise(Session.Service.use((svc) => svc.get(sessionID)))
      } catch (err) {
        const actual = Cause.squash((err as any).cause ?? err)
        if (NotFoundError.isInstance(actual)) {
          UI.error(`Session not found: ${args.sessionID}`)
          process.exit(1)
        }
        throw err
      }
      await AppRuntime.runPromise(Session.Service.use((svc) => svc.remove(sessionID)))
      UI.println(UI.Style.TEXT_SUCCESS_BOLD + `Session ${args.sessionID} deleted` + UI.Style.TEXT_NORMAL)
    })
  },
})

type StatusSnapshot =
  | { kind: "not_found" }
  | {
      kind: "busy"
      type: "busy" | "retry"
      retry?: { attempt: number; message: string; next: number }
      recent: MessageV2.Part[]
    }
  | { kind: "idle"; result: string | null }
  | { kind: "error"; error: { name: string; message: string } }

const BUSY_USER_WINDOW_MS = 30 * 1000

/**
 * Maximum quiet period (no part insert / update for this session) before `--wait`
 * yields back to the caller with `{status: "timeout"}`. This is a soft timeout:
 * the session may still be running in the background. We do NOT try to diagnose
 * whether the producer is dead vs. running a long tool — the caller has more
 * context (it knows what was submitted) and decides whether to re-invoke `--wait`.
 *
 * 5 min is a deliberate trade-off: aggressive enough to surface stuck producers,
 * but typical LLM calls (default 150s cap) and short tool runs finish under it.
 */
const QUIET_TIMEOUT_MS = 5 * 60 * 1000

export function deriveBusyFromLatestMessage(
  lastMsg: MessageV2.WithParts | undefined,
  nowMs: number,
  busyUserWindowMs = BUSY_USER_WINDOW_MS,
) {
  if (!lastMsg) return false
  if (lastMsg.info.role === "assistant") {
    if (lastMsg.info.error) return false
    return !lastMsg.info.finish || lastMsg.info.finish === "tool-calls" || lastMsg.info.finish === "unknown"
  }
  return nowMs - lastMsg.info.time.created < busyUserWindowMs
}

async function statusSnapshot(sessionID: SessionID): Promise<StatusSnapshot> {
  try {
    await AppRuntime.runPromise(Session.Service.use((svc) => svc.get(sessionID)))
  } catch (err) {
    const actual = Cause.squash((err as any).cause ?? err)
    if (NotFoundError.isInstance(actual)) return { kind: "not_found" }
    throw err
  }

  const status = await AppRuntime.runPromise(SessionStatus.Service.use((svc) => svc.get(sessionID)))
  const lastMsg = await AppRuntime.runPromise(Session.Service.use((svc) => svc.latestMessage(sessionID)))

  // Cross-process busy detection: in-memory SessionStatus.Service is per-process,
  // so when polling from a separate CLI invocation it always reads "idle" by default.
  // Derive busy state from data: if the latest message is an assistant in-progress
  // (no finish, no error) OR the latest message is still a user message within an
  // LLM timeout window, treat the session as busy.
  // 30s covers normal LLM first-byte latency. Beyond that, if no assistant message
  // has appeared, the LLM call most likely failed before message creation
  // (e.g. ProviderModelNotFoundError, auth errors). Faster failure detection wins
  // over correctness for slow first-byte cases since the in-memory status would
  // catch those when polled in-process.
  const derivedBusy = deriveBusyFromLatestMessage(lastMsg, Date.now())

  const effectiveStatus =
    status?.type === "busy" || status?.type === "retry"
      ? status
      : derivedBusy
        ? ({ type: "busy" } as const)
        : status

  if (effectiveStatus?.type === "busy" || effectiveStatus?.type === "retry") {
    const recent = await AppRuntime.runPromise(Session.Service.use((svc) => svc.recentParts(sessionID, 50)))
    const out: StatusSnapshot = { kind: "busy", type: effectiveStatus.type, recent }
    if (effectiveStatus.type === "retry") {
      out.retry = {
        attempt: effectiveStatus.attempt,
        message: effectiveStatus.message,
        next: effectiveStatus.next,
      }
    }
    return out
  }

  if (!lastMsg) return { kind: "idle", result: null }

  if (lastMsg.info.role === "assistant") {
    const err = lastMsg.info.error
    if (err) {
      const message =
        ("data" in err && err.data && typeof err.data === "object" && "message" in err.data
          ? String((err.data as { message?: unknown }).message)
          : null) ?? err.name
      return { kind: "error", error: { name: err.name, message } }
    }
    const text = lastMsg.parts
      .filter((p): p is MessageV2.TextPart => p.type === "text")
      .map((p) => p.text.trim())
      .filter((t) => t.length > 0)
      .join("\n")
    return { kind: "idle", result: text || null }
  }

  // Latest message is a user message older than the busy window — LLM never produced
  // an assistant response. This typically indicates a pre-message failure (provider
  // not found, auth error, etc.).
  return {
    kind: "error",
    error: {
      name: "NoAssistantResponse",
      message: "Session ended without an assistant response (likely an LLM call failure)",
    },
  }
}

function emit(line: Record<string, unknown>): void {
  process.stdout.write(JSON.stringify(line) + EOL)
}

function emitSnapshot(sessionID: string, snap: StatusSnapshot): void {
  if (snap.kind === "not_found") {
    emit({ session_id: sessionID, error: "Session not found" })
    return
  }
  if (snap.kind === "busy") {
    const informative = snap.recent.find((p) => isInformativePart(p)) ?? snap.recent[0]
    const out: Record<string, unknown> = { session_id: sessionID, status: snap.type }
    if (informative) out.progress = progressLine(informative)
    if (snap.retry) out.retry = snap.retry
    emit(out)
    return
  }
  if (snap.kind === "idle") {
    emit({ session_id: sessionID, status: "idle", result: snap.result })
    return
  }
  emit({ session_id: sessionID, status: "idle", error: snap.error })
}

interface WaitDeps {
  sleep?: (ms: number) => Promise<void>
  now?: () => number
  snapshot?: (sessionID: SessionID) => Promise<StatusSnapshot>
  /** Pull parts whose `time_updated > sinceUpdatedMs`, ASC by (time_updated, id). */
  partsSince?: (sessionID: SessionID, sinceUpdatedMs: number) => Promise<{ part: MessageV2.Part; timeUpdated: number }[]>
  /** Cross-process change gate. Same value across ticks ⇒ no DB writes happened. */
  dataVersion?: () => number
  emit?: (line: Record<string, unknown>) => void
  /** Random in [0, 1). Injected for deterministic jitter in tests. */
  random?: () => number
}

export interface WaitResult {
  exitCode: 0 | 1 | 124
  emitted: Record<string, unknown>[]
}

const MIN_WAIT_INTERVAL_MS = 150

function jittered(ms: number, random: () => number): number {
  // ±10% jitter to avoid thundering-herd if multiple followers poll the same DB
  return Math.max(50, Math.round(ms * (0.9 + random() * 0.2)))
}

/**
 * Wait-for-idle loop. Each tick:
 *   1. PRAGMA data_version — if unchanged AND no part read pending, skip the SELECT
 *   2. lightweight status read (latestMessage + in-memory status) → derive busy/idle/error
 *   3. partsSince(cursor) — only when data_version changed; emits new parts ASC, dedup'd by [[partWaitKey]]
 *
 * Adaptive interval: hit (new parts) → drop to MIN_WAIT_INTERVAL_MS; miss → 1.5× backoff
 * up to maxIntervalMs, with ±10% jitter. timeoutMs <= 0 disables the timeout.
 */
export async function waitLoop(
  sessionID: SessionID,
  opts: { intervalMs: number; timeoutMs: number },
  deps: WaitDeps = {},
): Promise<WaitResult> {
  const sleep = deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)))
  const now = deps.now ?? (() => Date.now())
  const snapshotFn = deps.snapshot ?? statusSnapshot
  const partsSinceFn =
    deps.partsSince ??
    ((sid, since) => AppRuntime.runPromise(Session.Service.use((svc) => svc.partsSinceUpdated(sid, since))))
  const dataVersionFn = deps.dataVersion ?? (() => Database.dataVersion())
  const random = deps.random ?? Math.random
  const emitted: Record<string, unknown>[] = []
  const userEmit = deps.emit
  const emitFn = (line: Record<string, unknown>) => {
    emitted.push(line)
    if (userEmit) userEmit(line)
    else emit(line)
  }

  const seen = new Set<string>()
  let lastBusyType: "busy" | "retry" | undefined
  let lastRetryAttempt: number | undefined
  let cursor = 0
  let lastDataVersion: number | undefined
  // Wall-clock of the last tick where this session showed real activity (parts
  // inserted/updated). If it stays put for QUIET_TIMEOUT_MS we yield back to the
  // caller with `status: "timeout"` — we don't claim the producer is dead, the
  // caller decides whether to invoke --wait again.
  let lastSessionActivityMs = now()
  // Start at floor; backoff grows it on idle ticks
  let interval = MIN_WAIT_INTERVAL_MS
  const maxInterval = Math.max(MIN_WAIT_INTERVAL_MS, opts.intervalMs)
  const start = now()

  while (true) {
    if (opts.timeoutMs > 0 && now() - start >= opts.timeoutMs) {
      emitFn({ session_id: sessionID, status: "timeout" })
      return { exitCode: 124, emitted }
    }

    // Quiet-timeout: parts cursor hasn't advanced for too long. Surface as a soft
    // signal — caller decides whether the session is actually stuck or just slow.
    const quietMs = now() - lastSessionActivityMs
    if (quietMs >= QUIET_TIMEOUT_MS) {
      emitFn({
        session_id: sessionID,
        status: "timeout",
        quiet_for_seconds: Math.floor(quietMs / 1000),
      })
      return { exitCode: 124, emitted }
    }

    // Cheap pre-flight: if no commit happened on the SQLite database since last tick,
    // skip both the status snapshot and the parts query.
    const dv = dataVersionFn()
    if (lastDataVersion !== undefined && dv === lastDataVersion) {
      interval = Math.min(Math.round(interval * 1.5), maxInterval)
      await sleep(jittered(interval, random))
      continue
    }

    const snap = await snapshotFn(sessionID)

    if (snap.kind === "not_found") {
      emitFn({ session_id: sessionID, error: "Session not found" })
      return { exitCode: 1, emitted }
    }

    if (snap.kind === "error") {
      emitFn({ session_id: sessionID, status: "idle", error: snap.error })
      return { exitCode: 1, emitted }
    }

    if (snap.kind === "idle") {
      emitFn({ session_id: sessionID, status: "idle", result: snap.result })
      return { exitCode: 0, emitted }
    }

    // busy / retry — emit retry-state changes, then any new parts in chronological order
    const retryAttempt = snap.retry?.attempt
    if (snap.type !== lastBusyType || retryAttempt !== lastRetryAttempt) {
      const line: Record<string, unknown> = { session_id: sessionID, status: snap.type }
      if (snap.retry) line.retry = snap.retry
      emitFn(line)
      lastBusyType = snap.type
      lastRetryAttempt = retryAttempt
    }

    const updates = await partsSinceFn(sessionID, cursor)
    let hadNewEvent = false
    for (const { part, timeUpdated } of updates) {
      if (timeUpdated > cursor) cursor = timeUpdated
      if (!isInformativePart(part)) continue
      const key = partWaitKey(part)
      if (seen.has(key)) continue
      seen.add(key)
      hadNewEvent = true
      const line: Record<string, unknown> = {
        session_id: sessionID,
        status: snap.type,
        part_id: part.id,
        part_type: part.type,
        progress: progressLine(part),
      }
      if (part.type === "text") line.text_preview = part.text.trim()
      if (part.type === "tool") {
        line.tool = part.tool
        line.tool_status = part.state.status
      }
      emitFn(line)
    }
    if (updates.length > 0) lastSessionActivityMs = now()

    lastDataVersion = dv
    interval = hadNewEvent ? MIN_WAIT_INTERVAL_MS : Math.min(Math.round(interval * 1.5), maxInterval)
    await sleep(jittered(interval, random))
  }
}

export const SessionStatusCommand = cmd({
  command: "status <sessionID>",
  describe: "get session status — busy/retry returns progress, idle returns result, on failure returns error",
  builder: (yargs: Argv) => {
    return yargs
      .positional("sessionID", {
        describe: "session ID to check",
        type: "string",
        demandOption: true,
      })
      .option("wait", {
        type: "boolean",
        default: false,
        describe: "block until the session is idle, streaming deduplicated progress events as NDJSON; returns timeout after long periods with no new progress",
      })
      .example("cz-cli agent session status <id>", "One-shot snapshot")
      .example("cz-cli agent session status <id> --wait", "Block, stream NDJSON progress, exit on idle or timeout")
  },
  handler: async (args) => {
    await bootstrap(process.cwd(), async () => {
      const sessionID = SessionID.make(args.sessionID)

      if (args.wait) {
        // Hardcoded: adaptive backoff caps at 2s; no timeout (use shell `timeout` if needed,
        // matching `gh run watch` philosophy). Internals stay configurable via waitLoop opts
        // for testability — see test/cli/cmd/session-status-wait.test.ts.
        const result = await waitLoop(sessionID, { intervalMs: 2000, timeoutMs: 0 })
        process.exit(result.exitCode)
      }

      const snap = await statusSnapshot(sessionID)
      emitSnapshot(args.sessionID, snap)
      if (snap.kind === "not_found") process.exit(1)
    })
  },
})

export const SessionListCommand = cmd({
  command: "list",
  describe: "list sessions",
  builder: (yargs: Argv) => {
    return yargs
      .option("max-count", {
        alias: "n",
        describe: "limit to N most recent sessions",
        type: "number",
      })
      .option("format", {
        describe: "output format",
        type: "string",
        choices: ["table", "json"],
        default: "table",
      })
      .option("all", {
        alias: "a",
        describe: "list sessions from all directories",
        type: "boolean",
        default: false,
      })
  },
  handler: async (args) => {
    await bootstrap(process.cwd(), async () => {
      const sessions = args.all
        ? [...Session.listGlobal({ roots: true, limit: args.maxCount })]
        : [...Session.list({ roots: true, limit: args.maxCount })]

      if (sessions.length === 0) {
        return
      }

      let output: string
      if (args.format === "json") {
        output = formatSessionJSON(sessions)
      } else {
        output = formatSessionTable(sessions)
      }

      const shouldPaginate = process.stdout.isTTY && !args.maxCount && args.format === "table"

      if (shouldPaginate) {
        const proc = Process.spawn(pagerCmd(), {
          stdin: "pipe",
          stdout: "inherit",
          stderr: "inherit",
        })

        if (!proc.stdin) {
          console.log(output)
          return
        }

        proc.stdin.write(output)
        proc.stdin.end()
        await proc.exited
      } else {
        console.log(output)
      }
    })
  },
})

function formatSessionTable(sessions: Session.Info[]): string {
  const lines: string[] = []

  const maxIdWidth = Math.max(20, ...sessions.map((s) => s.id.length))
  const maxTitleWidth = Math.max(25, ...sessions.map((s) => s.title.length))

  const header = `Session ID${" ".repeat(maxIdWidth - 10)}  Title${" ".repeat(maxTitleWidth - 5)}  Updated`
  lines.push(header)
  lines.push("─".repeat(header.length))
  for (const session of sessions) {
    const truncatedTitle = Locale.truncate(session.title, maxTitleWidth)
    const timeStr = Locale.todayTimeOrDateTime(session.time.updated)
    const line = `${session.id.padEnd(maxIdWidth)}  ${truncatedTitle.padEnd(maxTitleWidth)}  ${timeStr}`
    lines.push(line)
  }

  return lines.join(EOL)
}

function formatSessionJSON(sessions: Session.Info[]): string {
  const jsonData = sessions.map((session) => ({
    id: session.id,
    title: session.title,
    updated: session.time.updated,
    created: session.time.created,
    projectId: session.projectID,
    directory: session.directory,
  }))
  return JSON.stringify(jsonData, null, 2)
}
