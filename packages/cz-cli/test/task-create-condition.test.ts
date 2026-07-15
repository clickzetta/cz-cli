import { beforeEach, describe, expect, test } from "bun:test"
import { onStudio, stubStudioContext } from "./support/cz-fixtures.js"
import { clearTokenCache } from "@clickzetta/sdk"
import { writeFileSync } from "node:fs"
import { join } from "node:path"

// Network-boundary test: no mock.module of our own src or of @clickzetta/sdk. The real cz-cli
// path runs (execute → task command → studio-context → resolver → SDK) and only
// the network boundary (globalThis.fetch, intercepted in preload) is stubbed via
// onStudio() path fixtures. HOME/profile are isolated by test/preload.ts.

const createCalls: Array<Record<string, unknown>> = []

const { execute } = await import("../src/execute.ts")

beforeEach(() => {
  clearTokenCache()
  createCalls.length = 0
  writeFileSync(
    join(process.env.CLICKZETTA_TEST_HOME!, ".clickzetta", "profiles.toml"),
    "[profiles.test]\npat = 'pat'\nworkspace = 'wanxin-test-ws-03'\ninstance = 'tmwmzxzs'\n",
  )
  stubStudioContext({ userId: 12365, projectId: 60001, workspaceName: "wanxin-test-ws-03" })
  // Duplicate-name check (listTasks) → no existing tasks
  onStudio("/ide-admin/v1/ai/mcp/listFiles", () => ({ code: 0, data: { list: [], total: 0, totalPages: 0 } }))
  // createTask (addAndReturnId) → capture body, return new file id
  onStudio("/ide-admin/v1/dataFile/addAndReturnId", (body) => {
    createCalls.push(body as Record<string, unknown>)
    return { code: 0, data: 12345 }
  })
})

describe("task create condition", () => {
  test("maps CONDITION to Studio fileType 19", async () => {
    const result = await execute("task create studi_test_1testif_20260628011624 --type CONDITION --folder 389001")

    if (result.exitCode !== 0) console.log(result.output)
    expect(result.exitCode).toBe(0)
    expect(createCalls).toEqual([
      {
        fileType: "19",
        createdBy: "12365",
        projectId: 60001,
        dataFileName: "studi_test_1testif_20260628011624",
        dataFolderId: 389001,
      },
    ])
  })
})
