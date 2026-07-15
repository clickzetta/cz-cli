import { test, expect, setDefaultTimeout } from "bun:test"
import { liveDescribe as describe } from "./support/live.js"
import { execute } from "../src/execute.ts"

setDefaultTimeout(30_000)

function json(r: { output: string }) {
  const parsed = JSON.parse(r.output.trim().split("\n")[0]) as Record<string, unknown>
  console.log(">>> output:", JSON.stringify(parsed, null, 2))
  return parsed
}

// Replace with a real task ID in your workspace
const TEST_TASK_ID = process.env.TEST_TASK_ID ?? "agent_test11"

describe("task save-cron", () => {
  test("saves cron expression successfully", async () => {
    const r = await execute(`task save-cron ${TEST_TASK_ID} --cron "0 30 2 * * ? *"`)
    expect(r.exitCode).toBe(0)
    const j = json(r)
    expect(j.error).toBeUndefined()
  })

  test("rejects invalid cron with unsupported token", async () => {
    const r = await execute(`task save-cron ${TEST_TASK_ID} --cron "0 0 L * * ?"`)
    const j = json(r)
    expect(j.error).toBeDefined()
  })

  test("accepts 5-field cron and normalizes", async () => {
    const r = await execute(`task save-cron ${TEST_TASK_ID} --cron "30 2 * * *"`)
    expect(r.exitCode).toBe(0)
    const j = json(r)
    expect(j.error).toBeUndefined()
  })

  test("accepts minute-step cron", async () => {
    const r = await execute(`task save-cron ${TEST_TASK_ID} --cron "0 */5 0-23 * * ? *"`)
    expect(r.exitCode).toBe(0)
    const j = json(r)
    expect(j.error).toBeUndefined()
  })

  test("accepts cron with --vc and --schema", async () => {
    const r = await execute(`task save-cron ${TEST_TASK_ID} --cron "0 0 3 * * ? *" --vc DEFAULT --schema public`)
    expect(r.exitCode).toBe(0)
    const j = json(r)
    expect(j.error).toBeUndefined()
  })

  test("fails without --cron", async () => {
    const r = await execute(`task save-cron ${TEST_TASK_ID}`)
    expect(r.exitCode).not.toBe(0)
  })
})

describe("task save-config", () => {
  test("saves retry config", async () => {
    const r = await execute(`task save-config ${TEST_TASK_ID} --retry-count 3 --retry-interval 2 --retry-unit m`)
    expect(r.exitCode).toBe(0)
    const j = json(r)
    expect(j.error).toBeUndefined()
  })

  test("saves rerun-property", async () => {
    const r = await execute(`task save-config ${TEST_TASK_ID} --rerun-property 1`)
    expect(r.exitCode).toBe(0)
    const j = json(r)
    expect(j.error).toBeUndefined()
  })

  test("saves vc and schema", async () => {
    const r = await execute(`task save-config ${TEST_TASK_ID} --vc DEFAULT --schema public`)
    expect(r.exitCode).toBe(0)
    const j = json(r)
    expect(j.error).toBeUndefined()
  })

  test("clears dependencies", async () => {
    const r = await execute(`task save-config ${TEST_TASK_ID} --deps clear`)
    expect(r.exitCode).toBe(0)
    const j = json(r)
    expect(j.error).toBeUndefined()
  })

  test("keeps dependencies by default (no --deps flag)", async () => {
    const r = await execute(`task save-config ${TEST_TASK_ID} --retry-count 2`)
    expect(r.exitCode).toBe(0)
    const j = json(r)
    expect(j.error).toBeUndefined()
  })

  test("saves with no options", async () => {
    const r = await execute(`task save-config ${TEST_TASK_ID}`)
    expect(r.exitCode).toBe(0)
    const j = json(r)
    expect(j.error).toBeUndefined()
  })
})
