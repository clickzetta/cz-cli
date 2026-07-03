import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const home = mkdtempSync(join(tmpdir(), "cz-cli-use-validation-"))
const profileDir = join(home, ".clickzetta")
const profileFile = join(profileDir, "profiles.toml")

const execCalls: string[] = []

mock.module("../src/commands/exec.js", () => ({
  SqlError: class SqlError extends Error {},
  classifyExecError: (err: unknown) => ({
    code: "EXEC_ERROR",
    message: err instanceof Error ? err.message : String(err),
    aiMessage: "",
  }),
  execSql: async (_ctx: unknown, sql: string) => {
    execCalls.push(sql)
    return execSqlResult(sql)
  },
  execSqlWithRetry: async (_ctx: unknown, sql: string) => {
    execCalls.push(sql)
    return execSqlResult(sql)
  },
  getExecContext: async () => ({
    config: {
      pat: "pat",
      username: "",
      password: "",
      service: "dev-api.clickzetta.com",
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
      baseUrl: "https://dev-api.clickzetta.com",
      token: "token",
      customHeaders: {},
    },
  }),
  isQueryResult: (result: unknown) => !!result && typeof result === "object" && "columns" in result,
  rowsToRecords: (result: { columns: Array<{ name: string }>; rows: unknown[][] }) =>
    result.rows.map((row) => Object.fromEntries(result.columns.map((column, index) => [column.name, row[index]]))),
  throwOnFailure: () => {},
  validateIdentifier: (name: string) => name,
}))

const { execute } = await import("../src/execute.ts")

function execSqlResult(sql: string) {
  if (sql === "DESC SCHEMA missing_schema") {
    return {
      jobId: "job-schema-missing",
      status: "FAILED",
      columns: [],
      rows: [],
      rowCount: 0,
      errorCode: "CZLH-SCHEMA",
      errorMessage: "Schema 'missing_schema' does not exist.",
    }
  }
  if (sql === "DESC SCHEMA analytics") {
    return {
      jobId: "job-schema-ok",
      status: "SUCCEEDED",
      columns: [],
      rows: [],
      rowCount: 0,
    }
  }
  if (sql === "SHOW VCLUSTERS") {
    return {
      jobId: "job-vclusters",
      status: "SUCCEEDED",
      columns: [{ name: "vcluster_name" }],
      rows: [["default"], ["analytics"]],
      rowCount: 2,
    }
  }
  if (sql === "SELECT 1" || sql === "SELECT 1 LIMIT 101") {
    return {
      jobId: "job-select",
      status: "SUCCEEDED",
      columns: [{ name: "v" }],
      rows: [[1]],
      rowCount: 1,
    }
  }
  throw new Error(`unexpected SQL: ${sql}`)
}

function firstJson(output: string) {
  return JSON.parse(output.trim().split("\n")[0] ?? "{}") as Record<string, unknown>
}

beforeEach(() => {
  execCalls.length = 0
  mkdirSync(profileDir, { recursive: true })
  writeFileSync(profileFile, "[profiles.test]\npat = 'pat'\n")
  process.env.CLICKZETTA_TEST_HOME = home
})

afterAll(() => {
  delete process.env.CLICKZETTA_TEST_HOME
  rmSync(home, { recursive: true, force: true })
})

describe("sql USE validation", () => {
  test("USE SCHEMA fails when the schema does not exist", async () => {
    const result = await execute('sql "USE SCHEMA missing_schema" --sync')
    const json = firstJson(result.output)

    expect(result.exitCode).toBe(1)
    expect(json).toEqual({
      error: {
        code: "CZLH-SCHEMA",
        message: "Schema 'missing_schema' does not exist.",
      },
    })
    expect(execCalls).toEqual(["DESC SCHEMA missing_schema"])
  })

  test("USE VCLUSTER fails before later statements run when the vcluster does not exist", async () => {
    const result = await execute('sql "USE VCLUSTER missing_vc; SELECT 1" --sync')
    const json = firstJson(result.output)

    expect(result.exitCode).toBe(1)
    expect(json).toEqual({
      error: {
        code: "VCLUSTER_NOT_FOUND",
        message: "Vcluster 'missing_vc' does not exist.",
      },
    })
    expect(execCalls).toEqual(["SHOW VCLUSTERS"])
  })

  test("USE SCHEMA validates then allows later statements to run", async () => {
    const result = await execute('sql "USE SCHEMA analytics; SELECT 1" --sync')
    const json = firstJson(result.output)

    expect(result.exitCode).toBe(0)
    expect(json).toEqual({
      columns: ["v"],
      rows: [[1]],
      count: 1,
      time_ms: expect.any(Number),
      job_id: "job-select",
    })
    expect(execCalls).toEqual(["DESC SCHEMA analytics", "SELECT 1 LIMIT 101"])
  })

  test("MERGE is treated as a write operation and requires --write", async () => {
    const result = await execute('sql "MERGE INTO target USING source ON target.id=source.id WHEN MATCHED THEN UPDATE SET v=source.v" --sync')
    const json = firstJson(result.output)

    expect(result.exitCode).toBe(1)
    expect(json).toEqual({
      ai_message: "Add --write flag to execute write operations: cz-cli sql \"<SQL>\" --write",
      error: {
        code: "WRITE_NOT_ALLOWED",
        message: "Write operation detected. Pass --write to confirm.",
      },
    })
    expect(execCalls).toEqual([])
  })
})
