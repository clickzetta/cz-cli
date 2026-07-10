import { describe, it, expect } from "bun:test"
import { tableFromArrays, tableToIPC, Utf8, Int32, Float64 } from "apache-arrow"
import { decodeArrowPayload } from "../src/sql/arrow.js"

function encodeTable(data: {
  id: Int32Array
  name: string[]
  score: Float64Array
}): string {
  const table = tableFromArrays(data)
  const bytes = tableToIPC(table, "stream")
  // base64 via Buffer (Node/Bun)
  let bin = ""
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!)
  return btoa(bin)
}

describe("decodeArrowPayload (query_result.py:57-80)", () => {
  it("round-trips a small table", () => {
    const b64 = encodeTable({
      id: new Int32Array([1, 2, 3]),
      name: ["a", "b", "c"],
      score: new Float64Array([1.5, 2.5, 3.5]),
    })
    const columns = [
      { name: "id", type: "INT32" },
      { name: "name", type: "STRING" },
      { name: "score", type: "DOUBLE" },
    ]
    const { rows } = decodeArrowPayload([b64], columns)
    expect(rows.length).toBe(3)
    expect(rows[0]).toEqual([1, "a", 1.5])
    expect(rows[2]).toEqual([3, "c", 3.5])
  })

  it("returns empty rows when chunks is empty", () => {
    const { rows } = decodeArrowPayload([], [{ name: "x", type: "INT32" }])
    expect(rows).toEqual([])
  })

  it("resolves columns from schema when metadata is empty", () => {
    const b64 = encodeTable({
      id: new Int32Array([1]),
      name: ["a"],
      score: new Float64Array([1.0]),
    })
    const { columns, rows } = decodeArrowPayload([b64], [])
    expect(columns.map((c) => c.name)).toEqual(["id", "name", "score"])
    expect(rows.length).toBe(1)
  })
})
