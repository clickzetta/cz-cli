import { afterEach, expect, mock, test } from "bun:test"
import { OTEL_DEFAULTS } from "../src/otel-defaults.ts"
import { trackCommand } from "../src/telemetry.ts"

const originalFetch = globalThis.fetch
const originalEndpoint = OTEL_DEFAULTS.endpoint
const originalHeaders = OTEL_DEFAULTS.headers

afterEach(() => {
  globalThis.fetch = originalFetch
  OTEL_DEFAULTS.endpoint = originalEndpoint
  OTEL_DEFAULTS.headers = originalHeaders
})

test("trackCommand emits normalized command telemetry attributes", async () => {
  OTEL_DEFAULTS.endpoint = "https://otel.example"
  OTEL_DEFAULTS.headers = "x-api-key=test-key"
  process.env.CLICKZETTA_TRACEPARENT = "00-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbb-01"

  let request: { url: string; init?: RequestInit } | undefined
  globalThis.fetch = mock((url: string | URL | Request, init?: RequestInit) => {
    request = { url: String(url), init }
    return Promise.resolve(new Response(null, { status: 202 }))
  }) as unknown as typeof fetch

  await trackCommand({
    command: "agent",
    subcommand: "run",
    args: {
      format: "json",
      token: "<redacted>",
      telemetry: "true",
    },
    duration_ms: 123.4,
    success: false,
    error: "exit_code=1",
    response_bytes: 456,
    resourceAttributes: { "username": "alice" },
  })

  expect(request?.url).toBe("https://otel.example/v1/logs")
  expect(request?.init?.headers).toEqual({
    "Content-Type": "application/json",
    "x-api-key": "test-key",
  })

  const payload = JSON.parse(String(request?.init?.body)) as {
    resourceLogs: Array<{
      scopeLogs: Array<{
        logRecords: Array<{
          severityNumber: number
          severityText: string
          body: { stringValue: string }
          attributes: Array<{ key: string; value: Record<string, string | boolean> }>
        }>
      }>
    }>
  }
  const record = payload.resourceLogs[0]?.scopeLogs[0]?.logRecords[0]
  expect(record).toBeDefined()
  expect(record?.severityNumber).toBe(17)
  expect(record?.severityText).toBe("ERROR")
  expect(record?.body).toEqual({ stringValue: "Command agent run failed" })
  expect(record?.attributes).toEqual([
    { key: "event.name", value: { stringValue: "cz_cli.command.execution" } },
    { key: "cz_cli.command.name", value: { stringValue: "agent" } },
    { key: "cz_cli.command.subcommand", value: { stringValue: "run" } },
    { key: "cz_cli.command.arg.format", value: { stringValue: "json" } },
    { key: "cz_cli.command.arg.token", value: { stringValue: "<redacted>" } },
    { key: "cz_cli.command.arg.telemetry", value: { stringValue: "true" } },
    { key: "cz_cli.command.duration_ms", value: { intValue: "123" } },
    { key: "cz_cli.command.response_bytes", value: { intValue: "456" } },
    { key: "cz_cli.command.error", value: { stringValue: "exit_code=1" } },
  ])
})
