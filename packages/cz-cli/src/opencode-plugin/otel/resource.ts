/**
 * The agent path's OTLP Resource — the entity producing the telemetry, and nothing else.
 *
 * Split out of index.ts so it can be tested without booting the plugin: the resource is
 * handed to the LoggerProvider, the TracerProvider AND the MeterProvider (setup.ts), so a
 * wrong value here lands on all three signals at once and nothing in the suite would notice.
 *
 * `service.version` used to read core's `InstallationVersion`. That is
 * `typeof OPENCODE_VERSION === "string" ? OPENCODE_VERSION : "local"`, and this module ships
 * inside the plugin runtime asset, which is bundled separately from the binary and so never
 * saw the binary's `define` block — the value was therefore the constant "local" in every
 * build, released or not. It is the cz-cli version now: it has to describe the service that
 * `service.name` names. There is no separate upstream version worth recording here — the
 * binary's own `OPENCODE_VERSION` define is also fed `Script.version`, so reporting it under
 * a second key would either duplicate this one or, in this bundle, report "local" again.
 */
export function otelResourceAttributes(input: {
  serviceName?: string
  version: string
  client?: string
  /** OPENCODE_RESOURCE_ATTRIBUTES, `k=v,k=v`. Wins over the defaults above, as before. */
  overrides?: string
}): Record<string, string> {
  const attributes: Record<string, string> = {
    "service.name": input.serviceName || "opencode",
    "service.version": input.version,
    "opencode.client": input.client ?? "unknown",
  }
  for (const pair of input.overrides?.split(",") ?? []) {
    const eqIdx = pair.indexOf("=")
    if (eqIdx > 0) attributes[pair.slice(0, eqIdx)] = pair.slice(eqIdx + 1)
  }
  return attributes
}
