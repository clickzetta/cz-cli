import { afterEach, beforeAll, expect, test } from "bun:test"
import { context, trace } from "@opentelemetry/api"
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks"
import { SeverityNumber } from "@opentelemetry/api-logs"
import { BasicTracerProvider, InMemorySpanExporter, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base"
import { handleEvent, initHandlers, shutdown } from "../../src/plugin/otel/handlers"

const records: Array<Record<string, unknown>> = []
const exporter = new InMemorySpanExporter()
const provider = new BasicTracerProvider({
  spanProcessors: [new SimpleSpanProcessor(exporter)],
})
const manager = new AsyncLocalStorageContextManager()

function makeLogger() {
  return {
    emit(record: unknown) {
      records.push(record as Record<string, unknown>)
    },
  } as never
}

beforeAll(() => {
  trace.setGlobalTracerProvider(provider)
  manager.enable()
  context.setGlobalContextManager(manager)
})

afterEach(() => {
  shutdown()
  records.length = 0
  exporter.reset()
})

// ─── session lifecycle ────────────────────────────────────────────────────────

test("session.created emits log with session id", () => {
  initHandlers(makeLogger())
  handleEvent({ type: "session.created", properties: { sessionID: "ses-1" } })
  expect(records).toHaveLength(1)
  expect(records[0]).toMatchObject({
    severityNumber: SeverityNumber.INFO,
    severityText: "INFO",
    body: "session.created",
    attributes: { "event.name": "opencode.session.created", "opencode.session.id": "ses-1" },
  })
})

test("session.deleted emits log with duration", () => {
  initHandlers(makeLogger())
  handleEvent({ type: "session.created", properties: { sessionID: "ses-2" } })
  handleEvent({ type: "session.deleted", properties: { sessionID: "ses-2" } })
  const deletedLog = records.find((r) => (r.attributes as any)?.["event.name"] === "opencode.session.deleted")
  expect(deletedLog).toBeDefined()
  expect(typeof (deletedLog?.attributes as any)?.["opencode.session.duration_ms"]).toBe("number")
})

test("session.deleted without prior created omits duration", () => {
  initHandlers(makeLogger())
  handleEvent({ type: "session.deleted", properties: { sessionID: "ses-x" } })
  expect((records[0]?.attributes as any)?.["opencode.session.duration_ms"]).toBeUndefined()
})

test("session.status busy emits prompt.started log", () => {
  initHandlers(makeLogger())
  handleEvent({ type: "session.status", properties: { sessionID: "ses-3", status: { type: "busy" } } })
  expect(records).toHaveLength(1)
  expect(records[0]).toMatchObject({
    severityNumber: SeverityNumber.INFO,
    body: "session.prompt.started",
    attributes: {
      "event.name": "opencode.session.prompt.started",
      "opencode.session.id": "ses-3",
      "gen_ai.conversation.id": "ses-3",
      "gen_ai.operation.name": "chat",
    },
  })
})

test("session.turn.started emits turn.started log with input summary", () => {
  initHandlers(makeLogger())
  handleEvent({
    type: "session.turn.started",
    properties: {
      sessionID: "ses-turn-1",
      messageID: "msg-turn-1",
      agent: "build",
      model: "openai/gpt-5",
      parts: 1,
    },
  })
  expect(records).toHaveLength(1)
  expect(records[0]).toMatchObject({
    severityNumber: SeverityNumber.INFO,
    body: "session.turn.started",
    attributes: {
      "event.name": "opencode.session.turn.started",
      "opencode.session.id": "ses-turn-1",
      "opencode.message.id": "msg-turn-1",
      "opencode.agent.name": "build",
      "gen_ai.request.model": "openai/gpt-5",
      "opencode.turn.parts": 1,
    },
  })
})

test("v2.step.started span uses full gen_ai input messages and system instructions", () => {
  initHandlers(makeLogger())
  handleEvent({
    type: "v2.step.started",
    properties: {
      sessionID: "ses-step-1",
      messageID: "msg-step-1",
      stepId: "step-1",
      model: "openai/gpt-5",
      providerID: "openai",
      inputMessages: JSON.stringify([
        { role: "system", content: "workspace rules" },
        { role: "user", content: [{ type: "text", text: "show tables" }] },
      ]),
      systemInstructions: "workspace rules",
    },
  })
  handleEvent({
    type: "v2.step.ended",
    properties: {
      sessionID: "ses-step-1",
      messageID: "msg-step-1",
      stepId: "step-1",
      model: "openai/gpt-5",
      providerID: "openai",
      finishReason: "stop",
      tokens: { input: 10, output: 5, reasoning: 0, cache: { read: 0, write: 0 } },
      cost: 0.001,
      durationMs: 10,
    },
  })
  const span = exporter.getFinishedSpans().find((item) => item.name === "chat openai/gpt-5")
  expect(span).toBeDefined()
  expect(span?.attributes).toMatchObject({
    "gen_ai.operation.name": "chat",
    "gen_ai.provider.name": "openai",
    "gen_ai.request.model": "openai/gpt-5",
    "opencode.session.id": "ses-step-1",
    "gen_ai.input.messages": JSON.stringify([
      { role: "system", content: "workspace rules" },
      { role: "user", content: [{ type: "text", text: "show tables" }] },
    ]),
    "gen_ai.system_instructions": "workspace rules",
  })
})

test("session.preflight.finished emits no-op outcome log", () => {
  initHandlers(makeLogger())
  handleEvent({
    type: "session.turn.started",
    properties: {
      sessionID: "ses-preflight-1",
      messageID: "msg-preflight-1",
      agent: "build",
      parts: 1,
    },
  })
  handleEvent({
    type: "session.preflight.started",
    properties: {
      sessionID: "ses-preflight-1",
      messageID: "msg-preflight-1",
    },
  })
  handleEvent({
    type: "session.preflight.finished",
    properties: {
      sessionID: "ses-preflight-1",
      messageID: "msg-preflight-1",
      outcome: "no_op_exit",
    },
  })
  const preflightLog = records.find((r) => (r.attributes as any)?.["event.name"] === "opencode.session.preflight.finished")
  expect(preflightLog).toBeDefined()
  expect(preflightLog).toMatchObject({
    body: "session.preflight.finished",
    attributes: {
      "event.name": "opencode.session.preflight.finished",
      "opencode.session.id": "ses-preflight-1",
      "opencode.message.id": "msg-preflight-1",
      "opencode.preflight.outcome": "no_op_exit",
    },
  })
})

test("session.error emits error log", () => {
  initHandlers(makeLogger())
  handleEvent({
    type: "session.turn.started",
    properties: {
      sessionID: "ses-err-1",
      messageID: "msg-err-1",
      agent: "build",
      parts: 1,
    },
  })
  handleEvent({
    type: "session.error",
    properties: {
      sessionID: "ses-err-1",
      error: {
        name: "MessageAbortedError",
        data: {
          message: "Aborted",
        },
      },
    },
  })
  const errorLog = records.find((r) => (r.attributes as any)?.["event.name"] === "opencode.session.error")
  expect(errorLog).toBeDefined()
  expect(errorLog).toMatchObject({
    severityNumber: SeverityNumber.ERROR,
    severityText: "ERROR",
    body: "session.error",
    attributes: {
      "event.name": "opencode.session.error",
      "opencode.session.id": "ses-err-1",
      "error.name": "MessageAbortedError",
      "error.message": "Aborted",
    },
  })
})

test("session.turn.finished emits final outcome log", () => {
  initHandlers(makeLogger())
  handleEvent({
    type: "session.turn.started",
    properties: {
      sessionID: "ses-turn-2",
      messageID: "msg-turn-2",
      agent: "build",
      parts: 1,
    },
  })
  handleEvent({
    type: "session.turn.finished",
    properties: {
      sessionID: "ses-turn-2",
      messageID: "msg-turn-2",
      outcome: "completed",
    },
  })
  const endLog = records.find((r) => (r.attributes as any)?.["event.name"] === "opencode.session.turn.finished")
  expect(endLog).toBeDefined()
  expect(endLog).toMatchObject({
    body: "session.turn.finished",
    attributes: {
      "event.name": "opencode.session.turn.finished",
      "opencode.session.id": "ses-turn-2",
      "opencode.message.id": "msg-turn-2",
      "opencode.turn.outcome": "completed",
    },
  })
})

test("session.status idle emits no log", () => {
  initHandlers(makeLogger())
  handleEvent({ type: "session.status", properties: { sessionID: "ses-4", status: { type: "idle" } } })
  expect(records).toHaveLength(0)
})

test("session.idle emits log", () => {
  initHandlers(makeLogger())
  handleEvent({ type: "session.idle", properties: { sessionID: "ses-5" } })
  expect(records).toHaveLength(1)
  expect(records[0]).toMatchObject({
    body: "session.idle",
    attributes: { "event.name": "opencode.session.idle", "opencode.session.id": "ses-5" },
  })
})

// ─── LLM step ────────────────────────────────────────────────────────────────

test("v2.step.ended emits llm.step.finished log with all token fields", () => {
  initHandlers(makeLogger())
  handleEvent({
    type: "v2.step.ended",
    properties: {
      sessionID: "ses-6",
      messageID: "msg-1",
      stepId: "step-1",
      model: "claude-sonnet-4-6",
      providerID: "anthropic",
      finishReason: "stop",
      tokens: { input: 100, output: 50, reasoning: 10, cache: { read: 20, write: 5 } },
      cost: 0.001,
      durationMs: 1234,
      responseText: "hello world",
    },
  })
  expect(records).toHaveLength(1)
  expect(records[0]).toMatchObject({
    severityNumber: SeverityNumber.INFO,
    body: "llm.step.finished",
    attributes: {
      "event.name": "opencode.llm.step.finished",
      "opencode.session.id": "ses-6",
      "gen_ai.provider.name": "anthropic",
      "gen_ai.request.model": "claude-sonnet-4-6",
      "gen_ai.response.finish_reasons": "stop",
      "gen_ai.usage.input_tokens": 100,
      "gen_ai.usage.output_tokens": 50,
      "gen_ai.usage.reasoning.output_tokens": 10,
      "gen_ai.usage.cache_read.input_tokens": 20,
      "gen_ai.usage.cache_creation.input_tokens": 5,
      "opencode.llm.cost": 0.001,
      "opencode.llm.duration_ms": 1234,
    },
  })
})

test("v2.step.ended with zero tokens still emits log", () => {
  initHandlers(makeLogger())
  handleEvent({
    type: "v2.step.ended",
    properties: {
      sessionID: "ses-7",
      messageID: "msg-2",
      stepId: "step-2",
      model: "gpt-4o",
      providerID: "openai",
      finishReason: "tool-calls",
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      cost: 0,
      durationMs: 500,
    },
  })
  expect(records).toHaveLength(1)
  expect(records[0]).toMatchObject({ body: "llm.step.finished" })
})

// ─── tool call ───────────────────────────────────────────────────────────────

test("v2.tool.ended emits tool.call.completed log", () => {
  initHandlers(makeLogger())
  handleEvent({
    type: "v2.tool.ended",
    properties: {
      sessionID: "ses-8",
      messageID: "msg-3",
      id: "call-1",
      name: "bash",
      success: true,
      durationMs: 300,
      output: "hello",
    },
  })
  expect(records).toHaveLength(1)
  expect(records[0]).toMatchObject({
    severityNumber: SeverityNumber.INFO,
    severityText: "INFO",
    body: "tool.call.completed",
    attributes: {
      "event.name": "opencode.tool.finished",
      "opencode.session.id": "ses-8",
      "gen_ai.tool.name": "bash",
      "gen_ai.tool.call.id": "call-1",
      "opencode.tool.duration_ms": 300,
    },
  })
  expect((records[0]?.attributes as any)?.["error.message"]).toBeUndefined()
})

test("v2.tool.ended with success=false emits tool.call.failed log with error", () => {
  initHandlers(makeLogger())
  handleEvent({
    type: "v2.tool.ended",
    properties: {
      sessionID: "ses-9",
      messageID: "msg-4",
      id: "call-2",
      name: "read_file",
      success: false,
      durationMs: 50,
      error: "file not found",
    },
  })
  expect(records).toHaveLength(1)
  expect(records[0]).toMatchObject({
    severityNumber: SeverityNumber.ERROR,
    severityText: "ERROR",
    body: "tool.call.failed",
    attributes: expect.objectContaining({
      "event.name": "opencode.tool.finished",
      "gen_ai.tool.name": "read_file",
      "error.message": "file not found",
    }),
  })
})

// ─── robustness ──────────────────────────────────────────────────────────────

test("unknown event type emits nothing", () => {
  initHandlers(makeLogger())
  handleEvent({ type: "unknown.event", properties: { foo: "bar" } })
  expect(records).toHaveLength(0)
})

test("malformed properties do not throw", () => {
  initHandlers(makeLogger())
  expect(() => handleEvent({ type: "session.status", properties: null as never })).not.toThrow()
  expect(records).toHaveLength(0)
})

test("missing sessionID is handled gracefully", () => {
  initHandlers(makeLogger())
  handleEvent({ type: "session.created", properties: {} })
  expect(records).toHaveLength(1)
  expect((records[0]?.attributes as any)?.["opencode.session.id"]).toBeUndefined()
})

test("no logger initialized emits nothing without throwing", () => {
  // no initHandlers call
  expect(() => handleEvent({ type: "session.created", properties: { sessionID: "ses-x" } })).not.toThrow()
})
