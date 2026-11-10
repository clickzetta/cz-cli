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
    // Isolate BOTH HOME and CLICKZETTA_TEST_HOME to this test's temp dir. The
    // global test preload sets CLICKZETTA_TEST_HOME; if we only override HOME it
    // leaks in via {...process.env} and the CLI writes there instead of `home`.
    env: { ...process.env, HOME: home, CLICKZETTA_TEST_HOME: home },
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
      // See run(): isolate CLICKZETTA_TEST_HOME too, not just HOME.
      env: { ...process.env, HOME: home, CLICKZETTA_TEST_HOME: home },
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
    // Region segments are dropped (accounts sites are global); env prefixes stay.
    expect(accountLoginUrlForService("cn-shanghai-alicloud.api.clickzetta.com", "acct")).toBe(
      "https://acct.accounts.clickzetta.com",
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
      "cz-cli auth login <name> --login-method clickzetta",
      "cz-cli auth login <name> --login-method singdata",
      "cz-cli auth login <name> --login-method custom --login <LOGIN_URL_OR_JDBC>",
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
      `cz-cli auth login <name> --login-method custom --login ${JSON.stringify(JDBC_EXAMPLE)}`,
      "cz-cli auth login <name> --login-method custom --login <LOGIN_PAGE_URL>",
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
      'cz-cli auth login <name> --login-method custom --login "jdbc:clickzetta://00000000.cn-hangzhou-alicloud.api.clickzetta.com/workspace?schema=public" --workspace "workspace" --username <USERNAME> --password <PASSWORD> --vcluster <VCLUSTER>',
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
    expect(json.next_steps).toEqual(["cz-cli auth login <name> --credential <BASE64_CREDENTIAL>"])
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

  // The account name is not an instance name. An API endpoint only accepts
  // instance-scoped password login, so when that guess fails the account must be
  // authenticated on its accounts site and its instances discovered instead.
  // `consoleOnService` models a path-style private deployment: the console (its meta
  // script and root /login) is served on the API host, with the API under /api.
  async function startAccountWithInstances(
    instances: string[],
    options: { consoleOnService?: boolean; mfa?: boolean } = {},
  ) {
    const api = options.consoleOnService ? "/api" : ""
    const seen = { instanceLogins: [] as unknown[], accountLogins: [] as string[] }
    const server = createServer(async (request, response) => {
      const body = await new Promise<string>((resolve) => {
        let buffer = ""
        request.setEncoding("utf8")
        request.on("data", (chunk) => { buffer += chunk })
        request.on("end", () => resolve(buffer))
      })
      const json = (status: number, payload: unknown) => {
        response.writeHead(status, { "content-type": "application/json" })
        response.end(JSON.stringify(payload))
      }
      if (options.consoleOnService && request.url?.startsWith("/one-combo-api/configCenter/script/getApolloConfig")) {
        response.writeHead(200, { "content-type": "application/javascript" })
        response.end(`window.__clickzettaFeConsoleMeta__ = {"apiGateway":"","encryptKey":""}`)
        return
      }
      if (request.url === `${api}/clickzetta-portal/user/loginSingle` && request.method === "POST") {
        seen.instanceLogins.push(JSON.parse(body).instanceName)
        return json(400, { code: 400, message: "No such element" })
      }
      if (request.url === "/login" && request.method === "POST") {
        seen.accountLogins.push(request.headers.host ?? "")
        if (options.mfa) return json(200, { code: 0, data: { mfaStatus: { enable: true, phone: "138****0000" } } })
        return json(200, { code: 0, data: { token: "header.eyJ1c2VySWQiOjEsImFjY291bnRJZCI6M30.signature" } })
      }
      if (request.url === `${api}/clickzetta-portal/service/serviceInstanceList?accountId=3`) {
        return json(200, {
          code: 0,
          data: instances.map((instanceName, index) => ({
            serviceId: 1, instanceId: 11 + index, instanceName, cspId: 1, regionId: 1,
          })),
        })
      }
      if (request.url === `${api}/ide-authority/v1/workspace/listUserWorkspaces` && request.method === "POST") {
        return json(200, {
          code: 0,
          data: ["ws1", "ws2"].map((workspaceName, index) => ({
            workspaceName, workspaceId: `wid-${index}`, projectId: 9 + index, defaultSchemaName: "public", defaultVcName: "DEFAULT",
          })),
        })
      }
      json(404, { code: 404, message: "not found" })
    })
    servers.add(server)
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()))
    const address = server.address()
    if (!address || typeof address === "string") throw new Error("server address unavailable")
    return { port: address.port, seen }
  }

  test("existing-account setup on an api service discovers the only instance when the account name is not one", async () => {
    const { port, seen } = await startAccountWithInstances(["prod"])
    const service = `http://localhost:${port}`

    const result = await runAsync([
      "setup",
      "--username", "u",
      "--password", "p",
      "--account-name", "acct",
      "--service", service,
    ])

    expect(seen.instanceLogins).toEqual(["acct"])
    expect(seen.accountLogins).toEqual([`acct.accounts.localhost:${port}`])
    expect(result.exitCode).toBe(1)
    const json = firstJson(result.stdout)
    expect(json.step).toBe("workspace")
    expect(json.collected).toEqual({ username: "u", account_name: "acct", service, instance: "prod" })
  })

  test("existing-account setup on an api service asks for the instance when the account has several", async () => {
    const { port } = await startAccountWithInstances(["prod", "staging"])
    const service = `http://localhost:${port}`

    const result = await runAsync([
      "setup",
      "--username", "u",
      "--password", "p",
      "--account-name", "acct",
      "--service", service,
    ])

    expect(result.exitCode).toBe(1)
    const json = firstJson(result.stdout)
    expect(json.step).toBe("instance")
    expect(json.status).toBe("needs_input")
    expect(JSON.stringify(json)).toContain("staging")
  })

  test("existing-account setup with an explicit --instance does not fall back to account discovery", async () => {
    const { port, seen } = await startAccountWithInstances(["prod"])

    const result = await runAsync([
      "setup",
      "--username", "u",
      "--password", "p",
      "--account-name", "acct",
      "--instance", "wrong",
      "--service", `http://localhost:${port}`,
    ])

    expect(result.exitCode).not.toBe(0)
    expect(seen.instanceLogins).toEqual(["wrong", "acct"])
    expect(seen.accountLogins).toEqual([])
  })

  test("existing-account setup on a path-style private deployment authenticates at the site root", async () => {
    const { port, seen } = await startAccountWithInstances(["prod"], { consoleOnService: true })
    // 127.0.0.1 has no account subdomain form, so reaching /login proves the root was used.
    const service = `http://127.0.0.1:${port}/api`

    const result = await runAsync([
      "setup",
      "--username", "u",
      "--password", "p",
      "--account-name", "acct",
      "--service", service,
    ])

    expect(seen.accountLogins).toEqual([`127.0.0.1:${port}`])
    expect(result.exitCode).toBe(1)
    const json = firstJson(result.stdout)
    expect(json.step).toBe("workspace")
    expect(json.collected).toEqual({ username: "u", account_name: "acct", service, instance: "prod" })
  })

  test("existing-account setup reports MFA instead of a missing token when the account requires it", async () => {
    const { port, seen } = await startAccountWithInstances(["prod"], { mfa: true })
    const service = `http://localhost:${port}`

    const result = await runAsync([
      "setup",
      "--username", "u",
      "--password", "p",
      "--account-name", "acct",
      "--service", service,
    ])

    expect(seen.accountLogins).toEqual([`acct.accounts.localhost:${port}`])
    expect(result.exitCode).not.toBe(0)
    const json = firstJson(result.stdout).error as Record<string, unknown>
    expect(json.code).toBe("ACCOUNT_MFA_REQUIRED")
    // Browser sign-in must target this endpoint: without --oauth-url, `auth login`
    // only offers the public regions (or refuses when non-interactive).
    expect(String(json.message)).toContain(`cz-cli auth login <name> --oauth-url ${service}`)
    expect(String(json.message)).not.toContain("token not found")
    expect(String(json.message)).not.toContain("INSTANCE_LOGIN_FAILED")
  })

  // The interactive flow used to treat every API-endpoint failure as a missing
  // instance name and prompt for one. util-linux `script` gives the CLI a real TTY.
  test.skipIf(process.platform !== "linux")(
    "interactive setup reports MFA without prompting for an instance name",
    async () => {
      const { port } = await startAccountWithInstances(["prod"], { mfa: true })
      const home = mkdtempSync(join(tmpdir(), "cz-setup-guidance-"))
      const child = spawn(
        "script",
        ["-qec", `bun ./src/main.ts setup --username u --password p --account-name acct --service http://localhost:${port}`, "/dev/null"],
        {
          cwd: import.meta.dir + "/..",
          env: { ...process.env, HOME: home, CLICKZETTA_TEST_HOME: home },
          stdio: ["pipe", "pipe", "pipe"],
        },
      )
      let output = ""
      child.stdout.on("data", (chunk) => { output += chunk.toString() })
      // A prompt waits for input forever; give the flow a bounded window instead.
      const timer = setTimeout(() => child.kill(), 20_000)
      const exitCode = await new Promise<number | null>((resolve) => child.on("close", resolve))
      clearTimeout(timer)

      expect(output).toContain("ACCOUNT_MFA_REQUIRED")
      expect(output).not.toContain("Instance name")
      expect(exitCode).toBe(1)
    },
    30_000,
  )
})
