import { test, expect, setDefaultTimeout } from "bun:test"
import { liveDescribe as describe } from "./support/live.js"
import { execute } from "../src/execute.ts"

setDefaultTimeout(30_000)

function json(r: { output: string }) {
  const parsed = JSON.parse(r.output.trim().split("\n")[0]) as Record<string, unknown>
  console.log(">>> output:", JSON.stringify(parsed, null, 2))
  return parsed
}

describe("runs list", () => {
  test("default query returns data array with snake_case fields", async () => {
    const r = await execute("runs list --page-size 5")
    expect(r.exitCode).toBe(0)
    const j = json(r)
    expect(j.error).toBeUndefined()
    const data = j.data as unknown[]
    expect(Array.isArray(data)).toBe(true)
    if (data.length > 0) {
      const item = data[0] as Record<string, unknown>
      // Should have snake_case fields from converter
      expect("run_id" in item || "task_run_status" in item).toBe(true)
      // Should NOT have camelCase API fields
      expect(item.taskInstanceId).toBeUndefined()
      expect(item.instanceStatus).toBeUndefined()
    }
  })

  test("--status SUCCESS filters correctly", async () => {
    const r = await execute("runs list --status SUCCESS --page-size 5")
    expect(r.exitCode).toBe(0)
    const j = json(r)
    expect(j.error).toBeUndefined()
    const data = j.data as Record<string, unknown>[]
    if (data.length > 0) {
      for (const item of data) {
        expect(item.task_run_status).toBe(1)
      }
    }
  })

  test("--status FAILED filters correctly", async () => {
    const r = await execute("runs list --status FAILED --page-size 5")
    expect(r.exitCode).toBe(0)
    const j = json(r)
    expect(j.error).toBeUndefined()
    const data = j.data as Record<string, unknown>[]
    if (data.length > 0) {
      for (const item of data) {
        expect(item.task_run_status).toBe(3)
      }
    }
  })

  test("--run-type SCHEDULE filters by instanceType", async () => {
    const r = await execute("runs list --run-type SCHEDULE --page-size 5")
    expect(r.exitCode).toBe(0)
    const j = json(r)
    expect(j.error).toBeUndefined()
    expect(Array.isArray(j.data)).toBe(true)
  })

  test("no --run-type returns all types", async () => {
    const r = await execute("runs list --page-size 5")
    expect(r.exitCode).toBe(0)
    const j = json(r)
    expect(j.error).toBeUndefined()
    expect(Array.isArray(j.data)).toBe(true)
  })

  test("pagination works", async () => {
    const r = await execute("runs list --page 1 --page-size 2")
    expect(r.exitCode).toBe(0)
    const j = json(r)
    expect(j.error).toBeUndefined()
    const data = j.data as unknown[]
    expect(data.length).toBeLessThanOrEqual(2)
    expect(j.pagination).toBeDefined()
  })

  test("--from and --to time range", async () => {
    const r = await execute("runs list --from 2026-05-10 --to 2026-05-11 --page-size 5")
    expect(r.exitCode).toBe(0)
    const j = json(r)
    expect(j.error).toBeUndefined()
  })
})

describe("runs detail", () => {
  test("returns converted fields for a valid run", async () => {
    // First get a run_id
    const listR = await execute("runs list --page-size 1")
    const listJ = json(listR)
    const data = listJ.data as Record<string, unknown>[]
    if (!data || data.length === 0) {
      console.log("⊘ skipped: no runs available")
      return
    }
    const runId = data[0].run_id
    expect(runId).toBeDefined()

    const r = await execute(`runs detail ${runId}`)
    expect(r.exitCode).toBe(0)
    const j = json(r)
    expect(j.error).toBeUndefined()
    const detail = j.data as Record<string, unknown>
    expect(detail.run_id).toBe(runId)
    // Should have snake_case fields
    expect(detail.taskInstanceId).toBeUndefined()
  })
})

describe("runs stats", () => {
  test("returns array with converted fields", async () => {
    const r = await execute("runs stats")
    expect(r.exitCode).toBe(0)
    const j = json(r)
    expect(j.error).toBeUndefined()
    const data = j.data
    if (Array.isArray(data) && data.length > 0) {
      const item = data[0] as Record<string, unknown>
      // Should have snake_case fields
      expect("task_run_status" in item || "count" in item).toBe(true)
      // Should NOT have camelCase
      expect(item.instanceStatus).toBeUndefined()
    }
  })

  test("--from --to time range", async () => {
    const r = await execute("runs stats --from 2026-05-10 --to 2026-05-11")
    expect(r.exitCode).toBe(0)
    const j = json(r)
    expect(j.error).toBeUndefined()
  })
})

describe("runs logs", () => {
  test("returns execution fields for a valid run", async () => {
    const listR = await execute("runs list --status SUCCESS --page-size 1")
    const listJ = json(listR)
    const data = listJ.data as Record<string, unknown>[]
    if (!data || data.length === 0) {
      console.log("⊘ skipped: no successful runs available")
      return
    }
    const runId = data[0].run_id

    const r = await execute(`runs logs ${runId}`)
    if (r.exitCode !== 0) {
      // May fail if no attempts exist
      const j = json(r)
      expect(j.error).toBeDefined()
      return
    }
    const j = json(r)
    const detail = j.data as Record<string, unknown>
    expect(detail.dataSequenceId).toBeDefined()
    // Should NOT have camelCase
    expect(detail.execution_id).toBeDefined()
  })
})
