import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test"

const actualSdk = { ...(await import("@clickzetta/sdk")) }

// cz_change: bun's mock.module registration is process-global and outlives this
// file. a2's other cz-cli suites are network-boundary tests that run the REAL
// SDK and only stub globalThis.fetch, so a lingering SDK mock silently breaks
// them (task-lineage, task-condition-flow, ai-gateway-*). Restore the real
// module once this file is done — same guard as clickzetta-sdk/test/dqc.test.ts.
afterAll(() => {
  mock.module("@clickzetta/sdk", () => actualSdk)
})

// In-memory datasource catalog the mocked list endpoint serves.
type DsRow = { id: number; dsName: string; dsType: number }
let catalog: DsRow[] = []
const listBodies: Array<Record<string, unknown>> = []

// bun's mock.module is process-global and last-write-wins; re-installing in beforeEach
// keeps this file's SDK mock authoritative even when another test file also mocks the SDK.
function installSdkMock() {
  mock.module("@clickzetta/sdk", () => ({
    ...actualSdk,
    studioRequest: async (_sc: unknown, path: string, body?: Record<string, unknown>) => {
      if (path === "/ide-authority/v1/projectDataSources/list") {
        listBodies.push(body ?? {})
        const dsName = body?.dsName as string | undefined
        const dsType = body?.dsType as number | undefined
        const pageSize = Number(body?.pageSize ?? 100)
        const pageIndex = Number(body?.pageIndex ?? body?.current ?? 1)
        // Backend semantics: dsName is a fuzzy (substring) filter; dsType is exact.
        let rows = catalog
        if (dsName) rows = rows.filter((r) => r.dsName.includes(dsName))
        if (dsType !== undefined) rows = rows.filter((r) => r.dsType === dsType)
        const start = (pageIndex - 1) * pageSize
        return { code: 200, data: { list: rows.slice(start, start + pageSize), total: rows.length } }
      }
      throw new Error(`unexpected path: ${path}`)
    },
  }))
}
installSdkMock()

// We test the REAL resolveDatasource. Another test file globally mocks
// "../src/commands/datasource.js" (bun mock.module is process-wide), which would clobber
// the plain import. The "?real" query fetches an unmocked copy of the module; it still
// imports the (mocked) SDK, so our list-endpoint mock above governs its behavior.
const { resolveDatasource } = await import("../src/commands/datasource.ts?real")

const sc = { projectId: 1, workspaceName: "ws" } as unknown as Parameters<typeof resolveDatasource>[0]

beforeEach(() => {
  installSdkMock()
  catalog = []
  listBodies.length = 0
})

describe("resolveDatasource", () => {
  test("type filter picks the intended datasource among same-named different types", async () => {
    // A Lakehouse and a MySQL share the exact name; without a type filter this is ambiguous.
    catalog = [
      { id: 1, dsName: "svw_data", dsType: 1 },  // lakehouse
      { id: 2, dsName: "svw_data", dsType: 5 },  // mysql
    ]
    const lake = await resolveDatasource(sc, "svw_data", 1)
    expect(lake).toMatchObject({ id: 1, dsType: 1 })
    const mysql = await resolveDatasource(sc, "svw_data", 5)
    expect(mysql).toMatchObject({ id: 2, dsType: 5 })
  })

  test("no exact name + multiple fuzzy candidates → ambiguity error, never silent list[0]", async () => {
    catalog = [
      { id: 10, dsName: "svw_vw_trip_report", dsType: 5 },
      { id: 11, dsName: "svw_vw_energy", dsType: 1 },
      { id: 12, dsName: "svw_vw_charging", dsType: 1 },
    ]
    // "svw_vw" matches all three, none is an exact name.
    let err: unknown
    try { await resolveDatasource(sc, "svw_vw") } catch (e) { err = e }
    expect(String((err as { code?: string })?.code ?? err)).toContain("DATASOURCE_AMBIGUOUS")
  })

  test("exact name match wins even when fuzzy siblings exist", async () => {
    catalog = [
      { id: 20, dsName: "svw_vw", dsType: 1 },
      { id: 21, dsName: "svw_vw_extra", dsType: 5 },
    ]
    const ds = await resolveDatasource(sc, "svw_vw")
    expect(ds).toMatchObject({ id: 20, dsType: 1 })
  })

  test("type filter + fuzzy name narrows to a single candidate", async () => {
    catalog = [
      { id: 30, dsName: "svw_vw_charging", dsType: 5 },  // mysql
      { id: 31, dsName: "svw_vw_charging_lake", dsType: 1 },  // lakehouse
    ]
    // Fuzzy "svw_vw_charging" matches both, but only one is lakehouse.
    const ds = await resolveDatasource(sc, "svw_vw_charging", 1)
    expect(ds).toMatchObject({ id: 31, dsType: 1 })
    // The list request carried the dsType filter.
    expect(listBodies.some((b) => b.dsType === 1)).toBe(true)
  })

  test("numeric id with mismatched expected type errors", async () => {
    catalog = [{ id: 40, dsName: "the_mysql", dsType: 5 }]
    let err: unknown
    try { await resolveDatasource(sc, "40", 1) } catch (e) { err = e }
    expect(String((err as { code?: string })?.code ?? err)).toContain("DATASOURCE_TYPE_MISMATCH")
  })

  test("pages through >100 results so an exact match on page 2 is still found", async () => {
    catalog = Array.from({ length: 150 }, (_, i) => ({ id: 1000 + i, dsName: `svw_${i}`, dsType: 1 }))
    // svw_149 is on the second page (fuzzy "svw_" returns all 150).
    const ds = await resolveDatasource(sc, "svw_149")
    expect(ds).toMatchObject({ id: 1149 })
  })
})
