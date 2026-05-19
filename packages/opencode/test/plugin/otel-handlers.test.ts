import { afterEach, expect, test } from "bun:test"
import { SeverityNumber } from "@opentelemetry/api-logs"
import { handleEvent, initHandlers, shutdown } from "../../src/plugin/otel/handlers"

const records: Array<Record<string, unknown>> = []

afterEach(() => {
  shutdown()
  records.length = 0
})

test("handleEvent emits normalized prompt lifecycle logs", () => {
  initHandlers({
    emit(record: unknown) {
      records.push(record as Record<string, unknown>)
    },
  } as never)

  handleEvent({
    type: "session.status",
    properties: {
      sessionID: "session-123",
      status: { type: "busy" },
    },
  })

  expect(records).toHaveLength(1)
  expect(records[0]).toEqual({
    severityNumber: SeverityNumber.INFO,
    severityText: "INFO",
    body: "User prompt started",
    attributes: {
      "event.name": "opencode.session.prompt.started",
      "opencode.session.id": "session-123",
      "gen_ai.conversation.id": "session-123",
      "gen_ai.operation.name": "chat",
    },
    context: expect.anything(),
  })
})

test("handleEvent ignores malformed telemetry payloads", () => {
  initHandlers({
    emit(record: unknown) {
      records.push(record as Record<string, unknown>)
    },
  } as never)

  expect(() => handleEvent({
    type: "session.status",
    properties: null as never,
  })).not.toThrow()
  expect(records).toHaveLength(0)
})
