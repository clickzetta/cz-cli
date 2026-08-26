import { context, SpanKind, trace, SpanStatusCode, type Span } from "@opentelemetry/api"
import { SeverityNumber, type Logger } from "@opentelemetry/api-logs"
import {
  clearCurrentLlmSpan,
  getSessionOtelContext,
  setCurrentLlmSpan,
  clearSessionSpanContexts,
  setCurrentSessionSpanContext,
  setRawRequestCaptureEnabled,
  setSessionSpanContext,
} from "./context"
import * as m from "./metrics"
import type { Event } from "@opencode-ai/sdk"
import { isSensitiveKey, isSensitiveValue } from "../../telemetry.js"
import { redactSql } from "../../logger.js"

const tracer = trace.getTracer("opencode")

/**
 * Cap for the two attributes that carry tool content. A whole-file `read` output or a
 * long `bash` transcript otherwise becomes one attribute, and collectors commonly drop or
 * truncate a span past their attribute-size limit — losing the span, not just the text.
 * Upstream truncates tool output for the model in the same spirit (message-v2.ts:51).
 */
const CONTENT_MAX_CHARS = 8_000

/**
 * Prompt and completion content gets the limit the pre-rebaseline handler used, 32KB, not
 * the tool cap above: an input-messages attribute is a whole conversation and 8k would
 * truncate almost all of it. Collectors reject well before this, hence the cap at all.
 */
const PROMPT_MAX_CHARS = 32 * 1024

/**
 * Tool and prompt content goes through the redactor this repo already has —
 * `isSensitiveKey` and `redactSql`, the predicates the CLI's argv telemetry uses, which
 * exist because plaintext credentials reached `_positional` once already.
 *
 * `isSensitiveValue` alone was not enough: it only fires on a bare `KEY=VALUE` token, so a
 * credential written the way config files and flags actually write them survived —
 * `pat = "…"` in profiles.toml (spaces, and double quotes that `redactSql` does not touch),
 * `--password hunter2`, `token: abc` in YAML. All three are assignments, so the shape is
 * what gets matched, and only the value is replaced so the key stays readable.
 *
 * It is a redactor, not a secret scanner. A credential with no assignment shape and no PEM
 * envelope — a bare positional, `-H "Authorization: Bearer …"` (whose key is `Authorization`
 * so it IS caught, but `Bearer x` alone is not) — still gets through. Content recording is
 * off entirely under OPENCODE_OTEL_RECORD_CONTENT=0.
 */
const PEM_BLOCK = /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g
//: `key = "value"` / `key: value` / `KEY=value`, as config files and env files write them.
const ASSIGNMENT = /([A-Za-z_][\w.-]{1,40})(\s*[:=]\s*)("[^"]*"|'[^']*'|`[^`]*`|[^\s,;)}\]]+)/g
//: `--password hunter2` / `-p hunter2`, the whitespace-separated flag spelling.
const FLAG_VALUE = /(--?[A-Za-z][\w-]{0,40})(\s+)("[^"]*"|'[^']*'|[^\s]+)/g

function redactText(value: string): string {
  let out = value.replace(PEM_BLOCK, "<redacted:private-key>")
  out = out.replace(ASSIGNMENT, (whole, key: string, sep: string) =>
    isSensitiveKey(key) ? `${key}${sep}<redacted>` : whole,
  )
  out = out.replace(FLAG_VALUE, (whole, flag: string, sep: string) =>
    isSensitiveKey(flag.replace(/^-+/, "")) ? `${flag}${sep}<redacted>` : whole,
  )
  return redactSql(out)
}

/**
 * Depth- and cycle-guarded: this walk runs before `safeStringify`, so a self-referential
 * payload would overflow the stack where `safeStringify`'s own catch could not absorb it.
 */
function redactDeep(value: unknown, limit: number, depth = 0, seen = new WeakSet<object>()): unknown {
  // Truncated at the leaf, before redaction: a `write` body or a `read` result is where the
  // large payloads are, and redacting text that the cap is about to discard is pure work on
  // the event-bus path.
  if (typeof value === "string") return redactText(capTo(value, limit))
  if (!value || typeof value !== "object") return value
  if (depth >= 12) return "<redacted:too-deep>"
  if (seen.has(value)) return "<redacted:cycle>"
  seen.add(value)
  if (Array.isArray(value)) return value.map((item) => redactDeep(item, limit, depth + 1, seen))
  const out: Record<string, unknown> = {}
  for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
    out[key] = isSensitiveKey(key) ? "<redacted>" : redactDeep(inner, limit, depth + 1, seen)
  }
  return out
}

function capTo(text: string, limit: number): string {
  if (text.length <= limit) return text
  return `${text.slice(0, limit)}\n[truncated ${text.length - limit} chars]`
}

function cap(text: string): string {
  return capTo(text, CONTENT_MAX_CHARS)
}

/** Prompt/completion content: redacted like tool content, capped at the historical limit. */
function promptAttr(value: unknown): string {
  return capTo(safeStringify(redactDeep(value, PROMPT_MAX_CHARS)), PROMPT_MAX_CHARS)
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

// Parse OPENCODE_DISABLE_TRACES once. Value is comma-separated categories,
// e.g. "tool,llm". Logs and metrics are never affected.
const disabledTraceCategories: ReadonlySet<string> = new Set(
  (process.env.OPENCODE_DISABLE_TRACES ?? "").split(",").map((s) => s.trim()).filter(Boolean),
)

function tracingEnabled(category: string): boolean {
  return !disabledTraceCategories.has(category)
}

let _logger: Logger | undefined
let _recordContent = true

interface Model {
  modelID: string
  providerID: string
  agent: string
}

//: Turn state, per session. `serve` drives several sessions at once and a subagent
//: nests a second one inside the first, so a single module-level turn span would
//: attribute one session's steps to another and close on whichever went idle first.
const turnSpans = new Map<string, Span>()
const turnEnriched = new Set<string>()
//: Sessions with a turn actually running, driven by `session.status`. Deliberately not
//: `turnSpans`: it must survive OPENCODE_DISABLE_TRACES=prompt, because it also gates
//: metrics and logs. Part events are replayable — `Session.fork` republishes every
//: historical part through `updatePart` (session.ts:716-727) and `compaction.prune`
//: republishes settled tool parts (compaction.ts:282-286) — and both happen outside any
//: busy window, so without this a fork re-records the whole history's tokens and spans.
const liveTurns = new Set<string>()
//: The last error published in the current turn, if it has not been superseded. See
//: turnFailed.
const pendingErrors = new Map<string, string>()
//: The session-span slot in ./context is one global slot by design — SQL and
//: raw-request capture attach to "the" current session — so remember who filled it
//: and only that session may clear it.
let contextOwner: string | undefined

const stepSpans = new Map<string, { span: Span; sessionID: string }>()
const toolSpans = new Map<string, { span: Span; sessionID: string }>()
//: Keyed `sessionID|callID`, not by callID alone: a callID is provider-generated and
//: `Session.fork` copies it across sessions, so a bare key can collide between a live call
//: and a replayed one.
//: Tool calls already counted, and the session each belongs to. A call surfaces once
//: per state transition, so without this the metric counts it again on every update
//: whenever tool tracing is off and no span is there to dedupe on. The session is what
//: lets a call that never settles be cleaned up with its turn instead of being held for
//: the life of the process.
const countedTools = new Map<string, string>()
//: Tool calls whose settled state has already been recorded. The runtime republishes
//: settled tool parts — `compaction.prune` stamps `time.compacted` on completed parts and
//: writes them back, and it is forked off the run loop so it can land before idle — and a
//: second settle would double the counter, the duration histogram and the log record.
const settledTools = new Set<string>()
//: Step start times, kept outside `stepSpans` so a measured duration survives
//: OPENCODE_DISABLE_TRACES=llm: this file's contract is that gates never affect metrics
//: or logs, and a step part carries no timings of its own.
const stepStartMs = new Map<string, { sessionID: string; startedMs: number }>()
//: Child -> parent session, from `session.created`. A subagent runs in its own session
//: (task.ts:145 creates it with `parentID`), so without this its whole trajectory becomes
//: a detached trace and the parent turn shows an `execute_tool task` span with nothing
//: under it.
const sessionParents = new Map<string, string>()
//: Provider/model per session, needed before a turn's first step because a span's
//: name is fixed when it starts. Both sources are real: an assistant `message.updated`
//: carries the provider that actually served the message (flat `modelID`/`providerID`,
//: the same fields active-model.ts reads), and `session.next.model.switched` carries a
//: `Model.Ref` on an explicit switch.
const sessionModels = new Map<string, Model>()
//: Prompt content per session, captured from the transform hooks. Both fire per step, just
//: before the LLM call and therefore before the `step-start` part, so the chat span can
//: carry them from the moment it opens — which is what the pre-rebaseline handler did with
//: the `inputMessages`/`systemInstructions` its own upstream patch put on the step event.
const sessionInput = new Map<string, string>()
const sessionSystem = new Map<string, string>()
//: Assistant output accumulated per message, to rebuild `gen_ai.output.messages` at
//: step-finish. The old event carried `responseText`/`toolCalls`; on the message surface the
//: same content arrives as text and tool parts. Keyed by part id inside the message so a
//: streaming part updates in place and insertion order stays the order they were produced.
const messageOutput = new Map<string, Map<string, Record<string, unknown>>>()
const sessionStartMs = new Map<string, number>()

/** Remember a `Model.Ref{id}` — what `session.next.model.switched` carries. */
function rememberModelRef(sessionID: string, ref: any) {
  if (!sessionID || !ref?.id) return
  rememberModel(sessionID, { modelID: ref.id, providerID: ref.providerID ?? "" })
}

function rememberModel(sessionID: string, model: { modelID?: string; providerID?: string; agent?: string }) {
  if (!sessionID || !model.modelID) return
  sessionModels.set(sessionID, {
    modelID: model.modelID,
    providerID: model.providerID ?? "",
    agent: model.agent ?? sessionModels.get(sessionID)?.agent ?? "",
  })
}

export function initHandlers(logger: Logger, recordContent?: boolean) {
  _logger = logger
  _recordContent = recordContent ?? true
  setRawRequestCaptureEnabled(_recordContent)
}

function sessionAttributes(
  sessionID?: string,
  attrs?: Record<string, string | number | boolean>,
) {
  return {
    ...(sessionID ? { "opencode.session.id": sessionID, "langfuse.session.id": sessionID } : {}),
    ...attrs,
  }
}

function emitLog(input: {
  severityNumber: SeverityNumber
  severityText: string
  body: string
  eventName: string
  sessionID?: string
  attributes?: Record<string, string | number | boolean>
}) {
  _logger?.emit({
    severityNumber: input.severityNumber,
    severityText: input.severityText,
    body: input.body,
    attributes: {
      "event.name": input.eventName,
      ...input.attributes,
    },
    context: turnContext(input.sessionID),
  })
}

/**
 * The turn span. It used to open on `session.turn.started`, an event no runtime
 * publishes any more.
 *
 * It opens on `session.status` busy — the first signal of a turn on the v1 path
 * (prompt.ts:1192) — rather than on the first step, so that a failure published inside the
 * run loop but before any step (prompt.ts:322) still gets a span and an `error` outcome.
 * busy is re-published mid-run (processor.ts:973), so the guard below is what makes it
 * idempotent.
 *
 * Failures published even earlier — agent and model resolution at prompt.ts:625, :663 and
 * the command paths at :1469, :1530 — happen before busy and throw without an idle, so
 * they get no turn span at all. That is deliberate: there is no event pair to bound a span
 * with, and inventing one from an error alone would report a turn that never started.
 */
function openTurnSpan(sessionID: string) {
  if (!sessionID || turnSpans.has(sessionID) || !tracingEnabled("prompt")) return
  const parentID = sessionParents.get(sessionID)
  const parentTurn = parentID ? turnSpans.get(parentID) : undefined
  const span = tracer.startSpan(
    "prompt",
    {
      attributes: {
        "opencode.session.id": sessionID,
        ...(parentID ? { "opencode.session.parent.id": parentID } : {}),
      },
    },
    parentTurn ? trace.setSpan(context.active(), parentTurn) : undefined,
  )
  turnSpans.set(sessionID, span)
  turnEnriched.delete(sessionID)
  setSessionSpanContext(sessionID, span.spanContext())
  if (!contextOwner) {
    // This slot goes live for the first time with this PR — its only previous writer was
    // one of the dead branches. It is a single process-wide slot in ./context, read by
    // `getCurrentSessionTraceparent` for outbound gateway headers and by
    // CLICKZETTA_TRACEPARENT for spawned shells, neither of which knows a sessionID at
    // its call site. Narrowing those needs session plumbing through outbound-headers.ts
    // and the shell hook, so it stays first-writer-wins for now: under `serve` a second
    // concurrent session's gateway calls carry the first session's traceparent. Log
    // records do NOT go through it — emitLog resolves the session's own turn.
    contextOwner = sessionID
    setCurrentSessionSpanContext(span.spanContext())
  }
}

/** Model and message are only known once the turn reaches its first step. */
function enrichTurnSpan(sessionID: string, messageID: string, model?: Model) {
  const span = turnSpans.get(sessionID)
  if (!span || turnEnriched.has(sessionID)) return
  // Latched on the model being known, not on having been called: latching early would
  // leave the turn permanently anonymous when the first step runs before the model is,
  // which is the same silent failure as the `chat unknown` regression.
  if (model?.modelID) turnEnriched.add(sessionID)
  span.setAttributes({
    ...(messageID ? { "opencode.message.id": messageID } : {}),
    ...(model?.modelID ? { "gen_ai.request.model": model.modelID } : {}),
    ...(model?.agent ? { "opencode.agent.name": model.agent } : {}),
  })
}

/**
 * Whether a turn failed, for `opencode.turn.outcome`.
 *
 * `session.error` alone is not evidence of failure: a `ContextOverflowError` is published
 * and then recovered from by compacting within the same turn (processor.ts:932-936), so
 * counting every error event as terminal reports successful turns as failures.
 *
 * The assistant message is the runtime's own verdict, but it cannot be used: on both
 * terminal paths `halt` publishes the error and sets the session idle
 * (processor.ts:926-931, :952-957), and the message carrying `error` is only published
 * afterwards by the `ensuring(cleanup())` finalizer (processor.ts:913, :1027) — after the
 * turn has already closed.
 *
 * What is observable before idle is whether the turn *continued*. A recovered error is
 * followed by another LLM round trip; a terminal one is followed by idle. So an error is
 * recorded as pending and cleared when the next step starts.
 */
function recordTurnError(sessionID: string, message: string) {
  if (!sessionID) return
  // Some failures are published before `status.set(busy)` and throw without an idle
  // (prompt.ts:470, :625, :663, :1469, :1530), so there is no turn to attach them to and
  // none coming. Holding one would hand its message to whichever later turn happens to
  // close without a step of its own.
  if (!liveTurns.has(sessionID)) return
  pendingErrors.set(sessionID, message)
}

function clearTurnError(sessionID: string) {
  pendingErrors.delete(sessionID)
}

/**
 * Parent for a session's spans and log records: its own turn span, or nothing.
 *
 * A named session with no open turn deliberately does NOT fall back to the process-wide
 * slot — that slot belongs to whichever session opened a turn first, so falling back is
 * how one session's telemetry ends up under another's trace. Only a caller with no session
 * at all consults it.
 */
function turnContext(sessionID?: string) {
  const turn = sessionID ? turnSpans.get(sessionID) : undefined
  if (turn) return trace.setSpan(context.active(), turn)
  return sessionID ? context.active() : getSessionOtelContext()
}

/** Give up on tool spans a previous turn left open without ever settling. */
function discardUnsettledTools(sessionID: string) {
  for (const [key, entry] of toolSpans) {
    if (entry.sessionID !== sessionID) continue
    // An unset status reads as OK in every backend, which would make a call that never
    // settled indistinguishable from one that completed with empty output.
    entry.span.setStatus({ code: SpanStatusCode.ERROR, message: "tool call never settled" })
    entry.span.end()
    toolSpans.delete(key)
  }
  for (const [key, owner] of countedTools) {
    if (owner !== sessionID) continue
    countedTools.delete(key)
    settledTools.delete(key)
  }
}

/**
 * Close a session's turn. Step spans still open belong to a turn that was aborted rather
 * than settled, so they close with it — a step cannot settle later. Tool spans can: on
 * abort, `cleanup()` republishes every running call as `Tool execution aborted` only after
 * `halt` has set the session idle (processor.ts:885-910, and `ensuring` being outermost at
 * :1026-1027), so closing them here would report an interrupted tool as a successful one.
 */
function endTurn(sessionID: string) {
  if (!sessionID) return
  liveTurns.delete(sessionID)
  for (const [key, entry] of stepSpans) {
    if (entry.sessionID !== sessionID) continue
    entry.span.end()
    clearCurrentLlmSpan(entry.span)
    stepSpans.delete(key)
  }
  // Iterated separately from stepSpans on purpose: with OPENCODE_DISABLE_TRACES=llm there
  // are no step spans, so a loop keyed off them would never reclaim these.
  for (const [key, started] of stepStartMs) if (started.sessionID === sessionID) stepStartMs.delete(key)
  const failure = pendingErrors.get(sessionID)
  const span = turnSpans.get(sessionID)
  if (span) {
    if (failure) span.setStatus({ code: SpanStatusCode.ERROR, message: failure })
    span.setAttribute("opencode.turn.outcome", failure ? "error" : "completed")
    span.end()
    turnSpans.delete(sessionID)
  }
  pendingErrors.delete(sessionID)
  turnEnriched.delete(sessionID)
  setSessionSpanContext(sessionID, undefined)
  if (contextOwner !== sessionID) return
  // Cleared rather than handed to another open turn. The slot is read by emitLog, by
  // CLICKZETTA_TRACEPARENT for spawned shells and by raw-request capture, and under
  // `serve` the next open turn is an unrelated session — attributing to it would turn a
  // missing parent into a wrong one, which is far harder to notice downstream.
  contextOwner = undefined
  setCurrentSessionSpanContext(undefined)
}

/** One v1 message part, in the shape the pre-rebaseline serializer used. */
function serializePart(part: Record<string, any>): Record<string, unknown> | undefined {
  switch (part?.type) {
    case "text":
      return { type: "text", content: part.text ?? "" }
    case "reasoning":
      return { type: "reasoning", content: part.text ?? "" }
    case "tool":
      return {
        type: "tool_call",
        id: part.callID,
        name: part.tool,
        ...(part.state?.input != null ? { arguments: part.state.input } : {}),
        ...(part.state?.status === "completed" ? { result: part.state.output } : {}),
        ...(part.state?.status === "error" ? { error: part.state.error } : {}),
      }
    case "file":
      return { type: "file", mediaType: part.mime, ...(part.filename ? { filename: part.filename } : {}) }
    case "step-start":
    case "step-finish":
    case "snapshot":
    case "patch":
      return undefined
    default:
      return { type: String(part?.type ?? "unknown") }
  }
}

/**
 * `experimental.chat.messages.transform` (prompt.ts:1357) — the conversation as it is about
 * to be sent. The hook carries no sessionID, so it comes off the messages themselves.
 */
export function recordInputMessages(messages: Array<{ info?: Record<string, any>; parts?: Record<string, any>[] }>) {
  if (!_recordContent || !messages?.length) return
  const sessionID = messages.find((m) => m.info?.sessionID)?.info?.sessionID
  if (!sessionID) return
  const serialized = messages.map((m) => ({
    role: m.info?.role ?? "unknown",
    parts: (m.parts ?? []).map(serializePart).filter(Boolean),
  }))
  sessionInput.set(sessionID, promptAttr(serialized))
}

/** `experimental.chat.system.transform` (llm/request.ts:70), which does pass a sessionID. */
export function recordSystemInstructions(sessionID: string | undefined, system: string[]) {
  if (!_recordContent || !sessionID || !system?.length) return
  const parts = system.filter(Boolean).map((content) => ({ type: "text", content }))
  if (!parts.length) return
  sessionSystem.set(sessionID, promptAttr(parts))
}

/**
 * The published hook type is a discriminated union (`Event` in @opencode-ai/sdk). Annotating
 * this parameter as `{ type: string }` is what let `case "v2.step.started"` compile for
 * months, so the union's own `type` is used instead and a subscription to a name outside it
 * is now a type error rather than dead code. `properties` stays loose: narrowing it per case
 * would not have caught that bug, and this file reads it defensively anyway.
 *
 * `session.next.model.switched` is admitted explicitly because it is the one event this
 * handler needs that sits OUTSIDE the v1 union — it belongs to the durable bus, and the
 * runtime delivers it to a v1-path plugin anyway (published from prompt.ts:712). Naming it
 * here is the point: it is the single documented exception, and adding another means writing
 * it down next to this comment.
 */
type SubscribedEvent = {
  type: Event["type"] | "session.next.model.switched"
  properties: Record<string, any>
}

export function handleEvent(event: SubscribedEvent) {
  try {
    const p = event.properties
    switch (event.type) {
      case "session.created":
        m.sessionCounter.add(1)
        if (p.sessionID) sessionStartMs.set(p.sessionID, Date.now())
        if (p.sessionID && p.info?.parentID) sessionParents.set(p.sessionID, p.info.parentID)
        emitLog({
          severityNumber: SeverityNumber.INFO,
          severityText: "INFO",
          body: "session.created",
          eventName: "opencode.session.created",
          sessionID: p.sessionID ?? "",
          attributes: sessionAttributes(p.sessionID),
        })
        break

      case "session.deleted": {
        endTurn(p.sessionID ?? "")
        const startMs = p.sessionID ? sessionStartMs.get(p.sessionID) : undefined
        const durationMs = startMs ? Date.now() - startMs : undefined
        if (p.sessionID) {
          sessionStartMs.delete(p.sessionID)
          // The model must outlive individual turns, so this is the only place it can go.
          sessionModels.delete(p.sessionID)
          sessionParents.delete(p.sessionID)
          sessionInput.delete(p.sessionID)
          sessionSystem.delete(p.sessionID)
          discardUnsettledTools(p.sessionID)
        }
        emitLog({
          severityNumber: SeverityNumber.INFO,
          severityText: "INFO",
          body: "session.deleted",
          eventName: "opencode.session.deleted",
          sessionID: p.sessionID ?? "",
          attributes: sessionAttributes(p.sessionID, {
            ...(durationMs != null ? { "opencode.session.duration_ms": durationMs } : {}),
          }),
        })
        break
      }

      case "session.status": {
        const statusType = p.status?.type
        if (statusType === "busy") {
          if (p.sessionID) liveTurns.add(p.sessionID)
          // Outside openTurnSpan on purpose: that function returns early under
          // OPENCODE_DISABLE_TRACES=prompt, and this is the only reclamation path for the
          // tool maps outside `session.deleted`. Tool spans are deliberately left open
          // across idle (see the gate in message.part.updated) so a late settlement can
          // land; a new turn is where the ones that never settled are given up on.
          discardUnsettledTools(p.sessionID ?? "")
          openTurnSpan(p.sessionID ?? "")
          emitLog({
            severityNumber: SeverityNumber.INFO,
            severityText: "INFO",
            body: "session.prompt.started",
            eventName: "opencode.session.prompt.started",
            sessionID: p.sessionID ?? "",
            attributes: sessionAttributes(p.sessionID, {
              "gen_ai.conversation.id": p.sessionID ?? "",
              "gen_ai.operation.name": "chat",
            }),
          })
          break
        }
        if (statusType === "idle") endTurn(p.sessionID ?? "")
        break
      }

      case "session.error": {
        const name = p.error?.name ?? "UnknownError"
        const message =
          (p.error?.data && typeof p.error.data === "object" && "message" in p.error.data
            ? String((p.error.data as Record<string, unknown>).message ?? "")
            : "") || name
        recordTurnError(p.sessionID ?? "", message)
        emitLog({
          severityNumber: SeverityNumber.ERROR,
          severityText: "ERROR",
          body: "session.error",
          eventName: "opencode.session.error",
          sessionID: p.sessionID ?? "",
          attributes: sessionAttributes(p.sessionID, {
            "error.name": name,
            "error.message": message,
          }),
        })
        break
      }

      case "session.idle":
        endTurn(p.sessionID ?? "")
        emitLog({
          severityNumber: SeverityNumber.INFO,
          severityText: "INFO",
          body: "session.idle",
          eventName: "opencode.session.idle",
          sessionID: p.sessionID ?? "",
          attributes: sessionAttributes(p.sessionID),
        })
        break

      /**
       * Model identity for the turn, from the two events that carry it. A span's name is
       * fixed when it starts, so this has to be known before the turn's first step.
       *
       * `message.updated` is the authoritative one: an assistant message names the
       * provider that actually served it, and it arrives on the same v1 surface as the
       * parts below. Its fields are FLAT (`modelID`/`providerID`/`agent`, see
       * SessionV1.Assistant) — reading a nested `model` object off it is what made an
       * earlier revision of this handler name every span `chat unknown`.
       * active-model.ts reads the same two events for the same reason.
       */
      case "session.next.model.switched":
        rememberModelRef(p.sessionID ?? "", p.model)
        break

      case "message.updated": {
        const info = p.info ?? {}
        if (info.role !== "assistant") break
        const sessionID = p.sessionID ?? info.sessionID ?? ""
        rememberModel(sessionID, {
          modelID: info.modelID,
          providerID: info.providerID,
          agent: info.agent,
        })
        break
      }

      /**
       * Where the trajectory actually comes from.
       *
       * The handler used to build spans from `v2.step.*` / `v2.tool.*`, names nothing
       * publishes: the durable bus calls them `session.next.*` (packages/schema
       * session-event.ts). Renaming the subscriptions would not have been enough on its
       * own, because those events come from the core session runner while cz runs the v1
       * session (packages/opencode/src/session/session.ts), whose plugin surface is the
       * message one — `message.part.updated`, `message.part.delta`, `message.updated`,
       * `session.status`, `session.created`, `session.idle`. Every span-creating branch
       * had therefore been dead code for as long as the rename, and telemetry carried
       * session lifecycle records with no trajectory under them.
       *
       * There is one route that would deliver them: with OPENCODE_EXPERIMENTAL_EVENT_SYSTEM
       * set, the v1 processor mirrors real `session.next.step.*` / `session.next.tool.*`
       * lifecycle events (processor.ts:129 gates `mirrorAssistant`). Those are lifecycle,
       * not state replication, so they would need none of the replay guards below. It is
       * deliberately not taken: it is an experimental flag that also switches on v2
       * assistant-message mirroring, and telemetry that only works when an upstream
       * experiment is enabled is worse than telemetry built on the surface that is always
       * there. If that flag ever becomes the default, this handler should move to it.
       *
       * Message parts carry what the GenAI spans need, so the span names and attributes
       * below are the ones the old branches would have written:
       *   step-start / step-finish  ->  `chat {model}`, usage + cost on close
       *   tool                      ->  `execute_tool {tool}`, arguments + result
       */
      case "message.part.updated": {
        // (accumulator defined below, after sessionID/messageID are known)
        const part = p.part ?? {}
        const sessionID = p.sessionID ?? part.sessionID ?? ""
        // Parts are replayed outside any turn — see liveTurns. Everything below this line
        // would otherwise re-record a forked session's entire history. The exception is a
        // tool call this session already opened: its settlement legitimately arrives after
        // idle on the abort path, and a call we watched start cannot be a replay.
        const openCall =
          part.type === "tool" && countedTools.get(`${sessionID}|${part.callID ?? part.id ?? ""}`) === sessionID
        if (!liveTurns.has(sessionID) && !openCall) break
        const messageID = part.messageID ?? ""
        const model = sessionModels.get(sessionID)
        const rememberOutput = () => {
          if (!_recordContent || !messageID) return
          const serialized = serializePart(part)
          if (!serialized || !part.id) return
          const acc = messageOutput.get(messageID) ?? new Map<string, Record<string, unknown>>()
          acc.set(part.id, serialized)
          messageOutput.set(messageID, acc)
        }

        if (part.type === "text" || part.type === "reasoning") {
          rememberOutput()
          break
        }

        if (part.type === "step-start") {
          // Both of these sit outside the `llm` gate below: disabling LLM traces must not
          // strip the turn span's model attributes, drop the duration metric, or change
          // what the turn's outcome is.
          enrichTurnSpan(sessionID, messageID, model)
          stepStartMs.set(messageID, { sessionID, startedMs: Date.now() })
          // The turn continued past whatever error was published, so that error was not
          // terminal — see recordTurnError.
          clearTurnError(sessionID)
          if (!tracingEnabled("llm")) break
          // A message holds one step per LLM round trip, written in order, and
          // step-start and step-finish share only the messageID — so that is the key.
          // An open span under the same key belongs to a step that never finished.
          const key = messageID
          const stale = stepSpans.get(key)
          if (stale) {
            stale.span.end()
            clearCurrentLlmSpan(stale.span)
          }
          const modelID = model?.modelID ?? "unknown"
          const span = tracer.startSpan(`chat ${modelID}`, {
            kind: SpanKind.CLIENT,
            attributes: {
              "gen_ai.operation.name": "chat",
              "gen_ai.provider.name": model?.providerID ?? "",
              "gen_ai.request.model": modelID,
              "gen_ai.conversation.id": sessionID,
              "opencode.session.id": sessionID,
              "langfuse.session.id": sessionID,
              ...(model?.agent ? { "gen_ai.agent.name": model.agent } : {}),
              // Restored to parity with the pre-rebaseline handler, which carried these on
              // the step event its own upstream patch published. Same attribute names, so
              // the historical rows and the new ones line up.
              ...(sessionInput.has(sessionID) ? { "gen_ai.input.messages": sessionInput.get(sessionID)! } : {}),
              ...(sessionSystem.has(sessionID)
                ? { "gen_ai.system_instructions": sessionSystem.get(sessionID)! }
                : {}),
            },
          }, turnContext(sessionID))
          stepSpans.set(key, { span, sessionID })
          setCurrentLlmSpan(span)
          break
        }

        if (part.type === "step-finish") {
          const key = messageID
          const entry = stepSpans.get(key)
          const tokens = part.tokens ?? {}
          const usage = {
            "gen_ai.usage.input_tokens": tokens.input ?? 0,
            "gen_ai.usage.output_tokens": tokens.output ?? 0,
            "gen_ai.usage.reasoning.output_tokens": tokens.reasoning ?? 0,
            "gen_ai.usage.cache_read.input_tokens": tokens.cache?.read ?? 0,
            "gen_ai.usage.cache_creation.input_tokens": tokens.cache?.write ?? 0,
          }
          const started = stepStartMs.get(key)
          stepStartMs.delete(key)
          const durationMs = started ? Date.now() - started.startedMs : undefined
          const output = messageOutput.get(key)
          messageOutput.delete(key)
          const outputMessages =
            _recordContent && output?.size
              ? promptAttr([{ role: "assistant", parts: [...output.values()], finish_reason: part.reason ?? "unknown" }])
              : undefined
          if (entry) {
            entry.span.setAttributes({
              "gen_ai.response.model": model?.modelID ?? "",
              "gen_ai.response.finish_reasons": [part.reason ?? "unknown"],
              ...usage,
              ...(outputMessages ? { "gen_ai.output.messages": outputMessages } : {}),
            })
            entry.span.end()
            stepSpans.delete(key)
            clearCurrentLlmSpan(entry.span)
          }
          const modelAttrs = {
            "gen_ai.provider.name": model?.providerID ?? "",
            "gen_ai.request.model": model?.modelID ?? "",
          }
          if (tokens.input) m.tokenUsage.record(tokens.input, { "gen_ai.token.type": "input", ...modelAttrs })
          if (tokens.output) m.tokenUsage.record(tokens.output, { "gen_ai.token.type": "output", ...modelAttrs })
          if (durationMs != null) m.operationDuration.record(durationMs / 1000, { "gen_ai.operation.name": "chat", ...modelAttrs })
          emitLog({
            severityNumber: SeverityNumber.INFO,
            severityText: "INFO",
            body: "llm.step.finished",
            eventName: "opencode.llm.step.finished",
            sessionID: sessionID ?? "",
            attributes: sessionAttributes(sessionID, {
              ...modelAttrs,
              "gen_ai.response.finish_reasons": part.reason ?? "unknown",
              ...usage,
              "opencode.llm.cost": part.cost ?? 0,
              ...(durationMs != null ? { "opencode.llm.duration_ms": durationMs } : {}),
            }),
          })
          break
        }

        if (part.type === "tool") {
          const state = part.state ?? {}
          const status = state.status ?? ""
          const toolName = part.tool ?? "unknown"
          const callID = part.callID ?? part.id ?? ""
          if (!callID) break
          const key = `${sessionID}|${callID}`
          // `compaction.prune` rewrites completed tool parts from turns that already ended
          // (it skips the two most recent, compaction.ts:264) and stamps `time.compacted`
          // on exactly what it rewrites (compaction.ts:284). Those callIDs left the dedupe
          // sets when their turn ended, so the marker is what identifies them; a live
          // settle never carries it.
          if (state.time?.compacted != null) break
          rememberOutput()

          // A call surfaces once per state transition (pending -> running -> settled), so
          // the counter is guarded by callID and not by the span, which is absent when
          // tool tracing is off.
          if (!countedTools.has(key)) {
            countedTools.set(key, sessionID)
            m.toolCallCounter.add(1, { "gen_ai.tool.name": toolName })
          }

          const settled = status === "completed" || status === "error"
          if (!settled) {
            const args =
              _recordContent && state.input != null
                ? cap(safeStringify(redactDeep(state.input, CONTENT_MAX_CHARS)))
                : undefined
            const open = toolSpans.get(key)
            if (open) {
              // The first state a call surfaces in is always `pending`, whose input is an
              // empty object (processor.ts:333). The real arguments arrive with the
              // `running` transition (processor.ts:503-514), so this event refreshes the
              // attribute instead of being dropped — otherwise every span shipped `{}`.
              if (args) open.span.setAttribute("gen_ai.tool.call.arguments", args)
              break
            }
            if (!tracingEnabled("tool")) break
            const span = tracer.startSpan(`execute_tool ${toolName}`, {
              attributes: {
                "gen_ai.operation.name": "execute_tool",
                "gen_ai.tool.name": toolName,
                // Recommended by the convention and previously missing; these tools run
                // in this process, so `function`.
                "gen_ai.tool.type": "function",
                "gen_ai.tool.call.id": callID,
                "opencode.session.id": sessionID,
                ...(args ? { "gen_ai.tool.call.arguments": args } : {}),
              },
            }, turnContext(sessionID))
            toolSpans.set(key, { span, sessionID })
            break
          }

          if (settledTools.has(key)) break
          settledTools.add(key)
          const failed = status === "error"
          // `ToolStateError.error` is a plain string in the v1 schema.
          const message = failed ? String(state.error || "unknown") : ""
          // Settled tool states carry their own start/end, so the duration is the
          // runtime's own rather than one measured around the event.
          const durationMs =
            typeof state.time?.end === "number" && typeof state.time?.start === "number"
              ? state.time.end - state.time.start
              : undefined
          const entry = toolSpans.get(key)
          if (entry) {
            if (failed) {
              entry.span.setStatus({ code: SpanStatusCode.ERROR, message })
              entry.span.setAttribute("error.message", message)
            } else if (_recordContent && state.output) {
              entry.span.setAttribute(
                "gen_ai.tool.call.result",
                cap(redactText(capTo(String(state.output), CONTENT_MAX_CHARS))),
              )
            }
            entry.span.end()
            toolSpans.delete(key)
          }
          if (failed) m.errorCounter.add(1, { source: "tool", "gen_ai.tool.name": toolName })
          if (durationMs != null) m.toolCallDuration.record(durationMs / 1000, { "gen_ai.tool.name": toolName })
          emitLog({
            severityNumber: failed ? SeverityNumber.ERROR : SeverityNumber.INFO,
            severityText: failed ? "ERROR" : "INFO",
            body: failed ? "tool.call.failed" : "tool.call.completed",
            eventName: "opencode.tool.finished",
            sessionID: sessionID ?? "",
            attributes: sessionAttributes(sessionID, {
              "gen_ai.tool.name": toolName,
              "gen_ai.tool.call.id": callID,
              ...(durationMs != null ? { "opencode.tool.duration_ms": durationMs } : {}),
              ...(failed ? { "error.message": message } : {}),
            }),
          })
        }
        break
      }
    }
  } catch {
    // Never let telemetry break a turn — but do not let it fail invisibly either. A silent
    // catch is how the original bug survived; this counter is the runtime signal that the
    // payload shapes this handler reads have drifted again.
    try {
      m.errorCounter.add(1, { source: "otel_handler" })
    } catch {}
  }
}

export function shutdown() {
  for (const sessionID of [...turnSpans.keys()]) endTurn(sessionID)
  clearSessionSpanContexts()
  setCurrentLlmSpan(undefined)
  for (const entry of stepSpans.values()) entry.span.end()
  for (const entry of toolSpans.values()) entry.span.end()
  stepSpans.clear()
  toolSpans.clear()
  countedTools.clear()
  settledTools.clear()
  stepStartMs.clear()
  turnSpans.clear()
  turnEnriched.clear()
  liveTurns.clear()
  pendingErrors.clear()
  sessionModels.clear()
  sessionParents.clear()
  sessionInput.clear()
  sessionSystem.clear()
  messageOutput.clear()
  sessionStartMs.clear()
  contextOwner = undefined
  setCurrentSessionSpanContext(undefined)
}
