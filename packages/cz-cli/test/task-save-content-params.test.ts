import { beforeEach, describe, expect, test } from "bun:test"
import { writeFileSync } from "node:fs"
import { join } from "node:path"
import { onStudio, requireTestHome, stubStudioContext } from "./support/cz-fixtures.js"
import { execute } from "../src/execute.ts"

const saved: Record<string, unknown>[] = []
const parameters = [
  { encrypt: true, id: "1001", ignore: false, paramKey: "secret_ref", paramType: "manual", ref: 3, extraMetadata: "preserve" },
  { encrypt: false, id: "1002", ignore: true, paramKey: "month", paramType: "manual", paramValue: "$[yyyyMM, -1mon]", ref: 0, extraMetadata: { preserve: true } },
  { encrypt: false, id: "1003", ignore: false, paramKey: "toString", paramType: "manual", paramValue: "keep", ref: 0 },
  { encrypt: false, id: "1004", ignore: false, paramKey: "bizdate", paramType: "system", paramValue: "bizdate", ref: 0 },
]
const schedule = { cronExpression: "0 0 1 * * ? *", retryCount: 3 }
const draft: { data: unknown; code: number } = { data: {}, code: 0 }

beforeEach(() => {
  saved.length = 0
  draft.code = 0
  draft.data = { fileType: 6, paramValueList: structuredClone(parameters), scheduleConfig: schedule }
  writeFileSync(join(requireTestHome(), ".clickzetta", "profiles.toml"), "[profiles.test]\npat = 'test-pat'\nworkspace = 'ws'\ninstance = 'inst'\n")
  stubStudioContext({ userId: 7, projectId: 9, workspaceName: "ws" })
  onStudio("/ide-admin/v1/dataFile/getDetail", () => ({ code: draft.code, data: draft.data }))
  onStudio("/ide-admin/v1/dataFileConfiguration/saveDataFileConfiguration", (body) => {
    const request = body as Record<string, unknown>
    saved.push(request)
    draft.data = { fileType: 6, paramValueList: request.paramValueList ?? null, scheduleConfig: schedule }
    return { code: 0, data: { message: "Draft saved" } }
  })
})

describe("task save-content parameter preservation", () => {
  test("preserves encrypted references without values, expressions, IDs and schedule on code-only save", async () => {
    const result = await execute("task save-content 123", ["--content", "SELECT 1"])
    expect(result.exitCode).toBe(0)
    expect(saved).toHaveLength(1)
    expect(saved[0]?.paramValueList).toEqual(parameters)
    expect(saved[0]?.dataFileContent).toBe("SELECT 1")
    expect(saved[0]?.onlySaveContent).toBe(1)
    expect(saved[0]).not.toHaveProperty("scheduleConfig")
    expect(draft.data).toEqual({ fileType: 6, paramValueList: parameters, scheduleConfig: schedule })
    expect(parameters[0]).not.toHaveProperty("paramValue")
  })

  test("reads nested taskDetail and supports UTF-8 script files", async () => {
    draft.data = { taskDetail: { fileType: 6, paramValueList: parameters } }
    const file = join(requireTestHome(), "script.py")
    writeFileSync(file, "# café comment\n")
    expect((await execute("task save-content 123", ["-f", file])).exitCode).toBe(0)
    expect(saved[0]?.paramValueList).toEqual(parameters)
    expect(saved[0]?.dataFileContent).toBe("# café comment\n")
  })

  test("reads top-level parameters alongside nested task detail", async () => {
    draft.data = { taskDetail: { file_type: "6" }, paramValueList: parameters }
    expect((await execute("task save-content 123", ["--content", "SELECT 1"])).exitCode).toBe(0)
    expect(saved[0]?.paramValueList).toEqual(parameters)
  })

  test("merges ordinary overrides by name and preserves all existing metadata", async () => {
    const result = await execute("task save-content 123", ["--content", "# changed", "--params", '{"month":"$[yyyyMM]","owner":"test"}'])
    expect(result.exitCode).toBe(0)
    expect(saved[0]?.paramValueList).toEqual([
      parameters[0],
      { ...parameters[1], paramValue: "$[yyyyMM]", paramType: "system" },
      parameters[2],
      parameters[3],
      expect.objectContaining({ paramKey: "owner", paramValue: "test", encrypt: false, ref: 0 }),
    ])
  })

  test("empty overrides preserve rather than clear", async () => {
    expect((await execute("task save-content 123", ["--content", "# changed", "--params", "{}"])).exitCode).toBe(0)
    expect(saved[0]?.paramValueList).toEqual(parameters)
  })

  test("only explicitly clears runtime params", async () => {
    expect((await execute("task save-content 123", ["--content", "# changed", "--clear-params"])).exitCode).toBe(0)
    expect(saved[0]?.paramValueList).toEqual([])
  })

  test.each([[undefined], [null], [[]]])("sends an empty list for tasks without parameters: %j", async (params) => {
    draft.data = { fileType: 6, paramValueList: params }
    expect((await execute("task save-content 123", ["--content", "# changed"])).exitCode).toBe(0)
    expect(saved[0]?.paramValueList).toEqual([])
  })

  test("does not save when the draft read fails", async () => {
    draft.code = 500
    expect((await execute("task save-content 123", ["--content", "# changed"])).exitCode).not.toBe(0)
    expect(saved).toHaveLength(0)
  })

  test("rejects conflicting clear and override options", async () => {
    expect((await execute("task save-content 123", ["--content", "# changed", "--clear-params", "--params", "{}"])).exitCode).not.toBe(0)
    expect(saved).toHaveLength(0)
  })

  test("refuses encrypted overrides without leaking the supplied value", async () => {
    const result = await execute("task save-content 123", ["--debug", "--content", "# changed", "--params", '{"secret_ref":"test-sensitive-value"}'])
    expect(result.exitCode).not.toBe(0)
    expect(saved).toHaveLength(0)
    expect(result.output).not.toContain("test-sensitive-value")
  })

  test("refuses non-encrypted references too", async () => {
    draft.data = { fileType: 6, paramValueList: [{ ...parameters[0], encrypt: false }] }
    expect((await execute("task save-content 123", ["--content", "# changed", "--params", '{"secret_ref":"test"}'])).exitCode).not.toBe(0)
    expect(saved).toHaveLength(0)
  })

  test.each([null, {}, { taskDetail: [] }, { fileType: 6, paramValueList: "invalid" }, { fileType: 6, paramValueList: [null] }, { fileType: 6, paramValueList: [{}] }])("does not save an unreadable detail: %j", async (data) => {
    draft.data = data
    const result = await execute("task save-content 123", ["--content", "# changed"])
    expect(result.exitCode).not.toBe(0)
    expect(saved).toHaveLength(0)
  })

  test.each(["", "[]", '{"secret":"test-sensitive-value","bad":null}'])("rejects invalid override input without saving: %s", async (params) => {
    const result = await execute("task save-content 123", ["--content", "# changed", "--params", params])
    expect(result.exitCode).not.toBe(0)
    expect(saved).toHaveLength(0)
    expect(result.output).not.toContain("test-sensitive-value")
  })
})
