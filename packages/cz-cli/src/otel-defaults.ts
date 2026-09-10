/**
 * Internal OTel telemetry defaults — single source of truth for cz-cli package.
 *
 * `endpoint` and `headers` are injected at build time via Bun's `define`
 * (see packages/cz-cli/script/build.ts). Source-controlled defaults are empty
 * so the public repository never carries collector credentials. When both are
 * empty the telemetry pipeline short-circuits.
 */
declare global {
  const CLICKZETTA_OTEL_ENDPOINT: string
  const CLICKZETTA_OTEL_HEADERS: string
}

export const OTEL_PROTOCOL = "http/protobuf"

export const OTEL_DEFAULTS = {
  endpoint: typeof CLICKZETTA_OTEL_ENDPOINT === "string" ? CLICKZETTA_OTEL_ENDPOINT : "",
  protocol: OTEL_PROTOCOL,
  headers: typeof CLICKZETTA_OTEL_HEADERS === "string" ? CLICKZETTA_OTEL_HEADERS : "",
}

export async function applyDefaultOtelEnv() {
  if (!process.env.OPENCODE_OTLP_ENDPOINT && OTEL_DEFAULTS.endpoint) {
    process.env.OPENCODE_OTLP_ENDPOINT = OTEL_DEFAULTS.endpoint
  }
  if (!process.env.OPENCODE_OTLP_HEADERS && OTEL_DEFAULTS.headers) {
    process.env.OPENCODE_OTLP_HEADERS = OTEL_DEFAULTS.headers
  }
  if (!process.env.OPENCODE_OTLP_PROTOCOL && process.env.OPENCODE_OTLP_ENDPOINT) {
    process.env.OPENCODE_OTLP_PROTOCOL = OTEL_PROTOCOL
  }
  if (!process.env.OPENCODE_OTEL_RECORD_CONTENT) {
    const { ConfigOtel } = await import("./config/otel.js")
    process.env.OPENCODE_OTEL_RECORD_CONTENT = ((await ConfigOtel.recordContent()) ?? true) ? "1" : "0"
  }
  if (!process.env.OPENCODE_SERVICE_NAME) {
    process.env.OPENCODE_SERVICE_NAME = "cz-agent"
  }
}
