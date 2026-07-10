import { expect, test } from "bun:test"
import { execute } from "../src/execute.ts"

function firstLineJson(output: string) {
  return JSON.parse(output.trim().split("\n")[0]!)
}

test("sql substitutes ${var} from --variable", async () => {
  const result = await execute('sql "SELECT ${x} as v" --variable x=99 --sync')
  const json = firstLineJson(result.output)
  expect(result.exitCode).toBe(0)
  expect(json.error).toBeUndefined()
  expect(json.columns).toEqual(["v"])
  expect(json.rows?.[0]?.[0]).toBe(99)
})

for (const key of ["env.var", "env.var.more", "env.var.more.deep"]) {
  test(`sql substitutes dotted variable key ${key}`, async () => {
    const result = await execute(`sql "SELECT \${${key}} as v" --variable ${key}=99 --sync`)
    const json = firstLineJson(result.output)
    expect(result.exitCode).toBe(0)
    expect(json.error).toBeUndefined()
    expect(json.columns).toEqual(["v"])
    expect(json.rows?.[0]?.[0]).toBe(99)
  })
}

test("sql no longer substitutes legacy %(var)s syntax", async () => {
  const result = await execute('sql "SELECT %(x)s as v" --variable x=99 --sync')
  const json = firstLineJson(result.output)
  expect(result.exitCode).toBe(1)
  expect(json.error?.code).toBeDefined()
})
