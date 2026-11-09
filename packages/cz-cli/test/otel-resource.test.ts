/**
 * The agent path's resource. One object reaches the logger, the tracer AND the meter
 * (opencode-plugin/otel/setup.ts:45-65), so every attribute here lands on all three signals.
 *
 * service.version was `InstallationVersion` — "local" in every build, because this code
 * ships in a runtime asset bundled without the binary's OPENCODE_VERSION define — which left
 * cz-agent traces, logs and metrics with no version to segment a release by.
 * Run: bun test test/otel-resource.test.ts
 */
import { expect, test } from "bun:test"
import { otelResourceAttributes } from "../src/opencode-plugin/otel/resource.ts"

test("the resource names the service, its cz-cli version, and the client", () => {
  expect(
    otelResourceAttributes({ serviceName: "cz-agent", version: "2.0.6", client: "cli" }),
  ).toEqual({
    "service.name": "cz-agent",
    "service.version": "2.0.6",
    "opencode.client": "cli",
  })
})

test("no identity on the resource — it is immutable and per-record on both signals", () => {
  const attributes = otelResourceAttributes({ version: "2.0.6" })
  expect(Object.keys(attributes)).toEqual(["service.name", "service.version", "opencode.client"])
  expect(attributes["enduser.id"]).toBeUndefined()
})

test("falls back the way the plugin did, and never reports a bare opencode version", () => {
  const attributes = otelResourceAttributes({ version: "0.0.0-dev+1" })
  expect(attributes["service.name"]).toBe("opencode")
  expect(attributes["opencode.client"]).toBe("unknown")
  expect(attributes["opencode.version"]).toBeUndefined()
})

test("OPENCODE_RESOURCE_ATTRIBUTES overrides, including the defaults, and skips junk", () => {
  expect(
    otelResourceAttributes({
      serviceName: "cz-agent",
      version: "2.0.6",
      client: "cli",
      overrides: "deployment.environment.name=stable,service.version=pinned,broken,=novalue",
    }),
  ).toEqual({
    "service.name": "cz-agent",
    "service.version": "pinned",
    "opencode.client": "cli",
    "deployment.environment.name": "stable",
  })
})

/**
 * A source build has no CLICKZETTA_VERSION define, so VERSION carries a per-minute timestamp.
 * On the resource that would be a new time series per process; it used to be the constant
 * "local" via InstallationVersion, and dev traffic should still aggregate.
 */
test("a dev version collapses to a stable sentinel instead of a per-minute series", () => {
  const first = otelResourceAttributes({ version: "0.0.0-dev+202609141503" })
  const second = otelResourceAttributes({ version: "0.0.0-dev+202609141504" })
  expect(first["service.version"]).toBe("local")
  expect(second["service.version"]).toBe(first["service.version"])
  expect(otelResourceAttributes({ version: "2.0.6" })["service.version"]).toBe("2.0.6")
})
