import { appendFileSync } from "node:fs"
import { join } from "node:path"

const home = process.env.CLICKZETTA_TEST_HOME!
const responses: Record<string, { status: number; body: string }> = await Bun.file(join(home, "responses.json")).json()
const requestFile = join(home, "requests.jsonl")

// Run the CLI and SDK normally up to fetch, capturing the serialized request in the child.
globalThis.fetch = Object.assign(async (input: RequestInfo | URL, init?: RequestInit) => {
  const request = new Request(input, init)
  const url = new URL(request.url)
  const path = url.pathname
  appendFileSync(requestFile, JSON.stringify({ path, body: await request.text() }) + "\n")
  const response = url.hostname === "studio.test" ? responses[path] : undefined
  return response ? new Response(response.body, { status: response.status }) : new Response("Unexpected request", { status: 404 })
}, { preconnect: () => {} })
