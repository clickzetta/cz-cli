import { describe, expect, test } from "bun:test"
import { parseTableProperties } from "../src/commands/table.ts"

describe("parseTableProperties", () => {
  test("parses a single __metadata property and JSON-decodes its value", () => {
    const raw = `(("__metadata",'{"owner":"data_team","steward":"张三","arr":["a","b"]}'))`
    const props = parseTableProperties(raw)
    expect(props).toEqual({
      __metadata: { owner: "data_team", steward: "张三", arr: ["a", "b"] },
    })
  })

  test("parses multiple properties with mixed quoting", () => {
    const raw = `(("__metadata",'{"k":"v","n":1}'),("owner","alice"))`
    const props = parseTableProperties(raw)
    expect(props).toEqual({
      __metadata: { k: "v", n: 1 },
      owner: "alice",
    })
  })

  test("keeps non-JSON string values as-is", () => {
    const raw = `(("owner","alice"),("team","sales"))`
    expect(parseTableProperties(raw)).toEqual({ owner: "alice", team: "sales" })
  })

  test("returns null for empty or non-tuple input", () => {
    expect(parseTableProperties("")).toBeNull()
    expect(parseTableProperties("()")).toBeNull()
    expect(parseTableProperties("not a tuple")).toBeNull()
  })

  test("handles values containing commas and colons inside JSON", () => {
    const raw = `(("__metadata",'{"sla":"09:00_daily","src":["MySQL:fact_sales","DataSync, Pipeline"]}'))`
    const props = parseTableProperties(raw)
    expect(props).toEqual({
      __metadata: { sla: "09:00_daily", src: ["MySQL:fact_sales", "DataSync, Pipeline"] },
    })
  })
})
