import { describe, expect, test } from "bun:test"
import { workspaceLakehouseDatasources } from "../src/commands/datasource.ts"
import { parseVcId } from "../src/commands/task.ts"

const ds = (id: number, params: Record<string, unknown> | string, dsType = 1) => ({
  id,
  dsName: `LAKEHOUSE_${id}`,
  dsType,
  connectionParams: typeof params === "string" ? params : JSON.stringify(params),
})

describe("workspaceLakehouseDatasources", () => {
  const list = [
    ds(14594, { projectId: 3623772, workspaceName: "other-ws" }),
    ds(263, { projectId: 60001, workspaceName: "wanxin-test-ws-03" }),
    ds(300, { projectId: 60001, workspaceName: "wanxin-test-ws-03" }, 5),
  ]

  test("keeps only the Lakehouse datasource of the current workspace by projectId", () => {
    const ids = workspaceLakehouseDatasources(list, { projectId: 60001, workspaceName: "wanxin-test-ws-03" }).map((d) => d.id)
    expect(ids).toEqual([263])
  })

  test("falls back to workspaceName when projectId is unknown", () => {
    const ids = workspaceLakehouseDatasources(list, { workspaceName: "wanxin-test-ws-03" }).map((d) => d.id)
    expect(ids).toEqual([263])
  })

  test("accepts connectionParams as an object and ignores unparsable ones", () => {
    const rows = [
      { id: 1, dsType: 1, connectionParams: { projectId: 7 } },
      { id: 2, dsType: 1, connectionParams: "{not json" },
    ]
    expect(workspaceLakehouseDatasources(rows, { projectId: 7, workspaceName: "ws" }).map((d) => d.id)).toEqual([1])
  })

  test("returns nothing when no datasource points at the workspace", () => {
    expect(workspaceLakehouseDatasources(list, { projectId: 1, workspaceName: "nope" })).toEqual([])
  })
})

describe("parseVcId", () => {
  test("keeps 64-bit IDs exact", () => {
    expect(parseVcId("2331822492426291798")).toBe("2331822492426291798")
    expect(parseVcId(" 42 ")).toBe("42")
  })

  test("rejects non-numeric IDs", () => {
    expect(() => parseVcId("abc")).toThrow("--vc-id")
    expect(() => parseVcId("1e3")).toThrow("--vc-id")
  })
})
