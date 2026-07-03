/**
 * Internal OTel telemetry defaults — single source of truth for cz-cli package.
 *
 * `endpoint` and `headers` are injected at build time via Bun's `define`
 * (see packages/opencode/script/build.ts). Source-controlled defaults are empty
 * so the public repository never carries collector credentials. When both are
 * empty the telemetry pipeline short-circuits.
 */
declare global {
  const CLICKZETTA_OTEL_ENDPOINT: string
  const CLICKZETTA_OTEL_HEADERS: string
}

export const OTEL_DEFAULTS = {
  endpoint: typeof CLICKZETTA_OTEL_ENDPOINT === "string" ? CLICKZETTA_OTEL_ENDPOINT : "",
  protocol: "http/protobuf",
  headers: typeof CLICKZETTA_OTEL_HEADERS === "string" ? CLICKZETTA_OTEL_HEADERS : "",
}
