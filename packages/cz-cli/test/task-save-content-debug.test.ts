import { afterAll, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const home = mkdtempSync(join(tmpdir(), "cz-task-save-content-debug-"))
const detailPath = "/ide-admin/v1/dataFile/getDetail"
const savePath = "/ide-admin/v1/dataFileConfiguration/saveDataFileConfiguration"
const storedValue = "synthetic-stored-param-value"
const parameters = [
  { id: "1001", paramKey: "secret_ref", encrypt: true, ref: 3, extraMetadata: "synthetic-ref-metadata" },
  { id: "1002", paramKey: "bizdate", paramType: "system", paramValue: "bizdate" },
  { id: "1003", paramKey: "example", paramType: "manual", paramValue: storedValue },
]
const saves: unknown[] = []
const requests: string[] = []
const createPath = "/ide-admin/v1/dataFile/addAndReturnId"
const deletePath = "/ide-admin/v1/dataFile/deleteFile"
const responses = new Map<string, () => Response>([
  ["/clickzetta-portal/user/loginSingle", () => ok({ token: "test-token", instanceId: 11, userId: 7, expireTime: 3_600_000 })],
  ["/clickzetta-portal/user/getCurrentUser", () => ok({ id: 7, accountId: 5, name: "test-user" })],
  ["/clickzetta-portal/service/serviceInstanceList", () => ok([{ id: 11, name: "inst", serviceId: 1 }])],
  ["/ide-authority/v1/workspace/listUserWorkspaces", () => ok([{ workspaceId: 8, workspaceName: "ws", projectId: 9 }])],
  ["/ide-admin/v1/ai/mcp/listFiles", () => ok({ list: [] })],
  [createPath, () => ok(123)],
  [deletePath, () => ok(null)],
  [detailPath, () => ok({ id: 123, fileType: 4, paramValueList: parameters, scheduleConfig: { retryCount: 3 } })],
  ["/ide-admin/v1/dataFileConfiguration/getFileConfigurationDetail", () => ok({ etlVcId: 3 })],
  [savePath, () => ok({ message: "Draft saved" })],
])

function ok(data: unknown) {
  return Response.json({ code: 0, data })
}

await Bun.write(join(home, ".clickzetta", "profiles.toml"), `
[profiles.test]
service = "http://studio.test"
protocol = "http"
instance = "inst"
workspace = "ws"
pat = "test-pat"
`)

afterAll(() => {
  rmSync(home, { recursive: true, force: true })
})

async function runTask(args: string[], debug = true, telemetry = false) {
  requests.length = 0
  saves.length = 0
  const requestFile = join(home, "requests.jsonl")
  await Bun.write(requestFile, "")
  await Bun.write(join(home, "responses.json"), JSON.stringify(Object.fromEntries(
    await Promise.all(Array.from(responses, async ([path, respond]) => {
      const response = respond()
      return [path, { status: response.status, body: await response.text() }]
    })),
  )))
  const child = Bun.spawn([
    process.execPath, "--preload", "./test/fixtures/studio-cli-transport.ts", "src/main.ts", ...(debug ? ["--debug"] : []), "task", ...args, "--profile", "test", "--format", "json",
  ], {
    cwd: join(import.meta.dir, ".."),
    env: {
      HOME: home,
      CLICKZETTA_TEST_HOME: home,
      CLICKZETTA_DISABLE_AUTOUPDATE: "1",
      ...(telemetry && { CLICKZETTA_TEST_TELEMETRY: "1" }),
    },
    stdout: "pipe",
    stderr: "pipe",
  })
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  const commandLogs: string[] = []
  for (const line of (await Bun.file(requestFile).text()).trim().split("\n").filter(Boolean)) {
    const request = JSON.parse(line)
    requests.push(request.path)
    if (request.path === savePath) saves.push(JSON.parse(request.body))
    if (request.path === "/v1/logs") commandLogs.push(request.body)
  }
  return { stdout, stderr, code, commandLogs }
}

function saveWithDebug(command = "save-content") {
  return runTask([command, "123", "--content", "SELECT 1"])
}

test("debug output hides stored parameters while the CLI sends the complete records", async () => {
  const result = await saveWithDebug()
  expect(result.code, result.stdout + result.stderr).toBe(0)
  expect(saves.splice(0)).toEqual([{
    dataFileId: 123,
    dataFileContent: "SELECT 1",
    collectType: 1,
    onlySaveContent: 1,
    projectId: 9,
    updateBy: "7",
    instanceName: "inst",
    paramValueList: parameters,
    replace_escaped_chars: false,
  }])
  expect(result.stdout).toContain("Draft saved")
  expect(result.stderr).toContain(savePath)
  expect(result.stderr).toContain('"dataFileContent":"SELECT 1"')
  for (const value of [storedValue, "bizdate", "secret_ref", "synthetic-ref-metadata"]) {
    expect(result.stdout + result.stderr).not.toContain(value)
  }
})

for (const path of [detailPath, savePath]) {
  for (const failure of [
    { label: "Studio error", respond: () => Response.json({ code: 4001, message: storedValue }), diagnostic: "4001" },
    { label: "malformed Studio code", respond: () => Response.json({ code: storedValue }), diagnostic: "INVALID_RESPONSE" },
    { label: "HTTP error", respond: () => new Response(storedValue, { status: 400 }), diagnostic: "400" },
    { label: "malformed JSON", respond: () => new Response(storedValue), diagnostic: "Invalid JSON" },
  ]) {
    test(`debug output hides parameter data on ${path} ${failure.label}`, async () => {
      const respond = responses.get(path)!
      responses.set(path, failure.respond)
      try {
        const result = await saveWithDebug()
        expect(saves.splice(0)).toHaveLength(path === detailPath ? 0 : 1)
        expect(result.code, result.stdout + result.stderr).not.toBe(0)
        expect(JSON.parse(result.stdout).error.message).toContain(failure.diagnostic)
        expect(result.stdout + result.stderr).not.toContain(storedValue)
      } finally {
        responses.set(path, respond)
      }
    })
  }
}

test("legacy task save sends the full current parameters", async () => {
  const result = await saveWithDebug("save")
  expect(result.code, result.stdout + result.stderr).toBe(0)
  expect(saves).toHaveLength(1)
  expect(saves[0]).toMatchObject({ onlySaveContent: 1, paramValueList: parameters })
})

for (const command of ["save-content", "save"]) {
  test.each([["off", false], ["on", true]] as const)(`task ${command} hides echoed parameters with debug %s`, async (_label, debug) => {
    const respond = responses.get(savePath)!
    responses.set(savePath, () => ok({ message: storedValue, paramValueList: parameters, studio_url: storedValue }))
    try {
      const result = await runTask([command, "123", "--content", "SELECT 1"], debug)
      expect(result.code, result.stderr).toBe(0)
      expect(saves).toHaveLength(1)
      expect(saves[0]).toMatchObject({ onlySaveContent: 1, paramValueList: parameters })
      expect(result.stdout + result.stderr).not.toContain(storedValue)
      expect(JSON.parse(result.stdout)).toEqual({
        data: { message: "Draft saved", studio_url: "https://inst.studio.test/ide?workspace_name=ws&fileId=123" },
        ai_message: expect.any(String),
      })
    } finally {
      responses.set(savePath, respond)
    }
  })
}

for (const name of ["", " \t "]) {
  for (const args of [
    ["save-content", "123", "--content", "SELECT 1", "--params", JSON.stringify({ [name]: storedValue })],
    ["create-setup", "sample", "--folder", "10", "--type", "SQL", "--content", "SELECT 1", "--params", JSON.stringify({ [name]: storedValue })],
    ["save-config", "123", "--param", `${name}=${storedValue}`],
  ]) {
    test(`task ${args[0]} rejects parameter name ${JSON.stringify(name)} before writing`, async () => {
      const result = await runTask(args)
      expect({
        succeeded: result.code === 0,
        error: JSON.parse(result.stdout).error?.code,
        writes: requests.filter((path) => path === createPath || path === savePath),
        exposed: (result.stdout + result.stderr).includes(storedValue),
      }).toEqual({ succeeded: false, error: "INVALID_ARGUMENTS", writes: [], exposed: false })
    })
  }
}

test("legacy task save can write a Studio-only draft while save-content rejects it", async () => {
  const respond = responses.get(detailPath)!
  responses.set(detailPath, () => ok({ id: 123, fileType: 500, paramValueList: parameters }))
  try {
    const publicSave = await saveWithDebug()
    expect(saves).toHaveLength(0)
    expect(JSON.parse(publicSave.stdout).error.code).toBe("UI_ONLY_TASK")
    const legacySave = await saveWithDebug("save")
    expect(legacySave.code, legacySave.stdout + legacySave.stderr).toBe(0)
    expect(saves).toHaveLength(1)
    expect(saves[0]).toMatchObject({ onlySaveContent: 1, paramValueList: parameters })
  } finally {
    responses.set(detailPath, respond)
  }
})

for (const typeFields of [
  { fileType: 500, taskDetail: { fileType: 4 } },
  { file_type: "4", taskDetail: { fileType: "500" } },
  { fileType: 4, file_type: 500 },
]) {
  test(`both content saves reject conflicting draft types (${JSON.stringify(typeFields)})`, async () => {
    const respond = responses.get(detailPath)!
    responses.set(detailPath, () => ok({ id: 123, ...typeFields, paramValueList: parameters }))
    try {
      for (const command of ["save-content", "save"]) {
        const result = await saveWithDebug(command)
        expect(saves).toHaveLength(0)
        expect(result.code).not.toBe(0)
        expect(JSON.parse(result.stdout).error.code).toBe("INVALID_RESPONSE")
      }
    } finally {
      responses.set(detailPath, respond)
    }
  })
}

test("save-content accepts matching numeric and string draft types", async () => {
  const respond = responses.get(detailPath)!
  responses.set(detailPath, () => ok({ id: 123, fileType: 4, taskDetail: { file_type: "4", paramValueList: parameters } }))
  try {
    const result = await saveWithDebug()
    expect(result.code, result.stderr).toBe(0)
    expect(saves).toEqual([expect.objectContaining({ paramValueList: parameters })])
  } finally {
    responses.set(detailPath, respond)
  }
})

test("legacy task save requires readable draft parameters even without a task type", async () => {
  const respond = responses.get(detailPath)!
  try {
    responses.set(detailPath, () => ok({ id: 123, paramValueList: parameters }))
    const result = await saveWithDebug("save")
    expect(result.code, result.stdout + result.stderr).toBe(0)
    expect(saves[0]).toMatchObject({ paramValueList: parameters })
    for (const detail of [{}, { id: 123, paramValueList: storedValue }]) {
      responses.set(detailPath, () => ok(detail))
      const invalid = await saveWithDebug("save")
      expect(invalid.code).not.toBe(0)
      expect(JSON.parse(invalid.stdout).error.code).toBe("INVALID_RESPONSE")
      expect(invalid.stdout + invalid.stderr).not.toContain(storedValue)
      expect(saves).toHaveLength(0)
    }
  } finally {
    responses.set(detailPath, respond)
  }
})

for (const metadata of [{ encrypt: true, ref: 0 }, { encrypt: false, ref: 3 }]) {
  test(`save-config rejects protected parameter overrides before either write (${JSON.stringify(metadata)})`, async () => {
    const respond = responses.get(detailPath)!
    responses.set(detailPath, () => ok({ id: 123, fileType: 4, paramValueList: [{ ...parameters[0], ...metadata }, ...parameters.slice(1)] }))
    try {
      const result = await runTask(["save-config", "123", "--retry-count", "2", "--param", "example=updated", `secret_ref=${storedValue}`])
      expect({
        succeeded: result.code === 0,
        error: JSON.parse(result.stdout).error?.code,
        writes: saves.length,
        exposed: (result.stdout + result.stderr).includes(storedValue),
      }).toEqual({ succeeded: false, error: "INVALID_ARGUMENTS", writes: 0, exposed: false })
    } finally {
      responses.set(detailPath, respond)
    }
  })
}

test("save-config preserves unrelated parameters and metadata in both writes", async () => {
  const result = await runTask(["save-config", "123", "--param", "example=$[yyyyMM]", "owner=synthetic-owner"])
  expect(result.code, result.stdout + result.stderr).toBe(0)
  const merged = [
    parameters[0],
    parameters[1],
    { ...parameters[2], paramValue: "$[yyyyMM]", paramType: "system" },
    expect.objectContaining({ paramKey: "owner", paramValue: "synthetic-owner", paramType: "manual" }),
  ]
  expect(saves).toEqual([
    expect.objectContaining({ onlySaveContent: 0, paramValueList: merged }),
    expect.objectContaining({ onlySaveContent: 1, paramValueList: merged }),
  ])
})

const telemetryValue = "synthetic-command-param-value"
for (const command of ["save-content", "save-config"]) {
  for (const inline of [false, true]) {
    test(`failed ${command} redacts ${inline ? "inline" : "separated"} parameter values in command telemetry`, async () => {
      const flag = command === "save-content" ? "params" : "param"
      const primary = command === "save-content" ? JSON.stringify({ secret_ref: telemetryValue }) : `secret_ref=${telemetryValue}`
      const result = await runTask([
        command, "123",
        ...(command === "save-content" ? ["--content", "SELECT 1"] : []),
        ...(inline ? [`--${flag}=${primary}`] : [`--${flag}`, primary]),
        ...(command === "save-config" ? ["synthetic-extra-key=synthetic-extra-value"] : []),
      ], false, true)
      expect(result.code).not.toBe(0)
      expect(JSON.parse(result.stdout).error.code).toBe("INVALID_ARGUMENTS")
      expect(saves).toHaveLength(0)
      expect(result.commandLogs).toHaveLength(1)
      const record = JSON.parse(result.commandLogs[0]).resourceLogs[0].scopeLogs[0].logRecords[0]
      expect(record.body.stringValue).toBe(`Command task ${command} failed`)
      const attributes = Object.fromEntries(record.attributes.map((attr: { key: string; value: unknown }) => [attr.key, attr.value]))
      expect(attributes[`cz_cli.command.arg.${flag}`]).toEqual({ stringValue: "<redacted>" })
      expect(attributes["cz_cli.command.arg._positional"]).toEqual({ stringValue: command === "save-content" ? "123 SELECT 1 test json" : "123 test json" })
      for (const value of [telemetryValue, "secret_ref", "synthetic-extra-key", "synthetic-extra-value"]) {
        expect(result.commandLogs[0]).not.toContain(value)
      }
    })
  }
}

test("option validation rejects a params and clear conflict without putting params in telemetry", async () => {
  const result = await runTask([
    "save-content", "123", "--content", "SELECT 1", "--params", JSON.stringify({ secret_ref: telemetryValue }), "--clear-params",
  ], false, true)
  expect(result.code).toBe(2)
  expect(JSON.parse(result.stdout).error.code).toBe("USAGE_ERROR")
  expect(requests).toEqual(["/v1/logs"])
  expect(result.commandLogs).toHaveLength(1)
  expect(result.commandLogs[0]).toContain("<redacted>")
  expect(result.commandLogs[0]).not.toContain(telemetryValue)
  expect(result.commandLogs[0]).not.toContain("secret_ref")
})

for (const fileType of [0, "0", "", " ", "invalid", null]) {
  test(`task save-content validates draft file type ${JSON.stringify(fileType)}`, async () => {
    const respond = responses.get(detailPath)!
    responses.set(detailPath, () => ok({ id: 123, fileType, paramValueList: parameters }))
    try {
      const result = await saveWithDebug()
      if (fileType === 0 || fileType === "0") {
        expect(result.code, result.stdout + result.stderr).toBe(0)
        expect(saves).toHaveLength(1)
        expect(saves[0]).toMatchObject({ paramValueList: parameters })
        return
      }
      expect(result.code).not.toBe(0)
      expect(JSON.parse(result.stdout).error.code).toBe("INVALID_RESPONSE")
      expect(saves).toHaveLength(0)
    } finally {
      responses.set(detailPath, respond)
    }
  })
}

for (const args of [
  ["save-content", "123", "--content", "SELECT 1"],
  ["create-setup", "sample", "--folder", "10", "--type", "SQL", "--content", "SELECT 1"],
]) {
  test.each([
    JSON.stringify({ month: storedValue, bad: null }),
    JSON.stringify({ month: storedValue }).slice(0, -1),
    JSON.stringify({ month: storedValue }).replaceAll('"', '\\"').slice(0, -1),
    JSON.stringify({ month: storedValue }).slice(1),
    `{"month":"${storedValue}}`,
    `{"month":"${storedValue}",}`,
    `{month:${storedValue},other:}`,
  ])(`task ${args[0]} rejects malformed params %s before network access`, async (raw) => {
    const result = await runTask([...args, "--params", raw])
    expect(result.code).not.toBe(0)
    expect(JSON.parse(result.stdout).error.code).toBe("INVALID_ARGUMENTS")
    expect(requests).toEqual([])
    expect(result.stdout + result.stderr).not.toContain(storedValue)
  })

  test.each([
    JSON.stringify({ date: "bizdate" }).replaceAll('"', '\\"'),
    "'{\"date\":\"bizdate\"}'",
    "{date:bizdate}",
  ])(`task ${args[0]} accepts Windows-compatible params %s`, async (raw) => {
    const result = await runTask([...args, "--params", raw])
    expect(result.code, result.stdout + result.stderr).toBe(0)
    expect(saves).toHaveLength(1)
    expect(saves[0]).toMatchObject({
      paramValueList: expect.arrayContaining([{ paramKey: "date", paramType: "system", paramValue: "bizdate", id: expect.any(String), ref: 0, encrypt: false, ignore: false }]),
    })
  })
}

test("create-setup saves valid params for script tasks", async () => {
  const result = await runTask(["create-setup", "sample", "--folder", "10", "--type", "SQL", "--content", "SELECT 1",
    "--params", JSON.stringify({ date: "bizdate" })])
  expect(result.code, result.stdout + result.stderr).toBe(0)
  expect(requests).toContain(createPath)
  expect(saves).toHaveLength(1)
  expect(saves[0]).toMatchObject({ paramValueList: [{ paramKey: "date", paramType: "system", paramValue: "bizdate" }] })
})

test("create-setup rolls back after a failed save with valid params", async () => {
  const respond = responses.get(savePath)!
  responses.set(savePath, () => Response.json({ code: 4001, message: storedValue }))
  try {
    const result = await runTask(["create-setup", "sample", "--folder", "10", "--type", "SQL", "--content", "SELECT 1",
      "--params", JSON.stringify({ date: "bizdate" })])
    expect(result.code).not.toBe(0)
    expect(requests.slice(-3)).toEqual([createPath, savePath, deletePath])
    expect(result.stdout + result.stderr).not.toContain(storedValue)
  } finally {
    responses.set(savePath, respond)
  }
})

test("create-setup keeps UI-only draft creation independent of script params", async () => {
  const result = await runTask(["create-setup", "sample", "--folder", "10", "--type", "INTEGRATION", "--content", "SELECT 1",
    "--params", JSON.stringify({ date: "bizdate" })])
  expect(result.code, result.stdout + result.stderr).toBe(0)
  expect(requests).toContain(createPath)
  expect(saves).toHaveLength(0)
})

test("create-setup rejects incomplete params even when the draft would not use them", async () => {
  for (const args of [["--type", "SQL"], ["--type", "INTEGRATION", "--content", "SELECT 1"]]) {
    const result = await runTask(["create-setup", "sample", "--folder", "10", ...args, "--params", '{"date":"bizdate"'])
    expect(result.code).toBe(2)
    expect(JSON.parse(result.stdout).error.code).toBe("INVALID_ARGUMENTS")
    expect(requests).toEqual([])
  }
})
