import type { Argv } from "yargs"
import { Effect } from "effect"
import { and, asc, desc, eq, gt } from "drizzle-orm"
import { cmd } from "opencode/cli/cmd/cmd"
import { AppRuntime } from "opencode/effect/app-runtime"
import { Session } from "opencode/session/session"
import { SessionStatus } from "opencode/session/status"
import { SessionID } from "opencode/session/schema"
import { NotFoundError } from "opencode/storage/storage"
import { Database } from "@opencode-ai/core/database/database"
import { PartTable } from "@opencode-ai/core/session/sql"
import type { Part, TextPart, WithParts } from "@opencode-ai/core/v1/session"
import { EOL } from "os"
import { progressLine } from "./render"

type StatusSnapshot =
  | { kind: "not_found" }
  | { kind: "pending" }
  | {
      kind: "busy"
      type: "busy" | "retry"
      retry?: { attempt: number; message: string; next: number }
      recent: Part[]
    }
  | { kind: "idle"; result: string | null }
  | { kind: "error"; error: { name: string; message: string } }

const BUSY_USER_WINDOW_MS = 30 * 1000
const QUIET_TIMEOUT_MS = 5 * 60 * 1000
const MIN_WAIT_INTERVAL_MS = 150

export function deriveBusyFromLatestMessage(
  lastMsg: WithParts | undefined,
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

// Mirrors the prompt loop's real terminal condition (opencode prompt.ts:1206-1219):
// an assistant step whose finish is terminal (e.g. "stop") is still NOT done if it
// carries tool parts that have not executed — the loop runs those tools and
// continues. Without this a "stop"+pending-tools step is misreported as idle.
function hasPendingToolParts(msg: WithParts): boolean {
  return msg.parts.some((p) => p.type === "tool" && (p.state.status === "pending" || p.state.status === "running"))
}

// Data readers — all run under AppRuntime (need only Database + EventV2Bridge,
// never InstanceRef). recentParts/partsSinceUpdated hit PartTable directly since
// no Session.Service method exposes `time_updated`.
function rowToPart(row: typeof PartTable.$inferSelect): Part {
  return {
    ...row.data,
    id: row.id,
    sessionID: row.session_id,
    messageID: row.message_id,
  } as Part
}

async function latestMessage(sessionID: SessionID): Promise<WithParts | undefined> {
  const msgs = await AppRuntime.runPromise(Session.Service.use((svc) => svc.messages({ sessionID, limit: 1 })))
  return msgs.at(-1)
}

async function recentParts(sessionID: SessionID, limit: number): Promise<Part[]> {
  return AppRuntime.runPromise(
    Effect.gen(function* () {
      const { db } = yield* Database.Service
      const rows = yield* db
        .select()
        .from(PartTable)
        .where(eq(PartTable.session_id, sessionID))
        .orderBy(desc(PartTable.time_created), desc(PartTable.id))
        .limit(limit)
        .all()
        .pipe(Effect.orDie)
      return rows.map(rowToPart)
    }),
  )
}

async function partsSinceUpdated(
  sessionID: SessionID,
  sinceUpdatedMs: number,
): Promise<{ part: Part; timeUpdated: number }[]> {
  return AppRuntime.runPromise(
    Effect.gen(function* () {
      const { db } = yield* Database.Service
      const rows = yield* db
        .select()
        .from(PartTable)
        .where(and(eq(PartTable.session_id, sessionID), gt(PartTable.time_updated, sinceUpdatedMs)))
        .orderBy(asc(PartTable.time_updated), asc(PartTable.id))
        .all()
        .pipe(Effect.orDie)
      return rows.map((row) => ({ part: rowToPart(row), timeUpdated: row.time_updated }))
    }),
  )
}

async function statusSnapshot(sessionID: SessionID): Promise<StatusSnapshot> {
  // a2 idiom: catch NotFound *inside* the Effect (Cause.squash only applies to
  // an exit.cause, not a rejected-promise's .cause — doing so crashes effect 4.x).
  const found = await AppRuntime.runPromise(
    Effect.gen(function* () {
      yield* Session.Service.use((svc) => svc.get(sessionID))
      return true
    }).pipe(Effect.catchIf(NotFoundError.isInstance, () => Effect.succeed(false))),
  )
  if (!found) return { kind: "not_found" }

  // SessionStatus.Service.get reads InstanceState, which requires an InstanceRef
  // context a standalone CLI invocation (bare AppRuntime) does not provide, and is
  // useless cross-process anyway (per-process in-memory map). Degrade to undefined
  // and let the PERSISTED assistant-row fields be the authoritative signal. Only
  // honored on the rare same-process path (e.g. surfacing "retry").
  const status = await AppRuntime.runPromise(SessionStatus.Service.use((svc) => svc.get(sessionID))).catch(
    () => undefined,
  )
  const lastMsg = await latestMessage(sessionID)

  // Same-process fast path: trust the live in-memory status if we actually have it.
  if (status?.type === "busy" || status?.type === "retry") {
    const recent = await recentParts(sessionID, 50)
    const out: StatusSnapshot = { kind: "busy", type: status.type, recent }
    if (status.type === "retry") {
      out.retry = { attempt: status.attempt, message: status.message, next: status.next }
    }
    return out
  }

  // No assistant row yet ⇒ PENDING (non-terminal). The assistant placeholder is
  // committed BEFORE the LLM stream (opencode prompt.ts:1289-1304), so its absence
  // means the turn hasn't reached streaming: either 0 messages (just after async
  // create, before the user row lands) or a lone user message during slow setup
  // (provider init, auto-compaction, tokenization). We deliberately DO NOT use a
  // wall-clock window here — the old 30s BUSY_USER_WINDOW was both too short (a live
  // >30s start was misreported as a terminal "NoAssistantResponse" error, killing
  // the turn) and irrelevant on the busy side. --wait keeps polling; its quiet
  // timeout bounds a run that never starts. One-shot reports {status:"pending"}.
  if (!lastMsg || lastMsg.info.role !== "assistant") return { kind: "pending" }

  // Assistant row exists → its persisted fields are the authoritative, cross-process
  // state signal (finish/error commit in-transaction, visible to any process).
  const err = lastMsg.info.error
  if (err) {
    const message =
      ("data" in err && err.data && typeof err.data === "object" && "message" in err.data
        ? String((err.data as { message?: unknown }).message)
        : null) ?? err.name
    return { kind: "error", error: { name: err.name, message } }
  }

  // Still working if the step hasn't settled (finish unset/tool-calls/unknown) OR it
  // settled with unexecuted tool parts — the prompt loop runs those and continues
  // (opencode prompt.ts:1206-1219). Without the tool check a "stop"+pending-tools
  // step is misreported as idle mid-turn.
  if (deriveBusyFromLatestMessage(lastMsg, Date.now()) || hasPendingToolParts(lastMsg)) {
    const recent = await recentParts(sessionID, 50)
    return { kind: "busy", type: "busy", recent }
  }

  const text = lastMsg.parts
    .filter((p): p is TextPart => p.type === "text")
    .map((p) => p.text.trim())
    .filter((t) => t.length > 0)
    .join("\n")
  return { kind: "idle", result: text || null }
}

function emit(line: Record<string, unknown>): void {
  process.stdout.write(JSON.stringify(line) + EOL)
}

function emitSnapshot(sessionID: string, snap: StatusSnapshot): void {
  if (snap.kind === "not_found") {
    emit({ session_id: sessionID, error: "Session not found" })
    return
  }
  if (snap.kind === "pending") {
    // Session exists but the assistant turn hasn't reached streaming yet (just
    // submitted / slow setup). Non-terminal: tells a caller to keep polling.
    emit({ session_id: sessionID, status: "pending" })
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

/**
 * Stable dedupe key for `--wait` mode. Each tool emits one event per status
 * transition; non-tool parts emit once.
 */
export function partWaitKey(part: Part): string {
  if (part.type === "tool") return `${part.id}:${part.state.status}`
  if (part.type === "text") return `${part.id}:text:${Math.floor(part.text.trim().length / 120)}`
  return `${part.id}:${part.type}`
}

/**
 * A part is "informative" if it describes a real activity the user can read.
 * Boundary markers and tools whose input hasn't streamed in yet are skipped.
 */
function isInformativePart(part: Part): boolean {
  if (part.type === "step-start" || part.type === "step-finish") return false
  if (part.type === "text") return part.text.trim().length > 0
  if (part.type === "tool") {
    const state = part.state
    if (state.status === "pending") {
      const input = ("input" in state ? state.input : undefined) as Record<string, unknown> | undefined
      if (!input || Object.keys(input).length === 0) return false
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

/**
 * Walk parts oldest→newest, drop non-informative and already-seen ones,
 * mutate `seen` with the keys we emit. Turns a sequence of `recentParts`
 * snapshots (DESC by time) into an ordered, deduplicated event stream.
 */
export function extractNewParts(recent: Part[], seen: Set<string>): Part[] {
  const out: Part[] = []
  for (let i = recent.length - 1; i >= 0; i--) {
    const part = recent[i]
    if (!part || !isInformativePart(part)) continue
    const key = partWaitKey(part)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(part)
  }
  return out
}

interface WaitDeps {
  sleep?: (ms: number) => Promise<void>
  now?: () => number
  snapshot?: (sessionID: SessionID) => Promise<StatusSnapshot>
  partsSince?: (sessionID: SessionID, sinceUpdatedMs: number) => Promise<{ part: Part; timeUpdated: number }[]>
  /** Cross-process change gate. Same value across ticks ⇒ skip the snapshot. */
  dataVersion?: () => number
  emit?: (line: Record<string, unknown>) => void
  random?: () => number
}

export interface WaitResult {
  exitCode: 0 | 1 | 124
  emitted: Record<string, unknown>[]
}

function jittered(ms: number, random: () => number): number {
  return Math.max(50, Math.round(ms * (0.9 + random() * 0.2)))
}

export async function waitLoop(
  sessionID: SessionID,
  opts: { intervalMs: number; timeoutMs: number },
  deps: WaitDeps = {},
): Promise<WaitResult> {
  const sleep = deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)))
  const now = deps.now ?? (() => Date.now())
  const snapshotFn = deps.snapshot ?? statusSnapshot
  const partsSinceFn = deps.partsSince ?? partsSinceUpdated
  // a2 has no Database.dataVersion(); default to a monotonic counter so the
  // skip-optimisation never fires (correct, just one extra snapshot per tick).
  let dvCounter = 0
  const dataVersionFn = deps.dataVersion ?? (() => ++dvCounter)
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
  let pendingEmitted = false
  let lastDataVersion: number | undefined
  let lastSessionActivityMs = now()
  let interval = MIN_WAIT_INTERVAL_MS
  const maxInterval = Math.max(MIN_WAIT_INTERVAL_MS, opts.intervalMs)
  const start = now()
  while (true) {
    if (opts.timeoutMs > 0 && now() - start >= opts.timeoutMs) {
      emitFn({ session_id: sessionID, status: "timeout" })
      return { exitCode: 124, emitted }
    }

    const quietMs = now() - lastSessionActivityMs
    if (quietMs >= QUIET_TIMEOUT_MS) {
      emitFn({ session_id: sessionID, status: "timeout", quiet_for_seconds: Math.floor(quietMs / 1000) })
      return { exitCode: 124, emitted }
    }

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
    if (snap.kind === "pending") {
      // Non-terminal: the turn hasn't reached streaming (just-submitted / slow
      // setup). Keep polling. Emit one "pending" line so a live watcher sees the
      // session was accepted, then back off. Crucially we do NOT touch
      // lastSessionActivityMs, so a run that never actually starts still trips the
      // quiet timeout (exit 124) instead of hanging forever.
      if (!pendingEmitted) {
        emitFn({ session_id: sessionID, status: "pending" })
        pendingEmitted = true
      }
      lastDataVersion = dv
      interval = Math.min(Math.round(interval * 1.5), maxInterval)
      await sleep(jittered(interval, random))
      continue
    }

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
      .option("format", {
        describe: "output format",
        type: "string",
        choices: ["json"],
        default: "json",
      })
      .option("wait", {
        type: "boolean",
        default: false,
        describe:
          "block until the session is idle, streaming deduplicated progress events as NDJSON; returns timeout after long periods with no new progress",
      })
      .example("cz-cli agent session status <id>", "One-shot snapshot")
      .example("cz-cli agent session status <id> --wait", "Block, stream NDJSON progress, exit on idle or timeout")
  },
  handler: async (args) => {
    const sessionID = SessionID.make(args.sessionID as string)

    if (args.wait) {
      // Adaptive backoff caps at 2s; no hard timeout (use shell `timeout` if
      // needed). Internals stay injectable via waitLoop opts for testability.
      const result = await waitLoop(sessionID, { intervalMs: 2000, timeoutMs: 0 })
      process.exitCode = result.exitCode
      return
    }

    const snap = await statusSnapshot(sessionID)
    emitSnapshot(args.sessionID as string, snap)
    if (snap.kind === "not_found") process.exitCode = 1
  },
})
