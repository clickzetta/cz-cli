import { beforeEach, describe, expect, test } from "bun:test"
import { writeFileSync } from "node:fs"
import { join } from "node:path"
import { onFetch, sqlSuccess, sqlFailure, stubStudioContext } from "./support/cz-fixtures.js"

/**
 * `cz-cli status` reports its OUTCOME in the exit code: 0 when the connection
 * works, non-zero when it does not, the way pg_isready does. It used to exit 0
 * either way, so `cz-cli status && <next step>` continued over a dead connection.
 *
 * The payload shape is deliberately unchanged in both cases — `connected` plus the
 * reason is the answer to "what is the status", not a failure to answer it — which
 * is why these assert on the data envelope and the code independently.
 *
 * Network-boundary test: the real command runs (execute → status → getExecContext →
 * SDK → fetch); only /lh/submitJob is canned.
 */

const { execute } = await import("../src/execute.ts")

function firstJson(output: string) {
  return JSON.parse(output.trim().split("\n")[0] ?? "{}") as Record<string, any>
}

function stubStatusQueries(mode: "ok" | "fail") {
  onFetch({
    match: (url) => url.includes("/lh/submitJob"),
    respond: (_url, _method, body) => {
      const sql = ((body as { jobDesc?: { sqlJob?: { query?: string[] } } })?.jobDesc?.sqlJob?.query?.[0] ?? "").trim()
      if (mode === "fail") return sqlFailure("CZLH-0000", "workspace is not available")
      if (sql.includes("current_workspace")) return sqlSuccess(["ws"], [["ws0"]])
      if (sql.includes("current_schema")) return sqlSuccess(["sc"], [["public"]])
      return sqlFailure("EXEC_ERROR", `unexpected SQL: ${sql}`)
    },
  })
}

beforeEach(() => {
  writeFileSync(
    join(process.env.CLICKZETTA_TEST_HOME!, ".clickzetta", "profiles.toml"),
    "[profiles.test]\npat = 'pat'\nworkspace = 'ws0'\ninstance = 'inst'\n",
  )
  stubStudioContext()
})

describe("status exit code", () => {
  test("a working connection exits 0 and reports what it found", async () => {
    stubStatusQueries("ok")
    const result = await execute("status")
    expect(result.exitCode).toBe(0)
    const json = firstJson(result.output)
    expect(json.data.connected).toBe(true)
    expect(json.data.workspace).toBe("ws0")
    expect(json.data.schema).toBe("public")
    expect(json.error).toBeUndefined()
  })

  test("a failing connection exits 1 and still describes itself", async () => {
    stubStatusQueries("fail")
    const result = await execute("status")
    expect(result.exitCode).toBe(1)
    const json = firstJson(result.output)
    expect(json.data.connected).toBe(false)
    expect(typeof json.data.error).toBe("string")
  })

  test("the row formats show the same outcome without an ERROR line", async () => {
    stubStatusQueries("ok")
    const result = await execute("status --format text")
    expect(result.exitCode).toBe(0)
    expect(result.output).not.toContain("ERROR")
    expect(result.output.split("\t")[0]).toBe("true")
  })
})
