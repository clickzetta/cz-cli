import { beforeEach, expect, test } from "bun:test"
import { join } from "node:path"
import { execute } from "../src/execute.js"
import { onFetch, requireTestHome, sqlSuccess, stubStudioContext } from "./support/cz-fixtures.js"

const submitted: unknown[] = []
beforeEach(async () => {
  submitted.length = 0
  await Bun.file(join(requireTestHome(), ".clickzetta", "profiles.toml")).write(
    "[profiles.test]\npat = 'pat'\nworkspace = 'ws0'\ninstance = 'inst'\n",
  )
  stubStudioContext()
  onFetch({ match: (url) => url.includes("/lh/submitJob"), respond: (_url, _method, body) => {
    submitted.push(body)
    return sqlSuccess([], [])
  } })
})

for (const args of [
  ["schema", "create", "demo"], ["schema", "drop", "demo"],
  ["table", "create", "CREATE TABLE demo (id INT)"], ["table", "drop", "demo"],
  ["table", "load", "demo", "czfs:/Volumes/ws0/public/v/data.csv"],
  ["fs", "mb", "czfs:/Volumes/ws0/public/v"], ["fs", "rb", "czfs:/Volumes/ws0/public/v"],
  ["fs", "rm", "/tmp/approval-test-file"],
]) {
  test(`requires approval before side effects: ${args.join(" ")}`, async () => {
    const result = await execute(args[0], args.slice(1))
    expect(result.exitCode).toBe(1)
    expect(JSON.parse(result.output)).toMatchObject({
      status: "action_required", query_kind: "write", error: { code: "WRITE_NOT_ALLOWED" },
      issues: [{ remediation: expect.stringContaining("Wait for explicit approval") }],
      next_steps: expect.any(Array),
    })
    expect(submitted).toEqual([])
  })
}

for (const args of [
  ["schema", "create", "demo"], ["schema", "drop", "demo"],
  ["table", "create", "CREATE TABLE demo (id INT)"], ["table", "drop", "demo"],
  ["fs", "mb", "czfs:/Volumes/ws0/public/v"],
]) {
  test(`approved operation executes: ${args.join(" ")}`, async () => {
    const result = await execute(args[0], [...args.slice(1), "--write"])
    expect(result.exitCode).toBe(0)
    expect(submitted.length).toBeGreaterThan(0)
  })
}

for (const format of ["text", "table", "csv", "jsonl"]) {
  test(`non-SQL approval survives ${format} formatting`, async () => {
    const result = await execute("schema", ["drop", "demo", "--format", format])
    expect(result.exitCode).toBe(1)
    expect(result.output).toContain("Wait for explicit approval")
    expect(submitted).toEqual([])
  })
}

test("table create from file requires approval before submitting SQL", async () => {
  const file = join(requireTestHome(), "create.sql")
  await Bun.file(file).write("CREATE TABLE demo (id INT)")
  const denied = await execute("table", ["create", "--from-file", file])
  expect(JSON.parse(denied.output).status).toBe("action_required")
  expect(submitted).toEqual([])
  const allowed = await execute("table", ["create", "--from-file", file, "--write"])
  expect(allowed.exitCode).toBe(0)
  expect(submitted.length).toBeGreaterThan(0)
})
