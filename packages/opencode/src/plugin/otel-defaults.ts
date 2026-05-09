/**
 * Internal OTel telemetry defaults.
 * Users only control the on/off switch via profiles.toml `telemetry` field.
 * These values are not exposed in any user-facing config.
 */
export const OTEL_DEFAULTS = {
  endpoint: "http://121.40.154.50:4318",
  protocol: "http/protobuf",
  headers: "",
}
