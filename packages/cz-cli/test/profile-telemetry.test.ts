import { afterEach, beforeEach, expect, test } from "bun:test"
import { mkdtemp, mkdir, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { ConnectionEnv } from "../src/connection/env.js"
import { saveProfiles, setDefaultProfile } from "../src/connection/profile-store.js"
import { profileTelemetryAttributes } from "../src/connection/telemetry.js"
import { trackCommand } from "../src/telemetry.js"
import { OTEL_DEFAULTS } from "../src/otel-defaults.js"

let home = ""
let previousHome: string | undefined
let previousProfile: string | undefined
const endpoint = OTEL_DEFAULTS.endpoint

beforeEach(async () => {
  previousHome = process.env.CLICKZETTA_TEST_HOME
  previousProfile = ConnectionEnv.profileName()
  home = await mkdtemp(path.join(os.tmpdir(), "cz-profile-telemetry-"))
  process.env.CLICKZETTA_TEST_HOME = home
  await mkdir(path.join(home, ".clickzetta"))
  ConnectionEnv.unpin()
  saveProfiles({
    first: { user_id: 11, instance: "first-instance" },
    "second.profile": {
      user_id: 22,
      instance: "second-instance",
      workspace: "ws",
      service: "https://example.test",
      pat: "secret",
    },
    empty: {},
  })
  setDefaultProfile("first")
})

afterEach(async () => {
  if (previousHome === undefined) delete process.env.CLICKZETTA_TEST_HOME
  else process.env.CLICKZETTA_TEST_HOME = previousHome
  if (previousProfile === undefined) ConnectionEnv.unpin()
  else ConnectionEnv.pin(previousProfile)
  OTEL_DEFAULTS.endpoint = endpoint
  await rm(home, { recursive: true, force: true })
})

test("active profile overrides the default, including quoted TOML profile names", () => {
  ConnectionEnv.pin("second.profile")
  expect(profileTelemetryAttributes()).toEqual({
    "enduser.id": "22",
    "instance.name": "second-instance",
    "workspace.name": "ws",
    "service.url": "https://example.test",
  })
})

test("profile switches and file updates are reflected without retaining previous identity", () => {
  expect(profileTelemetryAttributes()["enduser.id"]).toBe("11")
  ConnectionEnv.pin("second.profile")
  expect(profileTelemetryAttributes()["enduser.id"]).toBe("22")
  saveProfiles({ "second.profile": { user_id: 33 } })
  expect(profileTelemetryAttributes()).toEqual({ "enduser.id": "33" })
  ConnectionEnv.pin("missing")
  expect(profileTelemetryAttributes()).toEqual({})
})

test("missing profile fields stay absent", () => {
  ConnectionEnv.pin("empty")
  expect(profileTelemetryAttributes()).toEqual({})
})

/**
 * Identity belongs to the log RECORD, and appears once in the payload.
 *
 * It used to be merged into `resource.attributes`, where the OTel resource spec says only
 * the producing service goes: every (user, instance, workspace) triple then looked like a
 * separate service instance downstream, and the trace path (which puts the same attributes
 * on the span) disagreed with the log path about where to read identity from.
 */
test("command export puts the active profile identity on the log record, exactly once", async () => {
  ConnectionEnv.pin("second.profile")
  const received: unknown[] = []
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      received.push(await request.json())
      return new Response(null, { status: 202 })
    },
  })
  OTEL_DEFAULTS.endpoint = server.url.toString().replace(/\/$/, "")
  try {
    await trackCommand({ command: "sql", success: true, duration_ms: 1 })
    expect(received).toHaveLength(1)

    // Serialise BEFORE toMatchObject: bun substitutes the expected matchers INTO the
    // received object, so a string assertion afterwards reads the expectation back rather
    // than the payload — which is how a first draft of this test "proved" a key it had
    // itself just written in.
    const payload = JSON.stringify(received)
    expect(payload.match(/"enduser\.id"/g)).toHaveLength(1)
    expect(payload).not.toContain("secret")

    expect(received[0]).toMatchObject({
      resourceLogs: [
        {
          resource: {
            attributes: [
              { key: "service.name", value: { stringValue: "cz-cli" } },
              { key: "service.version", value: { stringValue: expect.any(String) } },
            ],
          },
          scopeLogs: [
            {
              logRecords: [
                {
                  attributes: expect.arrayContaining([
                    { key: "enduser.id", value: { stringValue: "22" } },
                    { key: "instance.name", value: { stringValue: "second-instance" } },
                    { key: "workspace.name", value: { stringValue: "ws" } },
                    { key: "service.url", value: { stringValue: "https://example.test" } },
                  ]),
                },
              ],
            },
          ],
        },
      ],
    })
  } finally {
    await server.stop(true)
  }
})
