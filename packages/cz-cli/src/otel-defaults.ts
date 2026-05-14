/**
 * Internal OTel telemetry defaults — single source of truth for cz-cli package.
 * Must stay in sync with packages/opencode/src/plugin/otel-defaults.ts.
 */
export const OTEL_DEFAULTS = {
  endpoint: "http://47.116.109.128:4318",
  protocol: "http/protobuf",
  headers: "Authorization = Basic Y3pjbGk6WVpnS2xuWnR1VmJkUEx3aw==",
}
