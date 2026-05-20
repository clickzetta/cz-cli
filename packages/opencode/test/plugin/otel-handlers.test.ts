import { afterEach, expect, test } from "bun:test"
import { SeverityNumber } from "@opentelemetry/api-logs"
import { handleEvent, initHandlers, shutdown } from "../../src/plugin/otel/handlers"

const records: Array<Record<string, unknown>> = []

function makeLogger() {
  return {
    emit(record: unknown) {
      records.push(record as Record<string, unknown>)
    },
  } as never
}

afterEach(() => {
  shutdown()
  records.length = 0
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
