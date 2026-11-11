import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { writeFileSync } from "node:fs"
import { join } from "node:path"
import { onFetch } from "./support/cz-fixtures.js"

// Network-boundary test: the real command runs; only globalThis.fetch is stubbed.
const { execute } = await import("../src/execute.ts")

const calls: string[] = []
let status = 200
let responseBody: unknown = { success: true, data: { ok: 1 } }

function firstJson(output: string) {
  return JSON.parse(output.trim().split("\n")[0] ?? "{}") as Record<string, any>
}

beforeEach(() => {
  calls.length = 0
  status = 200
  responseBody = { success: true, data: { ok: 1 } }
  process.env.CZ_OPENAPI_AK = "ak-test"
  process.env.CZ_OPENAPI_SK = "sk-test"
  // No workspace and no credential: AK/SK alone must be enough.
  writeFileSync(
    join(process.env.CLICKZETTA_TEST_HOME!, ".clickzetta", "profiles.toml"),
    "[profiles.test]\nservice = 'api.test.invalid'\ninstance = 'inst'\n",
  )
  onFetch({
    match: () => true,
    respond: (url) => {
      calls.push(url)
      return new Response(typeof responseBody === "string" ? responseBody : JSON.stringify(responseBody), { status })
    },
  })
})

afterEach(() => {
  delete process.env.CZ_OPENAPI_AK
  delete process.env.CZ_OPENAPI_SK
  process.exitCode = 0
})

describe("task cdc openapi", () => {
  test("200 succeeds without a Studio login or workspace", async () => {
    const r = await execute("task cdc openapi /openapi/v2/realtime/getTableSyncStatus --body {}")
    expect(r.exitCode).toBe(0)
    expect(firstJson(r.output).data).toMatchObject({ http_status: 200, response: { success: true } })
    expect(calls).toHaveLength(1)
    expect(new URL(calls[0]!).origin + new URL(calls[0]!).pathname).toBe(
      "https://api.test.invalid/openapi/v2/realtime/getTableSyncStatus",
    )
  })

  test.each([401, 502])("HTTP %d exits non-zero with the response", async (code) => {
    status = code
    responseBody = code === 401 ? { code: "InvalidSignature" } : "bad gateway"
    const r = await execute("task cdc openapi /openapi/v2/realtime/getTableSyncStatus --body {}")
    expect(r.exitCode).not.toBe(0)
    const j = firstJson(r.output)
    expect(j.error?.code).toBe("OPENAPI_HTTP_ERROR")
    expect(j.data).toMatchObject({ http_status: code, response: responseBody })
  })
})
