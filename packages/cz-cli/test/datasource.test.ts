import { describe, test, expect, setDefaultTimeout } from "bun:test"
import { execute } from "../src/execute.ts"

setDefaultTimeout(30_000)

function json(r: { output: string }) {
  const parsed = JSON.parse(r.output.trim().split("\n")[0]) as Record<string, unknown>
  console.log(">>> output:", JSON.stringify(parsed, null, 2))
  return parsed
}

describe("datasource list", () => {
  test("returns data array", async () => {
    const r = await execute("datasource list --page-size 5")
    expect(r.exitCode).toBe(0)
    const j = json(r)
    expect(j.error).toBeUndefined()
    const data = j.data as unknown[]
    expect(Array.isArray(data)).toBe(true)
    if (data.length > 0) {
      const item = data[0] as Record<string, unknown>
      expect(item.id).toBeDefined()
      expect(item.name).toBeDefined()
      expect(item.type).toBeDefined()
    }
  })

  test("--type mysql filters by type", async () => {
    const r = await execute("datasource list --type mysql --page-size 5")
    expect(r.exitCode).toBe(0)
    const j = json(r)
    expect(j.error).toBeUndefined()
    const data = j.data as Record<string, unknown>[]
    for (const item of data) {
      expect(item.type).toBe("MySQL")
    }
  })

  test("--type with invalid value returns error", async () => {
    const r = await execute("datasource list --type nonexistent")
    expect(r.exitCode).not.toBe(0)
    const j = json(r)
    expect(j.error).toBeDefined()
  })

  test("--name filters by name", async () => {
    const r = await execute("datasource list --page-size 50")
    const j = json(r)
    const data = j.data as Record<string, unknown>[]
    if (!data || data.length === 0) {
      console.log("⊘ skipped: no datasources available")
      return
    }
    const firstName = String(data[0].name)
    const r2 = await execute(`datasource list --name "${firstName}"`)
    expect(r2.exitCode).toBe(0)
    const j2 = json(r2)
    expect(j2.error).toBeUndefined()
    const filtered = j2.data as Record<string, unknown>[]
    expect(filtered.length).toBeGreaterThan(0)
  })
})

describe("datasource catalogs", () => {
  test("returns catalogs for a datasource by id", async () => {
    // First get a datasource id
    const listR = await execute("datasource list --page-size 1")
    const listJ = json(listR)
    const data = listJ.data as Record<string, unknown>[]
    if (!data || data.length === 0) {
      console.log("⊘ skipped: no datasources available")
      return
    }
    const dsId = data[0].id

    const r = await execute(`datasource catalogs ${dsId}`)
    expect(r.exitCode).toBe(0)
    const j = json(r)
    expect(j.error).toBeUndefined()
    expect(Array.isArray(j.data)).toBe(true)
    if ((j.data as unknown[]).length > 0) {
      expect(typeof (j.data as string[])[0]).toBe("string")
    }
  })

  test("--filter narrows results", async () => {
    const listR = await execute("datasource list --page-size 1")
    const listJ = json(listR)
    const data = listJ.data as Record<string, unknown>[]
    if (!data || data.length === 0) {
      console.log("⊘ skipped: no datasources available")
      return
    }
    const dsId = data[0].id

    const r = await execute(`datasource catalogs ${dsId} --filter zzz_nonexistent_zzz`)
    expect(r.exitCode).toBe(0)
    const j = json(r)
    expect(j.error).toBeUndefined()
    expect((j.data as unknown[]).length).toBe(0)
  })
})

describe("datasource objects", () => {
  test("returns objects for a datasource catalog", async () => {
    // Get a datasource
    const listR = await execute("datasource list --page-size 1")
    const listJ = json(listR)
    const dsList = listJ.data as Record<string, unknown>[]
    if (!dsList || dsList.length === 0) {
      console.log("⊘ skipped: no datasources available")
      return
    }
    const dsId = dsList[0].id

    // Get a catalog
    const catR = await execute(`datasource catalogs ${dsId}`)
    const catJ = json(catR)
    const catalogs = catJ.data as string[]
    if (!catalogs || catalogs.length === 0) {
      console.log("⊘ skipped: no catalogs available")
      return
    }
    const catalog = catalogs[0]

    const r = await execute(`datasource objects ${dsId} ${catalog}`)
    expect(r.exitCode).toBe(0)
    const j = json(r)
    expect(j.error).toBeUndefined()
    expect(Array.isArray(j.data)).toBe(true)
    if ((j.data as unknown[]).length > 0) {
      expect(typeof (j.data as string[])[0]).toBe("string")
    }
  })
})

describe("datasource describe", () => {
  test("returns metadata for an object", async () => {
    // Get a datasource
    const listR = await execute("datasource list --page-size 1")
    const listJ = json(listR)
    const dsList = listJ.data as Record<string, unknown>[]
    if (!dsList || dsList.length === 0) {
      console.log("⊘ skipped: no datasources available")
      return
    }
    const dsId = dsList[0].id

    // Get a catalog
    const catR = await execute(`datasource catalogs ${dsId}`)
    const catJ = json(catR)
    const catalogs = catJ.data as string[]
    if (!catalogs || catalogs.length === 0) {
      console.log("⊘ skipped: no catalogs available")
      return
    }
    const catalog = catalogs[0]

    // Get an object
    const objR = await execute(`datasource objects ${dsId} ${catalog}`)
    const objJ = json(objR)
    const objects = objJ.data as string[]
    if (!objects || objects.length === 0) {
      console.log("⊘ skipped: no objects available")
      return
    }
    const objName = objects[0]

    const r = await execute(`datasource describe ${dsId} ${catalog} ${objName}`)
    expect(r.exitCode).toBe(0)
    const j = json(r)
    expect(j.error).toBeUndefined()
    expect(j.data).toBeDefined()
  })
})
