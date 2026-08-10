import { describe, expect, test } from "bun:test"
import { getHeader, mergeHeaders } from "../src/headers.js"

describe("mergeHeaders", () => {
  test("a later source overrides an earlier one that differs only in case", () => {
    // The regression: fetch(undici) appends these into `instanceid: "1, 2"`,
    // which the gateway's Integer binding rejects.
    const merged = mergeHeaders({ instanceid: "1" }, { Instanceid: "2" })
    expect(merged).toEqual({ instanceid: "2" })
    expect([...new Headers(merged).entries()]).toEqual([["instanceid", "2"]])
  })

  test("skips undefined values instead of sending the string 'undefined'", () => {
    expect(mergeHeaders({ instanceName: undefined }, undefined)).toEqual({})
  })
})

describe("getHeader", () => {
  test("finds a header whatever casing the profile used", () => {
    expect(getHeader({ Instanceid: "270088" }, "instanceid")).toBe("270088")
    expect(getHeader({ instanceid: "270088" }, "Instanceid")).toBe("270088")
    expect(getHeader(undefined, "instanceid")).toBeUndefined()
  })
})
