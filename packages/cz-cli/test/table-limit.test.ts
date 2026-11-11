import { beforeEach, expect, test } from "bun:test"
import { join } from "node:path"
import { execute } from "../src/execute.js"
import { onFetch, requireTestHome, sqlSuccess, stubStudioContext } from "./support/cz-fixtures.js"

const submitted: string[] = []
const total = 150
beforeEach(async () => {
  submitted.length = 0
  await Bun.file(join(requireTestHome(), ".clickzetta", "profiles.toml")).write(
    "[profiles.test]\npat = 'pat'\nworkspace = 'ws0'\ninstance = 'inst'\n",
  )
  stubStudioContext()
  onFetch({ match: (url) => url.includes("/lh/submitJob"), respond: (_url, _method, body) => {
    const sql = JSON.stringify(body)
    submitted.push(sql)
    const n = Number(/LIMIT (\d+)/.exec(sql)?.[1] ?? total)
    const count = Math.min(n, total)
    if (sql.includes("SELECT * FROM")) return sqlSuccess(["id"], Array.from({ length: count }, (_, i) => [i]))
    if (sql.includes("HISTORY")) {
      return sqlSuccess(["schema_name", "table_name"], Array.from({ length: count }, (_, i) => ["public", `t${i}`]))
    }
    return sqlSuccess(["table_name"], Array.from({ length: count }, (_, i) => [`t${i}`]))
  } })
})

const cases = [
  { name: "list", args: ["list"], defaultRows: 100 },
  { name: "history", args: ["history"], defaultRows: 100 },
  { name: "preview", args: ["preview", "demo"], defaultRows: 10 },
]

for (const c of cases) {
  for (const flag of [["--limit", "0"], ["--no-limit"]]) {
    test(`table ${c.name} ${flag.join(" ")} is unlimited`, async () => {
      const result = await execute("table", [...c.args, ...flag])
      expect(result.exitCode).toBe(0)
      expect(submitted.join("")).not.toMatch(/LIMIT/)
      expect(result.output).not.toContain("truncated")
      expect(result.output).not.toContain("limited to")
      expect(result.output).toContain(c.name === "preview" ? "[149]" : "t149")
    })
  }

  test(`table ${c.name} keeps default limit`, async () => {
    const result = await execute("table", c.args)
    expect(result.exitCode).toBe(0)
    expect(submitted.join("")).toContain(`LIMIT ${c.name === "preview" ? 10 : 101}`)
    expect(result.output).not.toContain(c.name === "preview" ? "[149]" : "t149")
  })

  test(`table ${c.name} honors explicit limit`, async () => {
    const result = await execute("table", [...c.args, "--limit", "5"])
    expect(result.exitCode).toBe(0)
    expect(submitted.join("")).toContain(`LIMIT ${c.name === "preview" ? 5 : 6}`)
  })

  test(`table ${c.name} rejects negative limit`, async () => {
    const result = await execute("table", [...c.args, "--limit", "-3"])
    expect(result.exitCode).toBe(2)
    expect(result.output).toContain("USAGE_ERROR")
    expect(submitted).toEqual([])
  })
}
