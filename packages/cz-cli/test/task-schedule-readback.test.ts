import { beforeEach, expect, test } from "bun:test"
import { onStudio, stubStudioContext } from "./support/cz-fixtures.js"
import { clearTokenCache } from "@clickzetta/sdk"
import { writeFileSync } from "node:fs"
import { join } from "node:path"

const { execute } = await import("../src/execute.ts")
let draftMode: string | number | undefined
let publishedMode: string | number | undefined

beforeEach(() => {
  clearTokenCache()
  draftMode = "2"
  publishedMode = "2"
  writeFileSync(join(process.env.CLICKZETTA_TEST_HOME!, ".clickzetta", "profiles.toml"),
    "[profiles.test]\npat = 'pat'\nworkspace = 'ws'\ninstance = 'inst'\n")
  stubStudioContext({ userId: 7, projectId: 9, workspaceName: "ws" })
  onStudio("/ide-admin/v1/dataFile/getDetail", () => ({ code: 0, data: {
    id: 123, dataFileName: "scheduled_task", fileType: 4, currentVersion: 1, fileContent: "select 1",
  } }))
  onStudio("/ide-admin/v1/dataFileConfiguration/getFileConfigurationDetail", () => ({ code: 0, data: {
    scheduleCreatedType: draftMode, cronExpress: "0 30 2 * * ? *",
  } }))
  onStudio("/ide-admin/v1/fileVersion/getFileDetailByVersion", () => ({ code: 0, data: {
    taskConfigurationDetail: { scheduleCreatedType: publishedMode, cronExpress: "0 30 2 * * ? *" },
  } }))
  onStudio("/ide-admin/v1/scheduleTask/getDetail", () => ({ code: 0, data: { scheduleCreatedType: publishedMode } }))
  onStudio("/ide-admin/v1/dataFileConfiguration/saveDataFileConfiguration", (body) => {
    draftMode = (body as Record<string, unknown>).scheduleCreatedType as string
    return { code: 0, data: true }
  })
})

test("mode-only save requires publishing and reads back through content and status", async () => {
  const saved = await execute("task save-config 123 --schedule-created-type 1")
  expect(saved.exitCode).toBe(0)
  expect(draftMode).toBe("1")
  const status = await execute("task status 123")
  expect(status.exitCode).toBe(0)
  expect(JSON.parse(status.output.trim().split("\n")[0]!)).toMatchObject({ data: {
    needs_publish: true,
    draft_schedule: { schedule_created_type: "1" },
    published_schedule: { schedule_created_type: "2" },
  } })
  const content = await execute("task content 123")
  expect(content.exitCode).toBe(0)
  expect(JSON.parse(content.output.trim().split("\n")[0]!)).toMatchObject({ data: {
    schedule_config: { schedule_created_type: "1" },
  } })
})

for (const mode of [1, 2]) {
  test(`numeric and string mode ${mode} compare equal`, async () => {
    draftMode = mode
    publishedMode = String(mode)
    const status = await execute("task status 123")
    expect(status.exitCode).toBe(0)
    expect(JSON.parse(status.output.trim().split("\n")[0]!)).toMatchObject({ data: { needs_publish: false } })
  })
}

test("deployed schedule readback uses the same field name", async () => {
  const info = await execute("task schedule-info 123")
  expect(info.exitCode).toBe(0)
  expect(JSON.parse(info.output.trim().split("\n")[0]!)).toMatchObject({ data: { schedule_created_type: "2" } })
})

test("missing modes remain equal", async () => {
  draftMode = undefined
  publishedMode = undefined
  const status = await execute("task status 123")
  expect(status.exitCode).toBe(0)
  expect(JSON.parse(status.output.trim().split("\n")[0]!)).toMatchObject({ data: { needs_publish: false } })
})

test("an absent published mode is distinct from an explicit draft mode", async () => {
  publishedMode = undefined
  const status = await execute("task status 123")
  expect(status.exitCode).toBe(0)
  expect(JSON.parse(status.output.trim().split("\n")[0]!)).toMatchObject({ data: { needs_publish: true } })
})
