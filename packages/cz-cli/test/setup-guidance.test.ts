import { afterAll, describe, expect, test } from "bun:test"
import { spawn, spawnSync } from "child_process"
import { mkdtempSync, readFileSync } from "fs"
import { createServer } from "http"
import { tmpdir } from "os"
import { join } from "path"
import { JDBC_EXAMPLE, SETUP_LOGIN_METHODS, accountLoginUrlForService, browserOpenCommandForPlatform, resolveOrAutoSelectOption } from "../src/commands/setup"

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

function readProfiles(home: string) {
  return readFileSync(join(home, ".clickzetta", "profiles.toml"), "utf-8")
}

const servers = new Set<ReturnType<typeof createServer>>()

afterAll(() => {
  for (const server of servers) server.close()
})

describe("setup guidance", () => {
  test("shares the new login-method copy across TTY and staged setup", () => {
    expect(SETUP_LOGIN_METHODS).toEqual([
      {
        label: "ClickZetta - https://accounts.clickzetta.com/login",
        value: "clickzetta",
      },
      {
        label: "Singdata  - https://accounts.singdata.com/login",
        value: "singdata",
      },
      {
        label: "Custom URL - Enter a login page URL or paste a JDBC connection string",
        value: "custom",
      },
    ])
  })

  test("builds account login urls for region and uat api services", () => {
    expect(accountLoginUrlForService("cn-shanghai-alicloud.api.clickzetta.com", "acct")).toBe(
      "https://acct.cn-shanghai-alicloud-accounts.clickzetta.com",
    )
    expect(accountLoginUrlForService("uat-api.clickzetta.com", "acct")).toBe(
      "https://acct.uat-accounts.clickzetta.com",
    )
  })

  test("builds account login urls from full service urls with api paths", () => {
    expect(accountLoginUrlForService("https://fumi-cn-south-1-huaweicloud.clickzetta.com/api", "acct")).toBe(
      "https://acct.accounts.clickzetta.com",
    )
  })

  test("uses cmd.exe for Windows browser open because start is a shell builtin", () => {
    expect(browserOpenCommandForPlatform("win32", "https://accounts.clickzetta.com/register?ref=cz-cli")).toEqual({
      command: "cmd.exe",
      args: ["/c", "start", "", "https://accounts.clickzetta.com/register?ref=cz-cli"],
    })
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

  test("setup --help explains the login-method flow and JDBC example", () => {
    const result = run(["setup", "--help"])
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain("Choose a login method:")
    expect(result.stdout).toContain("1. ClickZetta - https://accounts.clickzetta.com/login")
    expect(result.stdout).toContain("2. Singdata  - https://accounts.singdata.com/login")
    expect(result.stdout).toContain("3. Custom URL - Enter a login page URL or paste a JDBC connection string")
    expect(result.stdout.replace(/\s+/g, "")).toContain(JDBC_EXAMPLE.replace(/\s+/g, ""))
  })

  test("non-TTY setup with no args returns staged login-method guidance", () => {
    const result = run(["setup"])
    expect(result.exitCode).toBe(1)
    const json = firstJson(result.stdout)
    expect(json.step).toBe("login_method")
    expect(json.status).toBe("needs_input")
    expect(json.flow).toEqual(["login_method", "credentials", "instance", "workspace", "schema", "vcluster", "complete"])
    expect(json.options).toEqual(SETUP_LOGIN_METHODS)
    expect(json.next_steps).toEqual([
      "cz-cli setup --login-method clickzetta",
      "cz-cli setup --login-method singdata",
      "cz-cli setup --login-method custom --login <LOGIN_URL_OR_JDBC>",
    ])
  })

  test("non-TTY custom setup asks for a login URL or JDBC string", () => {
    const result = run(["setup", "--login-method", "custom"])
    expect(result.exitCode).toBe(1)
    const json = firstJson(result.stdout)
    expect(json.step).toBe("credentials")
    expect(json.status).toBe("needs_input")
    expect(json.required).toEqual(["login"])
    expect(json.jdbc_example).toBe(JDBC_EXAMPLE)
    expect(json.collected).toEqual({ login_method: "custom" })
    expect(json.next_steps).toEqual([
      `cz-cli setup --login-method custom --login ${JSON.stringify(JDBC_EXAMPLE)}`,
      "cz-cli setup --login-method custom --login <LOGIN_PAGE_URL>",
    ])
  })

  test("non-TTY JDBC setup asks only for the missing required fields", () => {
    const result = run([
      "setup",
      "--login-method", "custom",
      "--login", "jdbc:clickzetta://00000000.cn-hangzhou-alicloud.api.clickzetta.com/workspace?schema=public",
    ])
    expect(result.exitCode).toBe(1)
    const json = firstJson(result.stdout)
    expect(json.step).toBe("credentials")
    expect(json.status).toBe("needs_input")
    expect(json.required).toEqual(["username", "password", "vcluster"])
    expect(json.collected).toEqual({
      login_method: "custom",
      service: "cn-hangzhou-alicloud.api.clickzetta.com",
      instance: "00000000",
      workspace: "workspace",
      schema: "public",
    })
    expect(json.next_steps).toEqual([
      'cz-cli setup --login-method custom --login "jdbc:clickzetta://00000000.cn-hangzhou-alicloud.api.clickzetta.com/workspace?schema=public" --workspace "workspace" --username <USERNAME> --password <PASSWORD> --vcluster <VCLUSTER>',
    ])
  })

  test("non-TTY JDBC setup without workspace asks for it", () => {
    const result = run([
      "setup",
      "--login-method", "custom",
      "--login", "jdbc:clickzetta://00000000.cn-hangzhou-alicloud.api.clickzetta.com/?username=alice&password=secret&virtualCluster=DEFAULT",
    ])
    expect(result.exitCode).toBe(1)
    const json = firstJson(result.stdout)
    expect(json.step).toBe("credentials")
    expect(json.status).toBe("needs_input")
    expect((json.required as string[]).includes("workspace")).toBe(true)
  })

  test("non-TTY clickzetta setup returns login_url instead of credential fields", () => {
    const result = run(["setup", "--login-method", "clickzetta"])
    expect(result.exitCode).toBe(1)
    const json = firstJson(result.stdout)
    expect(json.step).toBe("credentials")
    expect(json.status).toBe("needs_input")
    expect(json.login_url).toBe("https://accounts.clickzetta.com/login?ref=cz-cli")
    expect(json.register_url).toBe("https://accounts.clickzetta.com/register?ref=cz-cli")
    expect(json.required).toEqual(["credential"])
    expect(json.next_steps).toEqual(["cz-cli setup --credential <BASE64_CREDENTIAL>"])
  })

  test("non-TTY singdata setup returns login_url without register_url", () => {
    const result = run(["setup", "--login-method", "singdata"])
    expect(result.exitCode).toBe(1)
    const json = firstJson(result.stdout)
    expect(json.step).toBe("credentials")
    expect(json.status).toBe("needs_input")
    expect(json.login_url).toBe("https://accounts.singdata.com/login?ref=cz-cli")
    expect(json.register_url).toBeUndefined()
    expect(json.required).toEqual(["credential"])
  })

  test("non-TTY custom URL (non-JDBC) returns login_url with ref appended", () => {
    const result = run([
      "setup",
      "--login-method", "custom",
      "--login", "https://mycompany.clickzetta.com/login",
    ])
    expect(result.exitCode).toBe(1)
    const json = firstJson(result.stdout)
    expect(json.step).toBe("credentials")
    expect(json.status).toBe("needs_input")
    expect(json.login_url).toBe("https://mycompany.clickzetta.com/login?ref=cz-cli")
    expect(json.required).toEqual(["credential"])
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
      service: `http://127.0.0.1:${address.port}`,
      instance: "acct",
    })
  })

  test("existing-account setup preserves full service urls with api paths", async () => {
    const server = createServer(async (request, response) => {
      if (request.url === "/api/clickzetta-portal/user/loginSingle" && request.method === "POST") {
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
      if (request.url === "/api/clickzetta-portal/service/serviceInstanceList?accountId=3") {
        response.writeHead(200, { "content-type": "application/json" })
        response.end(JSON.stringify({
          code: 0,
          data: [
            { serviceId: 1, instanceId: 11, instanceName: "acct", cspId: 1, regionId: 1 },
          ],
        }))
        return
      }
      if (request.url === "/api/ide-authority/v1/workspace/listUserWorkspaces" && request.method === "POST") {
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

    const service = `http://127.0.0.1:${address.port}/api`
    const result = await runAsync([
      "setup",
      "--username", "u",
      "--password", "p",
      "--account-name", "acct",
      "--service", service,
    ])

    expect(result.exitCode).toBe(1)
    const json = firstJson(result.stdout)
    expect(json.step).toBe("workspace")
    expect(json.collected).toEqual({
      username: "u",
      account_name: "acct",
      service,
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

  test("existing-account setup saves full service urls with api paths into the profile", async () => {
    const server = createServer(async (request, response) => {
      if (request.url === "/api/clickzetta-portal/user/loginSingle" && request.method === "POST") {
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
      if (request.url === "/api/clickzetta-portal/service/serviceInstanceList?accountId=3") {
        response.writeHead(200, { "content-type": "application/json" })
        response.end(JSON.stringify({
          code: 0,
          data: [{ serviceId: 1, instanceId: 11, instanceName: "acct", cspId: 1, regionId: 1 }],
        }))
        return
      }
      if (request.url === "/api/ide-authority/v1/workspace/listUserWorkspaces" && request.method === "POST") {
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
      if (request.url === "/api/clickzetta-groot/api/v1/entity/centre/schema/list?env=PROD" && request.method === "POST") {
        response.writeHead(200, { "content-type": "application/json" })
        response.end(JSON.stringify({
          code: 0,
          data: [{ entityName: "public" }],
        }))
        return
      }
      if (request.url === "/api/clickzetta-lakeconsole/api/v1/vcluster/centre/list" && request.method === "POST") {
        response.writeHead(200, { "content-type": "application/json" })
        response.end(JSON.stringify({
          code: 0,
          data: [{ code: "DEFAULT" }],
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
    const home = mkdtempSync(join(tmpdir(), "cz-setup-guidance-"))
    const service = `http://127.0.0.1:${address.port}/api/`

    const result = await runAsync([
      "setup",
      "--username", "u",
      "--password", "p",
      "--account-name", "acct",
      "--service", service,
      "--workspace", "ws1",
      "--schema", "public",
      "--vcluster", "DEFAULT",
    ], home)

    expect(result.exitCode).toBe(0)
    expect(readProfiles(home)).toContain(`service = "http://127.0.0.1:${address.port}/api"`)
    expect(readProfiles(home)).toContain('account_name = "acct"')
  })
})
