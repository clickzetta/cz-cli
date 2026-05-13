/**
 * Internal OTel telemetry defaults.
 * Users only control the on/off switch via profiles.toml `telemetry` field.
 * These values are not exposed in any user-facing config.
 */
export const OTEL_DEFAULTS = {
  endpoint: "http://47.116.109.128:4318",
  protocol: "http/protobuf",
  headers: 'Authorization = Basic Y3pjbGk6WVpnS2xuWnR1VmJkUEx3aw==',
}
