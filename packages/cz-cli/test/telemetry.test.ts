import { afterEach, expect, mock, test } from "bun:test"
import { OTEL_DEFAULTS } from "../src/otel-defaults.ts"
import { parseTrackingArgs, trackCommand } from "../src/telemetry.ts"

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

// A flag's value must never reach `_positional`: the flag map redacts `pat`, and
// putting the same token in a second attribute undid that. Measured before the fix:
// `cz-cli auth login mysession --pat czt_secret` recorded `mysession czt_secret`.
test("parseTrackingArgs keeps a flag's value out of _positional", () => {
  const { positional, args } = parseTrackingArgs(["auth", "login", "mysession", "--pat", "czt_secret"])

  expect(positional).toEqual(["auth", "login", "mysession"])
  expect(args["_positional"]).toBe("mysession")
  expect(args.pat).toBe("<redacted>")
  expect(JSON.stringify(args)).not.toContain("czt_secret")
})

test("parseTrackingArgs leaves non-sensitive flags' neighbours alone", () => {
  // Only sensitive flags swallow their neighbour. A boolean flag followed by a real
  // positional is indistinguishable by shape, so the existing analytics keep seeing it.
  const { positional, args } = parseTrackingArgs(["sql", "--debug", "select 1"])

  expect(positional).toEqual(["sql", "select 1"])
  expect(args.debug).toBe("select 1")
})

test("parseTrackingArgs redacts --password and --pat=inline forms too", () => {
  const inline = parseTrackingArgs(["auth", "login", "s", "--pat=czt_secret"])
  expect(inline.args.pat).toBe("<redacted>")
  expect(JSON.stringify(inline.args)).not.toContain("czt_secret")

  const spaced = parseTrackingArgs(["auth", "login", "s", "--username", "u", "--password", "hunter2"])
  expect(spaced.args.password).toBe("<redacted>")
  expect(JSON.stringify(spaced.args)).not.toContain("hunter2")
  // `username` is not in SENSITIVE_KEYS, so its value is recorded as before — the fix
  // is scoped to values that must never be stored, not to positional accuracy.
  expect(spaced.args["_positional"]).toBe("s u")
})

// Cookie auth is one of the four credential kinds, so `--header Cookie=…` is a
// credential in flag clothing — it used to reach OTel verbatim.
test("parseTrackingArgs redacts --header values", () => {
  const inline = parseTrackingArgs(["sql", "--header", "Cookie=sess_abc", "select 1"])
  expect(inline.args.header).toBe("<redacted>")
  expect(JSON.stringify(inline)).not.toContain("sess_abc")
  // The KEY=VALUE token is withheld; the statement after it is still a positional.
  expect(inline.positional).toEqual(["sql", "select 1"])
})

// `--header` is KEY=VALUE on `profile create` but a boolean on `sql` (--no-header), so
// the arity cannot be read off the name alone.
test("parseTrackingArgs keeps the statement when --header is the boolean form", () => {
  const { positional } = parseTrackingArgs(["sql", "--header", "select 1"])

  expect(positional).toEqual(["sql", "select 1"])
})
