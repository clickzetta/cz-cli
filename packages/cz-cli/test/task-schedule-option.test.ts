import { afterAll, beforeEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const home = mkdtempSync(join(tmpdir(), "cz-task-schedule-option-"))
const requests: Array<{ path: string; body: Record<string, unknown> }> = []
const savePath = "/ide-admin/v1/dataFileConfiguration/saveDataFileConfiguration"
const createPath = "/ide-admin/v1/dataFile/addAndReturnId"
const responses = new Map<string, unknown>([
  ["/clickzetta-portal/user/loginSingle", { token: "test-token", instanceId: 11, userId: 7, expireTime: 3_600_000 }],
  ["/clickzetta-portal/user/getCurrentUser", { id: 7, accountId: 5, name: "test-user" }],
  ["/ide-authority/v1/workspace/listUserWorkspaces", [{ workspaceId: 8, workspaceName: "ws", projectId: 9 }]],
  ["/ide-admin/v1/ai/mcp/listFiles", { list: [] }],
  [createPath, 123],
  ["/ide-admin/v1/dataFile/getDetail", { id: 123, fileType: 4, dataFileName: "example" }],
  ["/ide-admin/v1/dataFileConfiguration/getFileConfigurationDetail", { scheduleCreatedType: "1", etlVcId: 3 }],
  [savePath, { ok: true }],
])
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(request) {
    const path = new URL(request.url).pathname
    requests.push({ path, body: request.body ? await request.json() : {} })
    if (!responses.has(path)) return Response.json({ code: 404, message: `Unexpected request to ${path}` }, { status: 404 })
    return Response.json({ code: 0, data: responses.get(path) })
  },
})
await Bun.write(join(home, ".clickzetta", "profiles.toml"), `
[profiles.test]
service = "http://127.0.0.1:${server.port}"
protocol = "http"
instance = "inst"
workspace = "ws"
pat = "test-pat"
`)

afterAll(() => {
  server.stop(true)
  rmSync(home, { recursive: true, force: true })
})
beforeEach(() => {
  requests.length = 0
})

async function run(args: string[]) {
  const child = Bun.spawn([process.execPath, "src/main.ts", "task", ...args, "--profile", "test", "--format", "json"], {
    cwd: join(import.meta.dir, ".."),
    env: { HOME: home, CLICKZETTA_TEST_HOME: home, CLICKZETTA_DISABLE_AUTOUPDATE: "1" },
    stdout: "pipe",
    stderr: "pipe",
  })
  const [output, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  return { code, output, stderr }
}

const modeOption = "--schedule-created-type"
const cron = ["--cron", "0 30 2 * * ? *"]
const setup = ["--type", "SQL", "--folder", "42"]
const commands = [
  { command: ["save-config"], target: "123", options: [], expectedSave: {} },
  { command: ["save-cron"], target: "123", options: cron, expectedSave: { cronExpress: "0 30 02 * * ? *" } },
  { command: ["create-setup"], target: "example", options: [...setup, ...cron], expectedSave: { cronExpress: "0 30 02 * * ? *" } },
  { command: ["flow", "node-save-config"], target: "123", options: ["--node-id", "456"], expectedSave: { nodeId: 456, collectType: 2 } },
]
const invalidOptions = [
  [modeOption, "1.0"],
  [`${modeOption}=3`],
  [modeOption],
  [`${modeOption}=`],
  [modeOption, "1", `${modeOption}=1`],
  [`${modeOption}=2`, modeOption, "1"],
  [`${modeOption}=1`, "--scheduleCreatedType=2"],
  [`${modeOption}=1`, modeOption],
]

for (const { command, target, options, expectedSave } of commands) {
  describe(command.join(" "), () => {
    for (const mode of ["1", "2"]) {
      for (const args of [
        [modeOption, mode, target],
        [target, modeOption, mode],
        [`${modeOption}=${mode}`, target],
        [target, `${modeOption}=${mode}`],
      ]) {
        test(`accepts ${args.join(" ")}`, async () => {
          const result = await run([...command, ...args, ...options])
          expect(result.code, result.output + result.stderr).toBe(0)
          expect(requests.filter((request) => request.path === savePath)).toEqual([
            { path: savePath, body: expect.objectContaining({ dataFileId: 123, scheduleCreatedType: mode, ...expectedSave }) },
          ])
          if (command[0] === "create-setup") {
            expect(requests.find((request) => request.path === createPath)?.body.dataFileName).toBe(target)
          }
        })
      }
    }

    for (const flags of invalidOptions) {
      test(`rejects ${flags.join(" ")} before HTTP`, async () => {
        const result = await run([...command, target, ...options, ...flags])
        expect(result.code, result.output + result.stderr).toBe(2)
        expect(JSON.parse(result.output).error).toMatchObject({
          code: "INVALID_ARGUMENTS",
          message: expect.stringContaining(modeOption),
        })
        expect(requests).toEqual([])
      })
    }
  })
}

test("create-setup with a mode requires cron before HTTP", async () => {
  const result = await run(["create-setup", `${modeOption}=1`, "example", ...setup])
  expect(result.code, result.output + result.stderr).toBe(2)
  expect(result.output).toContain(`${modeOption} requires --cron`)
  expect(requests).toEqual([])
})
