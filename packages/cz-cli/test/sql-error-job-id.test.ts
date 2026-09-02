import { beforeEach, describe, expect, test } from "bun:test"
import { onFetch, sqlFailure, sqlSuccess, stubStudioContext } from "./support/cz-fixtures.js"
import { writeFileSync } from "node:fs"
import { join } from "node:path"

// Network-boundary test: the real exec path runs (getExecContext → submitJob →
// parseJobResponse → handleFailure/emitResult) and only /lh/submitJob is stubbed.
// The job id is client-generated (commands/exec.ts:113), so the fixture reads it
// back off the submit payload and the assertion compares against that exact id.

const { execute } = await import("../src/execute.ts")

let submittedJobId: string | undefined

function firstJson(output: string) {
  return JSON.parse(output.trim().split("\n")[0] ?? "{}") as {
    error?: { code?: string; message?: string }
    job_id?: string
  }
}

function stubSubmit(respond: () => unknown) {
  onFetch({
    match: (url) => url.includes("/lh/submitJob"),
    respond: (_url, _method, body) => {
      const desc = (body as { jobDesc?: { jobId?: { id?: string } } })?.jobDesc
      submittedJobId = desc?.jobId?.id
      return respond()
    },
  })
}

beforeEach(() => {
  submittedJobId = undefined
  stubStudioContext()
  writeFileSync(
    join(process.env.CLICKZETTA_TEST_HOME!, ".clickzetta", "profiles.toml"),
    [
      'default_profile = "test"',
      "[profiles.test]",
      'pat = "pat"',
      'service = "uat-api.clickzetta.com"',
      'instance = "inst"',
      'workspace = "ws0"',
    ].join("\n"),
  )
})

describe("sql emits job_id on failure", () => {
  test("a FAILED job carries job_id alongside the error", async () => {
    stubSubmit(() =>
      sqlFailure("CZLH-42000", "CZLH-42000:[1,8] Semantic analysis exception - cannot resolve column 'aaaa'"),
    )

    const result = await execute('sql "select aaaa from t1" --sync')
    const json = firstJson(result.output)

    expect(result.exitCode).toBe(1)
    expect(json.error?.code).toBe("CZLH-42000")
    expect(submittedJobId).toBeTruthy()
    expect(json.job_id).toBe(submittedJobId!)
  })

  test("a successful job still carries the same job_id shape", async () => {
    stubSubmit(() => sqlSuccess(["a"], [[1]]))

    const result = await execute('sql "select a from t1" --sync')
    const json = firstJson(result.output)

    expect(result.exitCode).toBe(0)
    expect(json.job_id).toBe(submittedJobId!)
  })
})
