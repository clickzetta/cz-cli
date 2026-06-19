import { describe, expect, test } from "bun:test"
import { mergeTaskParamValueList, parseParamValueList } from "../src/commands/task.ts"

describe("parseParamValueList", () => {
  test("parses over-escaped JSON params from Windows-style shells", () => {
    const parsed = parseParamValueList('{\\\"hh\\\":\\\"$[HH]\\\",\\\"ds\\\":\\\"$[yyyyMMdd]\\\",\\\"tb_name\\\":\\\"ods_log_cdu_module_mi\\\"}')

    expect(parsed).toEqual([
      expect.objectContaining({
        paramKey: "hh",
        paramValue: "$[HH]",
        paramType: "system",
      }),
      expect.objectContaining({
        paramKey: "ds",
        paramValue: "$[yyyyMMdd]",
        paramType: "system",
      }),
      expect.objectContaining({
        paramKey: "tb_name",
        paramValue: "ods_log_cdu_module_mi",
        paramType: "manual",
      }),
    ])
  })

  test("preserves ordinary JSON backslashes in param values", () => {
    const parsed = parseParamValueList('{"script_path":"C:\\\\Users\\\\13416\\\\AppData\\\\Local\\\\Temp\\\\migrate.py"}')

    expect(parsed).toEqual([
      expect.objectContaining({
        paramKey: "script_path",
        paramValue: "C:\\Users\\13416\\AppData\\Local\\Temp\\migrate.py",
        paramType: "manual",
      }),
    ])
  })

  test("merges explicit overrides into existing params without dropping untouched params", () => {
    const merged = mergeTaskParamValueList([
      { paramKey: "hh", paramValue: "$[HH]", paramType: "system", encrypt: false, ignore: false, id: "1", ref: 0 },
      { paramKey: "ds", paramValue: "$[yyyyMMdd]", paramType: "system", encrypt: false, ignore: false, id: "2", ref: 0 },
      { paramKey: "tb_name", paramValue: "old_table", paramType: "manual", encrypt: false, ignore: false, id: "3", ref: 0 },
    ], {
      tb_name: "new_table",
      owner: "alice",
    })

    expect(merged).toEqual([
      expect.objectContaining({ paramKey: "hh", paramValue: "$[HH]", paramType: "system" }),
      expect.objectContaining({ paramKey: "ds", paramValue: "$[yyyyMMdd]", paramType: "system" }),
      expect.objectContaining({ paramKey: "tb_name", paramValue: "new_table", paramType: "manual" }),
      expect.objectContaining({ paramKey: "owner", paramValue: "alice", paramType: "manual" }),
    ])
  })
})
