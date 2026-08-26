import { expect, test, describe, beforeEach } from "bun:test"
import { InMemorySpanExporter, SimpleSpanProcessor, BasicTracerProvider } from "@opentelemetry/sdk-trace-base"
import { trace } from "@opentelemetry/api"

/**
 * Spans built from real event payloads.
 *
 * The contract test next door compares subscribed event NAMES against the schema. It
 * cannot see the other half of the same bug: a branch that subscribes to a live event
 * and then reads a field the payload does not have. That is how `chat unknown` shipped
 * — the handler read `info.model.modelID` while SessionV1.Assistant carries a flat
 * `modelID`. Nothing failed, the span was just anonymous.
 *
 * So these drive the payload shapes from packages/schema/src/session-v1.ts through
 * handleEvent and assert on what came out.
 */
const exporter = new InMemorySpanExporter()
const provider = new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] })
trace.setGlobalTracerProvider(provider)

const { handleEvent, initHandlers, shutdown } = await import("../src/opencode-plugin/otel/handlers")

const SESSION = "ses_test"
const MESSAGE = "msg_test"

/**
 * Log records are captured too. Some duplicate-emission bugs never touch a span — a
 * republished settled tool part has no span left to end, so the only visible damage is a
 * second log record and a second metric sample.
 */
const records: Array<Record<string, any>> = []
const logger = { emit: (record: Record<string, any>) => records.push(record) }

function emitted(eventName: string) {
  return records.filter((r) => r.attributes?.["event.name"] === eventName)
}

function send(type: string, properties: Record<string, any>) {
  handleEvent({ type, properties })
}

/** An assistant message as the v1 session publishes it: model fields are flat. */
function assistantMessage(modelID = "claude-opus-5", providerID = "clickzetta") {
  send("message.updated", {
    sessionID: SESSION,
    info: { role: "assistant", sessionID: SESSION, id: MESSAGE, modelID, providerID, agent: "data_engineer" },
  })
}

/** A turn begins when the session goes busy, before any message or part exists. */
function busy(sessionID = SESSION) {
  send("session.status", { sessionID, status: { type: "busy" } })
}

function part(partial: Record<string, any>) {
  send("message.part.updated", {
    sessionID: SESSION,
    part: { sessionID: SESSION, messageID: MESSAGE, ...partial },
  })
}

function named(name: string) {
  return exporter.getFinishedSpans().filter((s) => s.name === name)
}

beforeEach(() => {
  shutdown()
  exporter.reset()
  records.length = 0
  initHandlers(logger as any, true)
})

describe("spans built from v1 message parts", () => {
  test("a step names the model the assistant message reported", () => {
    busy()
    assistantMessage()
    part({ id: "prt_1", type: "step-start" })
    part({
      id: "prt_2",
      type: "step-finish",
      reason: "stop",
      cost: 0.01,
      tokens: { input: 100, output: 20, reasoning: 0, cache: { read: 5, write: 6 } },
    })
    send("session.idle", { sessionID: SESSION })

    const [chat] = named("chat claude-opus-5")
    expect(chat).toBeDefined()
    expect(chat!.attributes["gen_ai.provider.name"]).toBe("clickzetta")
    expect(chat!.attributes["gen_ai.usage.input_tokens"]).toBe(100)
    expect(chat!.attributes["gen_ai.usage.cache_read.input_tokens"]).toBe(5)
    expect(chat!.attributes["gen_ai.usage.cache_creation.input_tokens"]).toBe(6)
    expect(named("chat unknown")).toHaveLength(0)
  })

  test("an explicit model switch also names the span", () => {
    busy()
    send("session.next.model.switched", {
      sessionID: SESSION,
      model: { id: "claude-sonnet-5", providerID: "clickzetta" },
    })
    part({ id: "prt_1", type: "step-start" })
    send("session.idle", { sessionID: SESSION })
    expect(named("chat claude-sonnet-5")).toHaveLength(1)
  })

  test("a tool call becomes one span with arguments, result and the runtime's duration", () => {
    busy()
    assistantMessage()
    part({ id: "prt_1", type: "step-start" })
    // The runtime always publishes `pending` with an empty input first, and the real
    // arguments only with the `running` transition.
    part({
      id: "prt_2",
      type: "tool",
      callID: "call_1",
      tool: "bash",
      state: { status: "pending", input: {}, raw: "" },
    })
    part({
      id: "prt_2",
      type: "tool",
      callID: "call_1",
      tool: "bash",
      state: { status: "running", input: { command: "ls" }, time: { start: 1000 } },
    })
    part({
      id: "prt_2",
      type: "tool",
      callID: "call_1",
      tool: "bash",
      state: {
        status: "completed",
        input: { command: "ls" },
        output: "a.ts",
        title: "ls",
        metadata: {},
        time: { start: 1000, end: 3500 },
      },
    })
    send("session.idle", { sessionID: SESSION })

    const [tool] = named("execute_tool bash")
    expect(tool).toBeDefined()
    expect(tool!.attributes["gen_ai.tool.call.arguments"]).toBe(JSON.stringify({ command: "ls" }))
    expect(tool!.attributes["gen_ai.tool.call.result"]).toBe("a.ts")
    expect(tool!.attributes["gen_ai.tool.call.id"]).toBe("call_1")
  })

  test("a failed tool is recorded on the tool span without failing the turn", () => {
    busy()
    assistantMessage()
    part({ id: "prt_1", type: "step-start" })
    part({
      id: "prt_2",
      type: "tool",
      callID: "call_1",
      tool: "bash",
      state: { status: "pending", input: {}, raw: "" },
    })
    part({
      id: "prt_2",
      type: "tool",
      callID: "call_1",
      tool: "bash",
      state: { status: "error", input: {}, error: "exit 1", time: { start: 1, end: 2 } },
    })
    send("session.idle", { sessionID: SESSION })

    const [tool] = named("execute_tool bash")
    expect(tool!.attributes["error.message"]).toBe("exit 1")
    // The agent usually recovers from a tool error; the turn's own verdict comes from
    // the assistant message, so a recovered turn must not be reported as failed.
    expect(named("prompt")[0]!.attributes["opencode.turn.outcome"]).toBe("completed")
  })

  test("a session error is not reported as a completed turn", () => {
    busy()
    assistantMessage()
    part({ id: "prt_1", type: "step-start" })
    send("session.error", { sessionID: SESSION, error: { name: "APIError", data: { message: "boom" } } })
    send("session.idle", { sessionID: SESSION })
    expect(named("prompt")[0]!.attributes["opencode.turn.outcome"]).toBe("error")
  })

  test("a turn that dies before its first step still produces a span", () => {
    // prompt.ts publishes session.error from model resolution and permission paths that
    // run before any part is written, so the turn cannot be anchored on the first step.
    busy()
    send("session.error", { sessionID: SESSION, error: { name: "ProviderAuthError", data: { message: "no key" } } })
    send("session.idle", { sessionID: SESSION })
    const [turn] = named("prompt")
    expect(turn).toBeDefined()
    expect(turn!.attributes["opencode.turn.outcome"]).toBe("error")
  })

  test("a turn that recovers by compacting is not reported as failed", () => {
    // processor.ts publishes ContextOverflowError and then compacts and continues in the
    // same turn, so that error event on its own is not a verdict.
    busy()
    assistantMessage()
    part({ id: "prt_1", type: "step-start" })
    send("session.error", { sessionID: SESSION, error: { name: "ContextOverflowError", data: { message: "too long" } } })
    // Compaction re-runs the turn: another step start is what marks it as continuing.
    part({ id: "prt_1b", type: "step-start" })
    part({
      id: "prt_2",
      type: "step-finish",
      reason: "stop",
      cost: 0,
      tokens: { input: 1, output: 1, reasoning: 0, cache: { read: 0, write: 0 } },
    })
    send("session.idle", { sessionID: SESSION })
    expect(named("prompt")[0]!.attributes["opencode.turn.outcome"]).toBe("completed")
  })

  test("a terminal overflow fails the turn, in the order the runtime emits it", () => {
    // With auto-compaction off, halt publishes the error and goes idle; the message that
    // carries `error` is only published afterwards by the cleanup finalizer, so the
    // verdict has to come from the error not being followed by another step.
    busy()
    assistantMessage()
    part({ id: "prt_1", type: "step-start" })
    send("session.error", { sessionID: SESSION, error: { name: "ContextOverflowError", data: { message: "too long" } } })
    send("session.idle", { sessionID: SESSION })
    send("message.updated", {
      sessionID: SESSION,
      info: {
        role: "assistant",
        sessionID: SESSION,
        id: MESSAGE,
        modelID: "claude-opus-5",
        providerID: "clickzetta",
        agent: "data_engineer",
        finish: "error",
        error: { name: "ContextOverflowError", data: { message: "too long" } },
      },
    })
    const [turn] = named("prompt")
    expect(turn!.attributes["opencode.turn.outcome"]).toBe("error")
    expect(turn!.status.code).toBe(2)
  })

  test("a late error message does not bleed into the next turn", () => {
    busy()
    assistantMessage()
    part({ id: "prt_1", type: "step-start" })
    send("session.error", { sessionID: SESSION, error: { name: "APIError", data: { message: "boom" } } })
    send("session.idle", { sessionID: SESSION })
    busy()
    part({ id: "prt_2", type: "step-start" })
    send("session.idle", { sessionID: SESSION })
    const turns = named("prompt")
    expect(turns.map((t) => t.attributes["opencode.turn.outcome"])).toEqual(["error", "completed"])
  })

  test("the turn carries the model once its first step lands", () => {
    busy()
    assistantMessage()
    part({ id: "prt_1", type: "step-start" })
    send("session.idle", { sessionID: SESSION })
    const [turn] = named("prompt")
    expect(turn!.attributes["gen_ai.request.model"]).toBe("claude-opus-5")
    expect(turn!.attributes["opencode.agent.name"]).toBe("data_engineer")
  })

  test("steps and tools hang under their own session's turn", () => {
    busy()
    assistantMessage()
    part({ id: "prt_1", type: "step-start" })
    send("session.idle", { sessionID: SESSION })
    const [turn] = named("prompt")
    const [chat] = named("chat claude-opus-5")
    expect(chat!.parentSpanContext?.spanId).toBe(turn!.spanContext().spanId)
  })

  test("a concurrent session gets its own turn, and one going idle does not close the other", () => {
    const OTHER = "ses_other"
    busy()
    assistantMessage()
    part({ id: "prt_1", type: "step-start" })
    busy(OTHER)
    send("message.updated", {
      sessionID: OTHER,
      info: { role: "assistant", sessionID: OTHER, id: "msg_other", modelID: "m2", providerID: "p2", agent: "x" },
    })
    send("message.part.updated", {
      sessionID: OTHER,
      part: { sessionID: OTHER, messageID: "msg_other", id: "prt_o", type: "step-start" },
    })
    send("session.idle", { sessionID: SESSION })

    const turns = named("prompt")
    expect(turns).toHaveLength(1)
    expect(turns[0]!.attributes["opencode.session.id"]).toBe(SESSION)

    send("session.idle", { sessionID: OTHER })
    const both = named("prompt")
    expect(both).toHaveLength(2)
    expect(both[1]!.attributes["opencode.session.id"]).toBe(OTHER)
    expect(named("chat m2")[0]!.attributes["opencode.session.id"]).toBe(OTHER)
  })

  test("an aborted turn does not leave its step span open", () => {
    busy()
    assistantMessage()
    part({ id: "prt_1", type: "step-start" })
    send("session.idle", { sessionID: SESSION })
    expect(named("chat claude-opus-5")).toHaveLength(1)
  })
})

describe("the process-wide session slot", () => {
  test("is cleared by its owner rather than handed to an unrelated session", async () => {
    const { getSessionSpanRef } = await import("../src/opencode-plugin/otel/context")
    const OTHER = "ses_other"
    busy()
    assistantMessage()
    part({ id: "prt_1", type: "step-start" })
    busy(OTHER)
    send("message.updated", {
      sessionID: OTHER,
      info: { role: "assistant", sessionID: OTHER, id: "msg_o", modelID: "m2", providerID: "p2", agent: "x" },
    })
    send("message.part.updated", {
      sessionID: OTHER,
      part: { sessionID: OTHER, messageID: "msg_o", id: "prt_o", type: "step-start" },
    })
    expect(getSessionSpanRef()).toBeDefined()
    send("session.idle", { sessionID: SESSION })
    // Under `serve` the remaining turn belongs to an unrelated session; attributing
    // shells and log records to it would be worse than attributing to nothing.
    expect(getSessionSpanRef()).toBeUndefined()
  })
})

describe("replayed parts", () => {
  test("a forked session's history produces no spans, metrics or logs", () => {
    // Session.fork republishes every historical part through updatePart, outside any busy
    // window. Without the gate this re-records the whole history.
    send("message.updated", {
      sessionID: "ses_fork",
      info: { role: "assistant", sessionID: "ses_fork", id: "msg_h", modelID: "m", providerID: "p", agent: "a" },
    })
    send("message.part.updated", {
      sessionID: "ses_fork",
      part: { sessionID: "ses_fork", messageID: "msg_h", id: "prt_h1", type: "step-start" },
    })
    send("message.part.updated", {
      sessionID: "ses_fork",
      part: {
        sessionID: "ses_fork",
        messageID: "msg_h",
        id: "prt_h2",
        type: "step-finish",
        reason: "stop",
        cost: 1,
        tokens: { input: 9999, output: 9999, reasoning: 0, cache: { read: 0, write: 0 } },
      },
    })
    expect(exporter.getFinishedSpans()).toHaveLength(0)
    expect(emitted("opencode.llm.step.finished")).toHaveLength(0)
  })

  test("a settled tool republished by prune is recorded once, even a turn later", () => {
    // prune skips the two most recent turns, so what it rewrites belongs to a turn whose
    // dedupe keys were already purged — the compacted marker is what identifies it.
    busy()
    assistantMessage()
    part({ id: "prt_1", type: "step-start" })
    const settled = {
      id: "prt_2",
      type: "tool",
      callID: "call_1",
      tool: "bash",
      state: {
        status: "completed",
        input: { command: "ls" },
        output: "a.ts",
        title: "ls",
        metadata: {},
        time: { start: 1000, end: 2000 },
      },
    }
    part({ ...settled, state: { status: "pending", input: {}, raw: "" } })
    part(settled)
    send("session.idle", { sessionID: SESSION })

    // A later turn is live when prune's rewrite lands.
    busy()
    part({ id: "prt_3", type: "step-start" })
    part({ ...settled, state: { ...settled.state, time: { start: 1000, end: 2000, compacted: 3000 } } })
    send("session.idle", { sessionID: SESSION })

    expect(named("execute_tool bash")).toHaveLength(1)
    // The replay has no span left to close, so the log record is where a second settle
    // shows up — along with the counter and duration histogram beside it.
    expect(emitted("opencode.tool.finished")).toHaveLength(1)
  })
})

describe("subagent sessions", () => {
  test("a child turn hangs under its parent's turn instead of starting a detached trace", () => {
    const CHILD = "ses_child"
    busy()
    assistantMessage()
    part({ id: "prt_1", type: "step-start" })
    // task.ts creates the subagent session with parentID set.
    send("session.created", { sessionID: CHILD, info: { id: CHILD, parentID: SESSION } })
    busy(CHILD)
    send("message.updated", {
      sessionID: CHILD,
      info: { role: "assistant", sessionID: CHILD, id: "msg_c", modelID: "m2", providerID: "p2", agent: "sub" },
    })
    send("message.part.updated", {
      sessionID: CHILD,
      part: { sessionID: CHILD, messageID: "msg_c", id: "prt_c", type: "step-start" },
    })
    send("session.idle", { sessionID: CHILD })
    send("session.idle", { sessionID: SESSION })

    const turns = named("prompt")
    const child = turns.find((t) => t.attributes["opencode.session.id"] === CHILD)!
    const parent = turns.find((t) => t.attributes["opencode.session.id"] === SESSION)!
    expect(child.attributes["opencode.session.parent.id"]).toBe(SESSION)
    expect(child.parentSpanContext?.spanId).toBe(parent.spanContext().spanId)
    expect(child.spanContext().traceId).toBe(parent.spanContext().traceId)
  })

  test("a turn whose model arrives late still gets it", () => {
    // The latch must key on the model being known, not on having been called once.
    busy()
    part({ id: "prt_1", type: "step-start" })
    assistantMessage()
    part({ id: "prt_2", type: "step-start" })
    send("session.idle", { sessionID: SESSION })
    expect(named("prompt")[0]!.attributes["gen_ai.request.model"]).toBe("claude-opus-5")
  })
})

describe("tool content", () => {
  test("is capped so an oversized attribute cannot cost the span", () => {
    busy()
    assistantMessage()
    part({ id: "prt_1", type: "step-start" })
    const huge = "x".repeat(20_000)
    part({
      id: "prt_2",
      type: "tool",
      callID: "call_1",
      tool: "read",
      state: { status: "running", input: { file: huge }, time: { start: 1 } },
    })
    part({
      id: "prt_2",
      type: "tool",
      callID: "call_1",
      tool: "read",
      state: {
        status: "completed",
        input: { file: huge },
        output: huge,
        title: "read",
        metadata: {},
        time: { start: 1, end: 2 },
      },
    })
    send("session.idle", { sessionID: SESSION })
    const [tool] = named("execute_tool read")
    for (const key of ["gen_ai.tool.call.arguments", "gen_ai.tool.call.result"]) {
      const value = String(tool!.attributes[key])
      expect(value.length).toBeLessThan(9_000)
      expect(value).toContain("[truncated")
    }
  })
})

describe("log records", () => {
  test("follow their own session's turn, not whichever session got there first", () => {
    const OTHER = "ses_other"
    busy()
    assistantMessage()
    part({ id: "prt_1", type: "step-start" })
    busy(OTHER)
    send("message.updated", {
      sessionID: OTHER,
      info: { role: "assistant", sessionID: OTHER, id: "msg_o", modelID: "m2", providerID: "p2", agent: "x" },
    })
    send("message.part.updated", {
      sessionID: OTHER,
      part: { sessionID: OTHER, messageID: "msg_o", id: "prt_o", type: "step-start" },
    })
    send("session.error", { sessionID: OTHER, error: { name: "APIError", data: { message: "boom" } } })
    send("session.idle", { sessionID: OTHER })
    send("session.idle", { sessionID: SESSION })

    const turns = named("prompt")
    const other = turns.find((t) => t.attributes["opencode.session.id"] === OTHER)!
    const [record] = emitted("opencode.session.error")
    // The first session owns the process-wide slot; the record must still land under the
    // turn of the session it describes.
    const parent = trace.getSpanContext(record!.context)
    expect(parent?.spanId).toBe(other.spanContext().spanId)
  })
})

describe("an interrupted tool", () => {
  test("still reports its error, though the settlement lands after idle", () => {
    // On abort, `halt` sets the session idle and only then does `cleanup()` republish every
    // running call as "Tool execution aborted" — `ensuring` is the outermost stage of the
    // pipeline. A gate that only admits parts during a live turn discards exactly this.
    busy()
    assistantMessage()
    part({ id: "prt_1", type: "step-start" })
    part({
      id: "prt_2",
      type: "tool",
      callID: "call_1",
      tool: "bash",
      state: { status: "pending", input: {}, raw: "" },
    })
    part({
      id: "prt_2",
      type: "tool",
      callID: "call_1",
      tool: "bash",
      state: { status: "running", input: { command: "sleep 100" }, time: { start: 1000 } },
    })
    send("session.idle", { sessionID: SESSION })
    part({
      id: "prt_2",
      type: "tool",
      callID: "call_1",
      tool: "bash",
      state: {
        status: "error",
        input: { command: "sleep 100" },
        error: "Tool execution aborted",
        metadata: { interrupted: true },
        time: { start: 1000, end: 2000 },
      },
    })

    const [tool] = named("execute_tool bash")
    expect(tool).toBeDefined()
    expect(tool!.status.code).toBe(2)
    expect(tool!.attributes["error.message"]).toBe("Tool execution aborted")
    expect(tool!.attributes["gen_ai.tool.call.arguments"]).toBe(JSON.stringify({ command: "sleep 100" }))
    expect(emitted("opencode.tool.finished")).toHaveLength(1)
  })

  test("is given up on if a later turn starts without it ever settling", () => {
    busy()
    assistantMessage()
    part({ id: "prt_1", type: "step-start" })
    part({
      id: "prt_2",
      type: "tool",
      callID: "call_1",
      tool: "bash",
      state: { status: "running", input: { command: "x" }, time: { start: 1 } },
    })
    send("session.idle", { sessionID: SESSION })
    expect(named("execute_tool bash")).toHaveLength(0)
    busy()
    expect(named("execute_tool bash")).toHaveLength(1)
    expect(emitted("opencode.tool.finished")).toHaveLength(0)
  })
})

describe("outbound traceparent", () => {
  test("names the calling session, not whichever session owns the global slot", async () => {
    const { getSessionTraceparent } = await import("../src/opencode-plugin/otel/context")
    const OTHER = "ses_other"
    busy()
    part({ id: "prt_1", type: "step-start" })
    busy(OTHER)
    send("message.part.updated", {
      sessionID: OTHER,
      part: { sessionID: OTHER, messageID: "msg_o", id: "prt_o", type: "step-start" },
    })
    // Both turns are open here; SESSION acquired the process-wide slot first.
    const mine = getSessionTraceparent(SESSION)
    const theirs = getSessionTraceparent(OTHER)
    expect(mine).toBeDefined()
    expect(theirs).toBeDefined()
    expect(theirs).not.toBe(mine)
    // The case that actually goes wrong: a session with no turn of its own must get nothing
    // rather than the trace of whichever session filled the process-wide slot.
    expect(getSessionTraceparent("ses_no_turn")).toBeUndefined()

    send("session.idle", { sessionID: SESSION })
    send("session.idle", { sessionID: OTHER })

    const turns = named("prompt")
    const spanOf = (id: string) => turns.find((t) => t.attributes["opencode.session.id"] === id)!.spanContext()
    expect(theirs).toContain(spanOf(OTHER).spanId)
    expect(mine).toContain(spanOf(SESSION).spanId)
    // A closed turn is not a parent any more, and a caller with no session gets nothing
    // rather than someone else's trace.
    expect(getSessionTraceparent(OTHER)).toBeUndefined()
    expect(getSessionTraceparent(undefined)).toBeUndefined()
  })
})

describe("errors outside a turn", () => {
  test("do not mislabel a later turn", () => {
    // prompt.ts:625/:663/:1469/:1530 publish before status.set(busy) and throw with no idle.
    send("session.error", { sessionID: SESSION, error: { name: "ModelNotFound", data: { message: "gone" } } })
    expect(named("prompt")).toHaveLength(0)
    busy()
    send("session.idle", { sessionID: SESSION })
    expect(named("prompt")[0]!.attributes["opencode.turn.outcome"]).toBe("completed")
  })
})

describe("tool content redaction", () => {
  test("reuses the CLI's own redactor for inline credentials", () => {
    busy()
    assistantMessage()
    part({ id: "prt_1", type: "step-start" })
    part({
      id: "prt_2",
      type: "tool",
      callID: "call_1",
      tool: "bash",
      state: { status: "pending", input: {}, raw: "" },
    })
    part({
      id: "prt_2",
      type: "tool",
      callID: "call_1",
      tool: "bash",
      state: {
        status: "running",
        input: { command: "deploy --to prod TOKEN=abcd1234secret", password: "hunter2" },
        time: { start: 1 },
      },
    })
    part({
      id: "prt_2",
      type: "tool",
      callID: "call_1",
      tool: "bash",
      state: {
        status: "completed",
        input: { command: "deploy --to prod TOKEN=abcd1234secret", password: "hunter2" },
        output: "ok, used APIKEY=zzzz9999private",
        title: "bash",
        metadata: {},
        time: { start: 1, end: 2 },
      },
    })
    send("session.idle", { sessionID: SESSION })
    const [span] = named("execute_tool bash")
    const result = String(span!.attributes["gen_ai.tool.call.result"])
    expect(result).not.toContain("zzzz9999private")
    expect(result).toContain("<redacted>")
    const args = String(span!.attributes["gen_ai.tool.call.arguments"])
    expect(args).not.toContain("abcd1234secret")
    expect(args).not.toContain("hunter2")
    expect(args).toContain("<redacted>")
    // Non-secret parts of the command survive, or the attribute would be useless.
    expect(args).toContain("deploy")
  })
})

describe("a call given up on", () => {
  test("is not exported as a successful one", () => {
    busy()
    assistantMessage()
    part({ id: "prt_1", type: "step-start" })
    part({
      id: "prt_2",
      type: "tool",
      callID: "call_1",
      tool: "bash",
      state: { status: "running", input: { command: "x" }, time: { start: 1 } },
    })
    send("session.idle", { sessionID: SESSION })
    busy()
    const [tool] = named("execute_tool bash")
    expect(tool!.status.code).toBe(2)
    expect(tool!.status.message).toBe("tool call never settled")
  })
})

describe("log records for a session with no turn", () => {
  test("carry no parent rather than another session's", () => {
    const OTHER = "ses_other"
    busy()
    part({ id: "prt_1", type: "step-start" })
    // OTHER never opened a turn, and SESSION owns the process-wide slot.
    send("session.created", { sessionID: OTHER, info: { id: OTHER } })
    const [record] = emitted("opencode.session.created")
    expect(trace.getSpanContext(record!.context)).toBeUndefined()
    send("session.idle", { sessionID: SESSION })
  })
})

describe("prompt and completion content", () => {
  test("a chat span carries input, system and output messages", async () => {
    const { recordInputMessages, recordSystemInstructions } = await import(
      "../src/opencode-plugin/otel/handlers"
    )
    busy()
    assistantMessage()
    // Both transform hooks fire before the step, which is why the span can carry them.
    recordSystemInstructions(SESSION, ["You are a data engineer.", "Prefer SQL."])
    recordInputMessages([
      {
        info: { role: "user", sessionID: SESSION, id: "msg_u" },
        parts: [{ id: "p1", type: "text", text: "how many rows in orders?" }],
      },
    ])
    part({ id: "prt_1", type: "step-start" })
    part({ id: "prt_t", type: "text", text: "Let me check." })
    part({
      id: "prt_tool",
      type: "tool",
      callID: "call_1",
      tool: "sql",
      state: {
        status: "completed",
        input: { statement: "select count(*) from orders" },
        output: "42",
        title: "sql",
        metadata: {},
        time: { start: 1, end: 2 },
      },
    })
    part({
      id: "prt_2",
      type: "step-finish",
      reason: "stop",
      cost: 0.01,
      tokens: { input: 10, output: 5, reasoning: 0, cache: { read: 0, write: 0 } },
    })
    send("session.idle", { sessionID: SESSION })

    const [chat] = named("chat claude-opus-5")
    const input = String(chat!.attributes["gen_ai.input.messages"])
    expect(input).toContain("how many rows in orders?")
    expect(JSON.parse(input)[0].role).toBe("user")

    const system = String(chat!.attributes["gen_ai.system_instructions"])
    expect(system).toContain("data engineer")
    expect(JSON.parse(system)[0].type).toBe("text")

    const out = JSON.parse(String(chat!.attributes["gen_ai.output.messages"]))
    expect(out[0].role).toBe("assistant")
    expect(out[0].finish_reason).toBe("stop")
    expect(out[0].parts[0]).toEqual({ type: "text", content: "Let me check." })
    expect(out[0].parts[1].type).toBe("tool_call")
    expect(out[0].parts[1].name).toBe("sql")
  })

  test("content is redacted and honours OPENCODE_OTEL_RECORD_CONTENT=0", async () => {
    const { recordInputMessages, initHandlers: init } = await import(
      "../src/opencode-plugin/otel/handlers"
    )
    busy()
    assistantMessage()
    recordInputMessages([
      {
        info: { role: "user", sessionID: SESSION, id: "msg_u" },
        parts: [{ id: "p1", type: "text", text: "use PASSWORD=hunter2 to connect" }],
      },
    ])
    part({ id: "prt_1", type: "step-start" })
    send("session.idle", { sessionID: SESSION })
    const input = String(named("chat claude-opus-5")[0]!.attributes["gen_ai.input.messages"])
    expect(input).not.toContain("hunter2")
    expect(input).toContain("<redacted>")

    // With content off, nothing is captured in the first place.
    shutdown()
    exporter.reset()
    records.length = 0
    init(logger as any, false)
    busy()
    assistantMessage()
    recordInputMessages([
      { info: { role: "user", sessionID: SESSION, id: "m" }, parts: [{ id: "p", type: "text", text: "secret plan" }] },
    ])
    part({ id: "prt_1", type: "step-start" })
    part({ id: "prt_t", type: "text", text: "reply text" })
    part({
      id: "prt_2",
      type: "step-finish",
      reason: "stop",
      cost: 0,
      tokens: { input: 1, output: 1, reasoning: 0, cache: { read: 0, write: 0 } },
    })
    send("session.idle", { sessionID: SESSION })
    const off = named("chat claude-opus-5")[0]!
    expect(off.attributes["gen_ai.input.messages"]).toBeUndefined()
    expect(off.attributes["gen_ai.output.messages"]).toBeUndefined()
  })
})

describe("the credential shapes that leaked", () => {
  function toolCall(tool: string, input: Record<string, any>, output: string) {
    busy()
    assistantMessage()
    part({ id: "prt_1", type: "step-start" })
    part({ id: "prt_2", type: "tool", callID: "c1", tool, state: { status: "pending", input: {}, raw: "" } })
    part({ id: "prt_2", type: "tool", callID: "c1", tool, state: { status: "running", input, time: { start: 1 } } })
    part({
      id: "prt_2",
      type: "tool",
      callID: "c1",
      tool,
      state: { status: "completed", input, output, title: tool, metadata: {}, time: { start: 1, end: 2 } },
    })
    send("session.idle", { sessionID: SESSION })
    const span = named(`execute_tool ${tool}`)[0]!
    return {
      args: String(span.attributes["gen_ai.tool.call.arguments"]),
      result: String(span.attributes["gen_ai.tool.call.result"]),
    }
  }

  test("a TOML credential file read does not export the PAT", () => {
    // profiles.toml uses `pat = "…"` — spaces around `=` and double quotes, which the
    // KEY=VALUE predicate and redactSql's single-quote matching both miss.
    const { result } = toolCall("read", { filePath: "~/.clickzetta/profiles.toml" },
      '[default]\npat = "czpat_liveSecretValue"\npassword = "hunter2"\nworkspace = "ws1"\n')
    expect(result).not.toContain("czpat_liveSecretValue")
    expect(result).not.toContain("hunter2")
    expect(result).toContain("<redacted>")
    // Non-secret config still survives, or the attribute is useless.
    expect(result).toContain("ws1")
  })

  test("a .env body being written does not export its secrets", () => {
    const { args } = toolCall("write", { filePath: ".env", content: "TOKEN=abc123xyz\nAPI_KEY=k-999\nPORT=8080" }, "ok")
    expect(args).not.toContain("abc123xyz")
    expect(args).toContain("PORT=8080")
  })

  test("whitespace-separated flag spellings are covered", () => {
    const { args } = toolCall("bash", { command: "cz auth login x --password hunter2 --account-name acme" }, "ok")
    expect(args).not.toContain("hunter2")
    expect(args).toContain("acme")
  })

  test("a YAML-style credential is covered", () => {
    const { result } = toolCall("read", { filePath: "cfg.yaml" }, "token: sk-live-9999\nregion: cn-shanghai\n")
    expect(result).not.toContain("sk-live-9999")
    expect(result).toContain("cn-shanghai")
  })

  test("a private key block is replaced whole", () => {
    const pem = "-----BEGIN RSA PRIVATE KEY-----\nMIIEabcdefg\n-----END RSA PRIVATE KEY-----"
    const { result } = toolCall("read", { filePath: "id_rsa" }, pem)
    expect(result).not.toContain("MIIEabcdefg")
    expect(result).toContain("<redacted:private-key>")
  })

  test("a cyclic tool input does not blow the stack", () => {
    const cyclic: Record<string, any> = { name: "x" }
    cyclic.self = cyclic
    busy()
    assistantMessage()
    part({ id: "prt_1", type: "step-start" })
    part({ id: "prt_2", type: "tool", callID: "c1", tool: "odd", state: { status: "pending", input: {}, raw: "" } })
    part({ id: "prt_2", type: "tool", callID: "c1", tool: "odd", state: { status: "running", input: cyclic, time: { start: 1 } } })
    send("session.idle", { sessionID: SESSION })
    busy()
    const args = String(named("execute_tool odd")[0]!.attributes["gen_ai.tool.call.arguments"])
    expect(args).toContain("<redacted:cycle>")
  })
})
