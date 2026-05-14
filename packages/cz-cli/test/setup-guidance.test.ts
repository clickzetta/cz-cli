import { afterAll, describe, expect, test } from "bun:test"
import { spawn, spawnSync } from "child_process"
import { mkdtempSync } from "fs"
import { createServer } from "http"
import { tmpdir } from "os"
import { join } from "path"
import { accountLoginUrlForService, resolveOrAutoSelectOption } from "../src/commands/setup"

function run(args: string[], home = mkdtempSync(join(tmpdir(), "cz-setup-guidance-"))) {
  const result = spawnSync("bun", ["./src/main.ts", ...args], {
    cwd: import.meta.dir + "/..",
    encoding: "utf-8",
    env: { ...process.env, HOME: home },
    stdio: ["ignore", "pipe", "pipe"],
  })
  return {
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    exitCode: result.status ?? 1,
  }
}

function runAsync(args: string[], home = mkdtempSync(join(tmpdir(), "cz-setup-guidance-"))) {
  return new Promise<{ stdout: string; stderr: string; exitCode: number }>((resolve, reject) => {
    const child = spawn("bun", ["./src/main.ts", ...args], {
      cwd: import.meta.dir + "/..",
      env: { ...process.env, HOME: home },
      stdio: ["ignore", "pipe", "pipe"],
    })
    let stdout = ""
    let stderr = ""
    child.stdout.on("data", (chunk) => { stdout += chunk.toString() })
    child.stderr.on("data", (chunk) => { stderr += chunk.toString() })
    child.on("error", reject)
    child.on("close", (code) => {
      resolve({
        stdout,
        stderr,
        exitCode: code ?? 1,
      })
    })
  })
}

function firstJson(output: string) {
  return JSON.parse(output.trim().split("\n")[0] ?? "{}") as Record<string, unknown>
}

const servers = new Set<ReturnType<typeof createServer>>()

afterAll(() => {
  for (const server of servers) server.close()
})

describe("setup guidance", () => {
  test("builds account login urls for region and uat api services", () => {
    expect(accountLoginUrlForService("cn-shanghai-alicloud.api.clickzetta.com", "acct")).toBe(
      "https://acct.cn-shanghai-alicloud-accounts.clickzetta.com",
    )
    expect(accountLoginUrlForService("uat-api.clickzetta.com", "acct")).toBe(
      "https://acct.uat-accounts.clickzetta.com",
    )
  })

  test("resolveOrAutoSelectOption auto-selects the only discovered option", () => {
    const result = resolveOrAutoSelectOption(undefined, [{ label: "one", value: "one" }], "instance")
    expect(result.autoSelected).toBe(true)
    expect(result.option).toEqual({ label: "one", value: "one" })
  })

  test("resolveOrAutoSelectOption waits for user choice when multiple options exist", () => {
    const result = resolveOrAutoSelectOption(undefined, [
      { label: "one", value: "one" },
      { label: "two", value: "two" },
    ], "instance")
    expect(result.autoSelected).toBe(false)
    expect(result.option).toBeUndefined()
  })

  test("setup --help explains both new-user and existing-account flows", () => {
    const result = run(["setup", "--help"])
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain("Already have ClickZetta account")
    expect(result.stdout).toContain("username, password, and account name")
    expect(result.stdout).toContain("instance -> workspace -> schema -> vcluster")
    expect(result.stdout).toContain("Non-TTY / agent mode")
  })

  test("non-TTY setup with no args returns staged guidance with next_steps", () => {
    const result = run(["setup"])
    expect(result.exitCode).toBe(1)
    const json = firstJson(result.stdout)
    expect(json.step).toBe("account_fields")
    expect(json.status).toBe("needs_input")
    expect(json.flow).toEqual(["account_fields", "service", "instance", "workspace", "schema", "vcluster", "complete"])
    expect(json.next_steps).toEqual([
      "cz-cli setup --credential <BASE64_CREDENTIAL>",
      "cz-cli setup --username <USERNAME> --password <PASSWORD> --account-name <ACCOUNT_NAME>",
    ])
  })

  test("non-TTY existing-account setup returns next step command when service is missing", () => {
    const result = run(["setup", "--username", "u", "--password", "p", "--account-name", "acct"])
    expect(result.exitCode).toBe(1)
    const json = firstJson(result.stdout)
    expect(json.step).toBe("service")
    expect(json.status).toBe("needs_input")
    expect(Array.isArray(json.options)).toBe(true)
    expect(json.collected).toEqual({ username: "u", account_name: "acct" })
    expect(json.next_steps).toEqual([
      'cz-cli setup --username "u" --password <PASSWORD> --account-name "acct" --service <SERVICE_ENDPOINT>',
    ])
  })

  test("existing-account setup falls back to instance login for api services", async () => {
    const server = createServer(async (request, response) => {
      if (request.url === "/clickzetta-portal/user/loginSingle" && request.method === "POST") {
        const body = await new Promise<string>((resolve) => {
          let buffer = ""
          request.setEncoding("utf8")
          request.on("data", (chunk) => { buffer += chunk })
          request.on("end", () => resolve(buffer))
        })
        const payload = JSON.parse(body) as Record<string, unknown>
        if (payload.instanceName !== "acct") {
          response.writeHead(400, { "content-type": "application/json" })
          response.end(JSON.stringify({ code: 400, message: "unexpected instance" }))
          return
        }
        response.writeHead(200, { "content-type": "application/json" })
        response.end(JSON.stringify({
          code: 0,
          data: {
            token: "header.eyJ1c2VySWQiOjEsImFjY291bnRJZCI6M30.signature",
            userId: 1,
            instanceId: 11,
            expireTime: Date.now() + 60_000,
          },
        }))
        return
      }
      if (request.url === "/clickzetta-portal/service/serviceInstanceList?accountId=3") {
        response.writeHead(200, { "content-type": "application/json" })
        response.end(JSON.stringify({
          code: 0,
          data: [
            { serviceId: 1, instanceId: 11, instanceName: "acct", cspId: 1, regionId: 1 },
            { serviceId: 1, instanceId: 12, instanceName: "other", cspId: 1, regionId: 1 },
          ],
        }))
        return
      }
      if (request.url === "/ide-authority/v1/workspace/listUserWorkspaces" && request.method === "POST") {
        response.writeHead(200, { "content-type": "application/json" })
        response.end(JSON.stringify({
          code: 0,
          data: [
            {
              workspaceName: "ws1",
              workspaceId: "wid-1",
              projectId: 9,
              defaultSchemaName: "public",
              defaultVcName: "DEFAULT",
            },
            {
              workspaceName: "ws2",
              workspaceId: "wid-2",
              projectId: 10,
              defaultSchemaName: "public",
              defaultVcName: "DEFAULT",
            },
          ],
        }))
        return
      }
      response.writeHead(404, { "content-type": "application/json" })
      response.end(JSON.stringify({ code: 404, message: "not found" }))
    })
    servers.add(server)
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()))
    const address = server.address()
    if (!address || typeof address === "string") throw new Error("server address unavailable")

    const result = await runAsync([
      "setup",
      "--username", "u",
      "--password", "p",
      "--account-name", "acct",
      "--service", `http://127.0.0.1:${address.port}`,
    ])

    expect(result.exitCode).toBe(1)
    const json = firstJson(result.stdout)
    expect(json.step).toBe("workspace")
    expect(json.status).toBe("needs_input")
    expect(json.collected).toEqual({
      username: "u",
      account_name: "acct",
      service: `127.0.0.1:${address.port}`,
      instance: "acct",
    })
  })

  test("existing-account setup auto-selects instance when account name matches one discovered instance", async () => {
    const server = createServer(async (request, response) => {
      if (request.url === "/clickzetta-portal/user/loginSingle" && request.method === "POST") {
        response.writeHead(200, { "content-type": "application/json" })
        response.end(JSON.stringify({
          code: 0,
          data: {
            token: "header.eyJ1c2VySWQiOjEsImFjY291bnRJZCI6M30.signature",
            userId: 1,
            instanceId: 11,
            expireTime: Date.now() + 60_000,
          },
        }))
        return
      }
      if (request.url === "/clickzetta-portal/service/serviceInstanceList?accountId=3") {
        response.writeHead(200, { "content-type": "application/json" })
        response.end(JSON.stringify({
          code: 0,
          data: [
            { serviceId: 1, instanceId: 11, instanceName: "acct", cspId: 1, regionId: 1 },
            { serviceId: 1, instanceId: 12, instanceName: "other", cspId: 1, regionId: 1 },
          ],
        }))
        return
      }
      if (request.url === "/ide-authority/v1/workspace/listUserWorkspaces" && request.method === "POST") {
        response.writeHead(200, { "content-type": "application/json" })
        response.end(JSON.stringify({
          code: 0,
          data: [
            {
              workspaceName: "ws1",
              workspaceId: "wid-1",
              projectId: 9,
              defaultSchemaName: "public",
              defaultVcName: "DEFAULT",
            },
          ],
        }))
        return
      }
      if (request.url === "/clickzetta-groot/api/v1/entity/centre/schema/list?env=PROD" && request.method === "POST") {
        response.writeHead(200, { "content-type": "application/json" })
        response.end(JSON.stringify({
          code: 0,
          data: [{ entityName: "public" }],
        }))
        return
      }
      if (request.url === "/clickzetta-lakeconsole/api/v1/vcluster/centre/list" && request.method === "POST") {
        response.writeHead(200, { "content-type": "application/json" })
        response.end(JSON.stringify({
          code: 0,
          data: [{ code: "DEFAULT" }],
        }))
        return
      }
      response.writeHead(404, { "content-type": "application/json" })
      response.end(JSON.stringify({ code: 404, message: "not found", url: request.url }))
    })
    servers.add(server)
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()))
    const address = server.address()
    if (!address || typeof address === "string") throw new Error("server address unavailable")

    const result = await runAsync([
      "setup",
      "--username", "u",
      "--password", "p",
      "--account-name", "acct",
      "--service", `http://127.0.0.1:${address.port}`,
    ])

    expect(result.exitCode).toBe(0)
    const json = firstJson(result.stdout)
    expect((json.data as Record<string, unknown>).instance).toBe("acct")
    expect((json.data as Record<string, unknown>).workspace).toBe("ws1")
    expect((json.data as Record<string, unknown>).schema).toBe("public")
    expect((json.data as Record<string, unknown>).vcluster).toBe("DEFAULT")
  })
})
