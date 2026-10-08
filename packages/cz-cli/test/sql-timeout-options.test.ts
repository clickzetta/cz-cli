import { beforeEach, expect, test } from "bun:test"
import { join } from "node:path"
import { onFetch, requireTestHome, sqlSuccess, stubStudioContext } from "./support/cz-fixtures.js"

const { execute } = await import("../src/execute.ts")
const timeouts: (number | undefined)[] = []
beforeEach(async () => {
  timeouts.length = 0
  stubStudioContext()
  await Bun.file(join(requireTestHome(), ".clickzetta", "profiles.toml")).write(
    'default_profile = "test"\n[profiles.test]\npat = "pat"\nworkspace = "ws0"\ninstance = "inst"\n',
  )
  onFetch({
    match: (url) => url.includes("/lh/submitJob"),
    respond: (_url, _method, body) => {
      timeouts.push((body as { jobDesc: { jobTimeoutMs?: number } }).jobDesc.jobTimeoutMs)
      return sqlSuccess(["v"], [[1]])
    },
  })
})

for (const mode of ["--sync", "--async"]) {
  for (const timeout of ["0", "-1", "NaN", "Infinity"]) {
    test(`sql ${mode} rejects --timeout ${timeout} before submission`, async () => {
      const result = await execute("sql", ["select 1", mode, "--timeout", timeout])
      expect(result.exitCode).not.toBe(0)
      expect(result.output).toContain("--timeout")
      expect(timeouts).toEqual([])
    })
  }
  test(`sql ${mode} propagates explicit timeout to the server`, async () => {
    const result = await execute("sql", ["select 1", mode, "--timeout", "12"])
    expect(result.exitCode).toBe(0)
    expect(timeouts).toEqual([12000])
  })
}

for (const command of ["table list", "schema list"]) {
  test(`${command} does not acquire a new default five-minute timeout`, async () => {
    const result = await execute(command)
    expect(result.exitCode).toBe(0)
    expect(timeouts.length).toBeGreaterThan(0)
    expect(timeouts.every((value) => value === undefined)).toBe(true)
  })
}

test("sql --async without --timeout leaves the detached job on the deployment timeout", async () => {
  const result = await execute("sql", ["select 1", "--async"])
  expect(result.exitCode).toBe(0)
  expect(timeouts).toEqual([undefined])
})

test("sql --job-profile ignores an unused --timeout", async () => {
  onFetch({ match: (url) => url.includes("/lh/getJob"), respond: () => Response.json({ status: { state: "SUCCEED" } }) })
  const result = await execute("sql", ["--job-profile", "job1", "--timeout", "0"])
  expect(result.exitCode).toBe(0)
})
