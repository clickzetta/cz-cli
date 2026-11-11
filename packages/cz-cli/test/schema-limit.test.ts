import { beforeEach, expect, test } from "bun:test"
import { join } from "node:path"
import { execute } from "../src/execute.js"
import { onFetch, requireTestHome, sqlSuccess, stubStudioContext } from "./support/cz-fixtures.js"

const submitted: string[] = []
beforeEach(async () => {
  submitted.length = 0
  await Bun.file(join(requireTestHome(), ".clickzetta", "profiles.toml")).write(
    "[profiles.test]\npat = 'pat'\nworkspace = 'ws0'\ninstance = 'inst'\n",
  )
  stubStudioContext()
  onFetch({ match: (url) => url.includes("/lh/submitJob"), respond: (_url, _method, body) => {
    submitted.push(JSON.stringify(body))
    return sqlSuccess(["schema_name", "type"], Array.from({ length: 150 }, (_, i) => [`s${i}`, "MANAGED"]))
  } })
})

for (const flag of [["--limit", "0"], ["--no-limit"]]) {
  test(`schema list ${flag.join(" ")} returns all schemas`, async () => {
    const result = await execute("schema", ["list", ...flag])
    expect(result.exitCode).toBe(0)
    expect(result.output).toContain("s149")
    expect(result.output).not.toContain("limited to")
  })
}

test("schema list keeps default and explicit limits", async () => {
  const dflt = await execute("schema", ["list"])
  expect(dflt.output).toContain("s99")
  expect(dflt.output).not.toContain("s100")
  const explicit = await execute("schema", ["list", "--limit", "5"])
  expect(explicit.output).toContain("s4")
  expect(explicit.output).not.toContain("s5\"")
})

test("schema list rejects negative limit before submitting", async () => {
  const result = await execute("schema", ["list", "--limit", "-2"])
  expect(result.exitCode).toBe(2)
  expect(result.output).toContain("USAGE_ERROR")
  expect(submitted).toEqual([])
})
