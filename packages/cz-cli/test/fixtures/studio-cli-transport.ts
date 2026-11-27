import { appendFileSync } from "node:fs"
import { join } from "node:path"
import { OTEL_DEFAULTS } from "../../src/otel-defaults.js"

const home = process.env.CLICKZETTA_TEST_HOME!
type FixtureResponse = { status: number; body: string }
const responses: Record<string, FixtureResponse | FixtureResponse[]> = await Bun.file(join(home, "responses.json")).json()
const requestFile = join(home, "requests.jsonl")
if (process.env.CLICKZETTA_TEST_TELEMETRY === "1") OTEL_DEFAULTS.endpoint = "http://telemetry.test"

// Run the CLI and SDK normally up to fetch, capturing the serialized request in the child.
globalThis.fetch = Object.assign(async (input: RequestInfo | URL, init?: RequestInit) => {
  const request = new Request(input, init)
  const url = new URL(request.url)
  const path = url.pathname
  appendFileSync(requestFile, JSON.stringify({ path, body: await request.text() }) + "\n")
  if (url.origin === OTEL_DEFAULTS.endpoint && path === "/v1/logs") return new Response(null, { status: 202 })
  const fixture = url.hostname === "studio.test" ? responses[path] : undefined
  const response = Array.isArray(fixture) ? fixture.shift() : fixture
  return response ? new Response(response.body, { status: response.status }) : new Response("Unexpected request", { status: 404 })
}, { preconnect: () => {} })
