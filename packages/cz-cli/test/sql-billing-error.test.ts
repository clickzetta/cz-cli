import { beforeEach, describe, expect, test } from "bun:test"
import { onFetch, stubStudioContext } from "./support/cz-fixtures.js"
import { writeFileSync } from "node:fs"
import { join } from "node:path"

// Network-boundary test: no mock.module of ../src/commands/exec. The real exec path runs
// (getExecContext → submitJob) and only the network boundary is stubbed: the SQL
// job submit (/lh/submitJob) returns a FAILED status carrying the CZLH-60029
// billing error, so the real billing/accounts-url formatting logic is exercised.
// HOME/profile isolated by test/preload.ts.

let execMode: "result" | "throw" = "result"
const BILLING_MSG = "Account yahexxxi has overdue payments. Job submission is currently restricted."

const { execute } = await import("../src/execute.ts")

function firstJson(output: string) {
  return JSON.parse(output.trim().split("\n")[0] ?? "{}") as {
    error?: { code?: string; message?: string }
  }
}

function profilesToml(extra: string[] = []) {
  return [
    'default_profile = "test"',
    "[profiles.test]",
    'pat = "pat"',
    'service = "uat-api.clickzetta.com"',
    'instance = "inst"',
    'workspace = "ws0"',
    ...extra,
  ].join("\n")
}

beforeEach(() => {
  execMode = "result"
  // pat login is stubbed via stubStudioContext (loginSingle). getExecContext only
  // needs a token, then submitJob is where the billing failure surfaces.
  stubStudioContext()
  onFetch({
    match: (url) => url.includes("/lh/submitJob"),
    respond: () => ({
      status: { state: "FAILED", errorCode: "CZLH-60029", errorMessage: BILLING_MSG },
    }),
  })
})

describe("sql insufficient balance errors", () => {
  test("uses profile accounts_url when configured", async () => {
    writeFileSync(
      join(process.env.CLICKZETTA_TEST_HOME!, ".clickzetta", "profiles.toml"),
      profilesToml(['accounts_url = "https://xxjrdhjr.accounts.clickzetta.com/"']),
    )

    const result = await execute('sql "SELECT 1 AS test" --sync')
    const json = firstJson(result.output)

    expect(result.exitCode).toBe(1)
    expect(json.error).toEqual({
      code: "CZLH-60029",
      message: "Insufficient account balance. Please visit https://xxjrdhjr.accounts.clickzetta.com to add funds.",
    })
  })

  test("infers accounts url from runtime account display name and service", async () => {
    writeFileSync(
      join(process.env.CLICKZETTA_TEST_HOME!, ".clickzetta", "profiles.toml"),
      profilesToml(),
    )

    const result = await execute('sql "SELECT 1 AS test" --sync')
    const json = firstJson(result.output)

    expect(result.exitCode).toBe(1)
    expect(json.error).toEqual({
      code: "CZLH-60029",
      message: BILLING_MSG,
    })
  })

  test("does not infer accounts url from the server error account name or profile name", async () => {
    writeFileSync(
      join(process.env.CLICKZETTA_TEST_HOME!, ".clickzetta", "profiles.toml"),
      profilesToml(),
    )

    const result = await execute('sql "SELECT 1 AS test" --sync')
    const json = firstJson(result.output)

    expect(result.exitCode).toBe(1)
    expect(json.error).toEqual({
      code: "CZLH-60029",
      message: BILLING_MSG,
    })
  })

  test("wraps classified billing errors in table output", async () => {
    writeFileSync(
      join(process.env.CLICKZETTA_TEST_HOME!, ".clickzetta", "profiles.toml"),
      profilesToml(),
    )

    const result = await execute('sql --format table "SELECT 1 AS test"')

    expect(result.exitCode).toBe(1)
    expect(result.output).toContain("ERROR CZLH-60029: " + BILLING_MSG)
  })
})
