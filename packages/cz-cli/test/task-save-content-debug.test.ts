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

async function runTask(...args: string[]) {
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
    process.execPath, "--preload", "./test/fixtures/studio-cli-transport.ts", "src/main.ts", "--debug", "task", ...args, "--profile", "test", "--format", "json",
  ], {
    cwd: join(import.meta.dir, ".."),
    env: { HOME: home, CLICKZETTA_TEST_HOME: home, CLICKZETTA_DISABLE_AUTOUPDATE: "1" },
    stdout: "pipe",
    stderr: "pipe",
  })
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  for (const line of (await Bun.file(requestFile).text()).trim().split("\n").filter(Boolean)) {
    const request = JSON.parse(line)
    requests.push(request.path)
    if (request.path === savePath) saves.push(JSON.parse(request.body))
  }
  return { stdout, stderr, code }
}

function saveWithDebug(command = "save-content") {
  return runTask(command, "123", "--content", "SELECT 1")
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

test("create-setup rejects malformed params before creating and keeps values out of diagnostics", async () => {
  const result = await runTask("create-setup", "sample", "--folder", "10", "--type", "SQL", "--content", "SELECT 1",
    "--params", JSON.stringify({ secret: storedValue, bad: null }))
  expect({
    code: result.code,
    error: JSON.parse(result.stdout).error.code,
    requests: [...requests],
    exposed: (result.stdout + result.stderr).includes(storedValue),
  }).toEqual({ code: 2, error: "INVALID_ARGUMENTS", requests: [], exposed: false })
})

test("create-setup saves valid params for script tasks", async () => {
  const result = await runTask("create-setup", "sample", "--folder", "10", "--type", "SQL", "--content", "SELECT 1",
    "--params", JSON.stringify({ date: "bizdate" }))
  expect(result.code, result.stdout + result.stderr).toBe(0)
  expect(requests).toContain(createPath)
  expect(saves).toHaveLength(1)
  expect(saves[0]).toMatchObject({ paramValueList: [{ paramKey: "date", paramType: "system", paramValue: "bizdate" }] })
})

test("create-setup rolls back after a failed save with valid params", async () => {
  const respond = responses.get(savePath)!
  responses.set(savePath, () => Response.json({ code: 4001, message: storedValue }))
  try {
    const result = await runTask("create-setup", "sample", "--folder", "10", "--type", "SQL", "--content", "SELECT 1",
      "--params", JSON.stringify({ date: "bizdate" }))
    expect(result.code).not.toBe(0)
    expect(requests.slice(-3)).toEqual([createPath, savePath, deletePath])
    expect(result.stdout + result.stderr).not.toContain(storedValue)
  } finally {
    responses.set(savePath, respond)
  }
})

test("create-setup keeps UI-only draft creation independent of script params", async () => {
  const result = await runTask("create-setup", "sample", "--folder", "10", "--type", "INTEGRATION", "--content", "SELECT 1",
    "--params", JSON.stringify({ invalid: null }))
  expect(result.code, result.stdout + result.stderr).toBe(0)
  expect(requests).toContain(createPath)
  expect(saves).toHaveLength(0)
})
