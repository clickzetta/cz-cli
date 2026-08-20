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
test("parseTrackingArgs redacts a cookie value whatever flag carries it", () => {
  const spaced = parseTrackingArgs(["profile", "create", "p", "--header", "Cookie=sess_abc"])
  expect(spaced.args.header).toBe("<redacted>")
  expect(JSON.stringify(spaced)).not.toContain("sess_abc")

  const inline = parseTrackingArgs(["profile", "create", "p", "--header=Cookie=sess_abc"])
  expect(inline.args.header).toBe("<redacted>")
  expect(JSON.stringify(inline)).not.toContain("sess_abc")
})

// `--header` is KEY=VALUE on `profile create` but a boolean on `sql` (--no-header), so
// redacting by NAME swallowed the statement next to it — and SQL is full of `=`, which is
// why the value shape, not the flag name, is the discriminator.
test("parseTrackingArgs keeps a SQL statement that follows the boolean --header", () => {
  const plain = parseTrackingArgs(["sql", "--header", "select 1"])
  expect(plain.positional).toEqual(["sql", "select 1"])

  const withEquals = parseTrackingArgs(["sql", "--header", "select * from t where id=1"])
  // Kept as a positional (for `sql <stmt>` that is index 1, which run-cli reads as the
  // subcommand dimension — `_positional` only starts at index 2).
  expect(withEquals.positional).toEqual(["sql", "select * from t where id=1"])
  expect(withEquals.args.header).toBe("select * from t where id=1")
})

// `--login` / `--jdbc` take a JDBC connection string, and jdbc.ts reads `password=`
// out of it, so the whole value is a credential.
test("parseTrackingArgs redacts connection strings", () => {
  const r = parseTrackingArgs(["auth", "login", "s", "--login", "jdbc:clickzetta://h/ws?password=hunter2"])

  expect(r.args.login).toBe("<redacted>")
  expect(r.args["_positional"]).toBe("s")
  expect(JSON.stringify(r)).not.toContain("hunter2")
})

// A secret starting with `-` used to escape both the filter and the redaction and be
// recorded as an attribute KEY, which is worse than a value.
test("parseTrackingArgs claims a sensitive flag's value even when it starts with -", () => {
  const r = parseTrackingArgs(["auth", "login", "s", "--password", "-h7Kq_secret"])

  expect(r.args.password).toBe("<redacted>")
  expect(Object.keys(r.args)).not.toContain("h7Kq_secret")
  expect(JSON.stringify(r)).not.toContain("h7Kq_secret")
})

// `--header` is a generic repeatable KEY=VALUE, so a cookie is not the only credential
// that rides it.
test("parseTrackingArgs redacts any credential-named header value", () => {
  for (const value of ["Authorization=Bearer eyJhbGc", "X-Api-Key=k_live_123", "api-key=k_live_123"]) {
    const r = parseTrackingArgs(["profile", "create", "p", "--header", value])
    expect(JSON.stringify(r)).not.toContain("eyJhbGc")
    expect(JSON.stringify(r)).not.toContain("k_live_123")
  }
  // A non-credential header name is still recorded — the value is the discriminator.
  const kept = parseTrackingArgs(["profile", "create", "p", "--header", "X-Trace-Id=abc"])
  expect(kept.args.header).toBe("X-Trace-Id=abc")
})
