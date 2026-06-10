import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const home = mkdtempSync(join(tmpdir(), "cz-cli-sql-billing-error-"))
const profileDir = join(home, ".clickzetta")
const profileFile = join(profileDir, "profiles.toml")
let execMode: "result" | "throw" = "result"

mock.module("../src/commands/exec.js", () => ({
  SqlError: class SqlError extends Error {},
  classifyExecError: (err: unknown) => ({
    code: errorCode(err) ?? "EXEC_ERROR",
    message: err instanceof Error ? err.message : String(err),
    aiMessage: "",
  }),
  execSql: async () => insufficientBalanceResult(),
  execSqlWithRetry: async () => {
    if (execMode === "throw") throw insufficientBalanceError()
    return insufficientBalanceResult()
  },
  getExecContext: async () => ({
    config: {
      pat: "pat",
      username: "",
      password: "",
      service: "uat-api.clickzetta.com",
      protocol: "https",
      instance: "inst",
      workspace: "ws0",
      schema: "public",
      vcluster: "default",
      customHeaders: {},
    },
    token: {
      token: "token",
      instanceId: 1,
      userId: 1,
      expireTimeMs: Date.now() + 60_000,
      obtainedAt: Date.now(),
    },
    clientOpts: {
      baseUrl: "https://uat-api.clickzetta.com",
      token: "token",
      customHeaders: {},
    },
  }),
  isQueryResult: (result: unknown) => !!result && typeof result === "object" && "columns" in result,
  rowsToRecords: () => [],
  throwOnFailure: () => {},
  validateIdentifier: (name: string) => name,
}))

const { execute } = await import("../src/execute.ts")

function insufficientBalanceResult() {
  return {
    jobId: "job-billing",
    status: "FAILED",
    columns: [],
    rows: [],
    rowCount: 0,
    errorCode: "CZLH-60029",
    errorMessage: "Account yahexxxi has overdue payments. Job submission is currently restricted.",
  }
}

function insufficientBalanceError() {
  return Object.assign(
    new Error("Account yahexxxi has overdue payments. Job submission is currently restricted."),
    { code: "CZLH-60029" },
  )
}

function errorCode(err: unknown) {
  if (!err || typeof err !== "object" || !("code" in err)) return undefined
  const code = (err as { code?: unknown }).code
  return typeof code === "string" ? code : undefined
}

function firstJson(output: string) {
  return JSON.parse(output.trim().split("\n")[0] ?? "{}") as {
    error?: { code?: string; message?: string }
  }
}

beforeEach(() => {
  mkdirSync(profileDir, { recursive: true })
  process.env.CLICKZETTA_TEST_HOME = home
  delete process.env.CZ_PROFILE
  execMode = "result"
})

afterAll(() => {
  delete process.env.CLICKZETTA_TEST_HOME
  delete process.env.CZ_PROFILE
  rmSync(home, { recursive: true, force: true })
})

describe("sql insufficient balance errors", () => {
  test("uses profile accounts_url when configured", async () => {
    writeFileSync(
      profileFile,
      [
        'default_profile = "test"',
        "[profiles.test]",
        'pat = "pat"',
        'service = "uat-api.clickzetta.com"',
        'accounts_url = "https://xxjrdhjr.accounts.clickzetta.com/"',
      ].join("\n"),
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
      profileFile,
      [
        'default_profile = "test"',
        "[profiles.test]",
        'pat = "pat"',
        'service = "uat-api.clickzetta.com"',
      ].join("\n"),
    )

    const result = await execute('sql "SELECT 1 AS test" --sync')
    const json = firstJson(result.output)

    expect(result.exitCode).toBe(1)
    expect(json.error).toEqual({
      code: "CZLH-60029",
      message: "Account yahexxxi has overdue payments. Job submission is currently restricted.",
    })
  })

  test("does not infer accounts url from the server error account name or profile name", async () => {
    writeFileSync(
      profileFile,
      [
        'default_profile = "test"',
        "[profiles.test]",
        'pat = "pat"',
        'service = "uat-api.clickzetta.com"',
      ].join("\n"),
    )

    const result = await execute('sql "SELECT 1 AS test" --sync')
    const json = firstJson(result.output)

    expect(result.exitCode).toBe(1)
    expect(json.error).toEqual({
      code: "CZLH-60029",
      message: "Account yahexxxi has overdue payments. Job submission is currently restricted.",
    })
  })

  test("wraps classified billing errors in table output", async () => {
    execMode = "throw"
    writeFileSync(
      profileFile,
      [
        'default_profile = "test"',
        "[profiles.test]",
        'pat = "pat"',
        'service = "uat-api.clickzetta.com"',
      ].join("\n"),
    )

    const result = await execute('sql --format table "SELECT 1 AS test"')

    expect(result.exitCode).toBe(1)
    expect(result.output).toContain("ERROR CZLH-60029: Account yahexxxi has overdue payments. Job submission is currently restricted.")
  })
})
