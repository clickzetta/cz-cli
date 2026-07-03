import { afterEach, expect, setDefaultTimeout, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { createServer } from "node:http"
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { clearTokenCache } from "@clickzetta/sdk"

setDefaultTimeout(15_000)

afterEach(() => {
  clearTokenCache()
})

function firstJson(output: string) {
  return JSON.parse(output.trim().split("\n")[0] ?? "{}") as Record<string, unknown>
}

function data(output: string) {
  return firstJson(output).data as Record<string, unknown>
}

function errorPayload(output: string) {
  return firstJson(output).error as Record<string, unknown>
}

function run(args: string[], home: string, env?: NodeJS.ProcessEnv) {
  const result = spawnSync("bun", ["./src/main.ts", ...args, "--format", "json"], {
    cwd: import.meta.dir + "/..",
    encoding: "utf-8",
    env: { ...process.env, HOME: home, CLICKZETTA_TEST_HOME: home, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  })
  return { output: result.stdout ?? "", stderr: result.stderr ?? "", exitCode: result.status ?? 1 }
}

async function execute(command: string) {
  const { execute: runCommand } = await import(`../src/execute.ts?profile-login-url-${Date.now()}`)
  return runCommand(command)
}

async function withHome<T>(name: string, runWithHome: (home: string) => Promise<T>) {
  const previousHome = process.env.HOME
  const previousTestHome = process.env.CLICKZETTA_TEST_HOME
  const home = mkdtempSync(join(tmpdir(), name))
  mkdirSync(join(home, ".clickzetta"), { recursive: true })
  process.env.HOME = home
  process.env.CLICKZETTA_TEST_HOME = home
  try {
    return await runWithHome(home)
  } finally {
    if (previousHome === undefined) delete process.env.HOME
    else process.env.HOME = previousHome
    if (previousTestHome === undefined) delete process.env.CLICKZETTA_TEST_HOME
    else process.env.CLICKZETTA_TEST_HOME = previousTestHome
    await Bun.$`rm -rf ${home}`
  }
}

function writeProfiles(home: string, body: string) {
  writeFileSync(join(home, ".clickzetta", "profiles.toml"), body)
}

test("profile login-url uses default_profile when no name is passed", async () => {
  await withHome("cz-profile-login-url-default-", async (home) => {
    writeProfiles(home, [
      'default_profile = "prod"',
      "",
      "[profiles.prod]",
      'service = "https://cn-shanghai-alicloud.api.clickzetta.com"',
      'protocol = "https"',
      'instance = "inst"',
      'workspace = "ws"',
      'tenant_name = "vmhmdkcc"',
      "",
    ].join("\n"))

    const result = run(["profile", "login-url"], home)

    expect(result.exitCode).toBe(0)
    expect(data(result.output)).toEqual({
      profile: "prod",
      service: "https://cn-shanghai-alicloud.api.clickzetta.com",
      instance: "inst",
      tenant_name: "vmhmdkcc",
      tenant_name_source: "profile",
      web_login_url: "https://vmhmdkcc.cn-shanghai-alicloud-accounts.clickzetta.com",
      opened: false,
    })
  })
})

test("--tenant-name overrides cached and remote tenant resolution", async () => {
  await withHome("cz-profile-login-url-tenant-arg-", async (home) => {
    writeProfiles(home, [
      'default_profile = "prod"',
      "",
      "[profiles.prod]",
      'service = "https://cn-shanghai-alicloud.api.clickzetta.com"',
      'protocol = "https"',
      'instance = "inst"',
      'workspace = "ws"',
      'pat = "czt_test_pat"',
      'tenant_name = "cached-tenant"',
      "",
    ].join("\n"))

    const result = run(["profile", "login-url", "--tenant-name", "arg-tenant", "--resolve"], home)

    expect(result.exitCode).toBe(0)
    expect(data(result.output)).toEqual({
      profile: "prod",
      service: "https://cn-shanghai-alicloud.api.clickzetta.com",
      instance: "inst",
      tenant_name: "arg-tenant",
      tenant_name_source: "arg",
      web_login_url: "https://arg-tenant.cn-shanghai-alicloud-accounts.clickzetta.com",
      opened: false,
    })
  })
})

test("--resolve uses PAT to fetch accountDisplayName", async () => {
  let loginHits = 0
  let currentUserHits = 0

  const server = createServer(async (request, response) => {
    if (request.url === "/clickzetta-portal/user/loginSingle" && request.method === "POST") {
      loginHits += 1
      response.writeHead(200, { "content-type": "application/json", connection: "close" })
      response.end(JSON.stringify({
        code: 0,
        data: {
          token: "test-token",
          userId: 7,
          instanceId: 11,
          expireTime: Date.now() + 60_000,
        },
      }))
      return
    }
    if (request.url === "/clickzetta-portal/user/getCurrentUser" && request.method === "POST") {
      currentUserHits += 1
      response.writeHead(200, { "content-type": "application/json", connection: "close" })
      response.end(JSON.stringify({
        code: 0,
        data: {
          id: 7,
          accountId: 3,
          name: "tester",
          instanceId: 11,
          accountDisplayName: "resolved-pat",
        },
      }))
      return
    }
    response.writeHead(404, { "content-type": "application/json" })
    response.end(JSON.stringify({ code: 404, message: "not found" }))
  })

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()))
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("server address unavailable")

  try {
    await withHome("cz-profile-login-url-pat-", async (home) => {
      writeProfiles(home, [
        'default_profile = "prod"',
        "",
        "[profiles.prod]",
        `service = "http://127.0.0.1:${address.port}"`,
        'protocol = "http"',
        'instance = "inst"',
        'workspace = "ws"',
        'pat = "czt_test_pat"',
        "",
      ].join("\n"))

      const result = await execute("profile login-url --resolve")

      expect(result.exitCode).toBe(0)
      expect(data(result.output)).toEqual({
        profile: "prod",
        service: `http://127.0.0.1:${address.port}`,
        instance: "inst",
        tenant_name: "resolved-pat",
        tenant_name_source: "resolved_pat",
        web_login_url: `http://resolved-pat.accounts.127.0.0.1:${address.port}`,
        opened: false,
      })
      expect(loginHits).toBe(1)
      expect(currentUserHits).toBe(1)
    })
  } finally {
    try {
      server.closeAllConnections()
    } catch {}
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})

test("--resolve uses username/password to fetch accountDisplayName", async () => {
  let loginHits = 0
  let currentUserHits = 0

  const server = createServer(async (request, response) => {
    if (request.url === "/clickzetta-portal/user/loginSingle" && request.method === "POST") {
      loginHits += 1
      response.writeHead(200, { "content-type": "application/json", connection: "close" })
      response.end(JSON.stringify({
        code: 0,
        data: {
          token: "test-token",
          userId: 9,
          instanceId: 12,
          expireTime: Date.now() + 60_000,
        },
      }))
      return
    }
    if (request.url === "/clickzetta-portal/user/getCurrentUser" && request.method === "POST") {
      currentUserHits += 1
      response.writeHead(200, { "content-type": "application/json", connection: "close" })
      response.end(JSON.stringify({
        code: 0,
        data: {
          id: 9,
          accountId: 4,
          name: "tester",
          instanceId: 12,
          accountDisplayName: "resolved-password",
        },
      }))
      return
    }
    response.writeHead(404, { "content-type": "application/json" })
    response.end(JSON.stringify({ code: 404, message: "not found" }))
  })

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()))
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("server address unavailable")

  try {
    await withHome("cz-profile-login-url-password-", async (home) => {
      writeProfiles(home, [
        'default_profile = "legacy"',
        "",
        "[profiles.legacy]",
        `service = "http://127.0.0.1:${address.port}"`,
        'protocol = "http"',
        'instance = "inst"',
        'workspace = "ws"',
        'username = "u"',
        'password = "p"',
        "",
      ].join("\n"))

      const result = await execute("profile login-url --resolve")

      expect(result.exitCode).toBe(0)
      expect(data(result.output)).toEqual({
        profile: "legacy",
        service: `http://127.0.0.1:${address.port}`,
        instance: "inst",
        tenant_name: "resolved-password",
        tenant_name_source: "resolved_password",
        web_login_url: `http://resolved-password.accounts.127.0.0.1:${address.port}`,
        opened: false,
      })
      expect(loginHits).toBe(1)
      expect(currentUserHits).toBe(1)
    })
  } finally {
    try {
      server.closeAllConnections()
    } catch {}
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})

test("profile login-url errors when tenant name is unavailable and resolve is disabled", async () => {
  await withHome("cz-profile-login-url-missing-tenant-", async (home) => {
    writeProfiles(home, [
      'default_profile = "prod"',
      "",
      "[profiles.prod]",
      'service = "https://cn-shanghai-alicloud.api.clickzetta.com"',
      'protocol = "https"',
      'instance = "inst"',
      'workspace = "ws"',
      'pat = "czt_test_pat"',
      "",
    ].join("\n"))

    const result = run(["profile", "login-url"], home)

    expect(result.exitCode).toBe(1)
    expect(errorPayload(result.output).code).toBe("TENANT_NAME_REQUIRED")
    expect(String(errorPayload(result.output).message ?? "")).toContain("--tenant-name")
    expect(String(errorPayload(result.output).message ?? "")).toContain("--resolve")
  })
})

test("profile login-url normalizes tenant-specific account urls", async () => {
  await withHome("cz-profile-login-url-account-host-", async (home) => {
    writeProfiles(home, [
      'default_profile = "prod"',
      "",
      "[profiles.prod]",
      'service = "https://dev-accounts.clickzetta.com"',
      'protocol = "https"',
      'instance = "inst"',
      'workspace = "ws"',
      'account_display_name = "tenant-a"',
      "",
    ].join("\n"))

    const result = run(["profile", "login-url"], home)

    expect(result.exitCode).toBe(0)
    expect(data(result.output)).toEqual({
      profile: "prod",
      service: "https://dev-accounts.clickzetta.com",
      instance: "inst",
      tenant_name: "tenant-a",
      tenant_name_source: "profile",
      web_login_url: "https://tenant-a.dev-accounts.clickzetta.com",
      opened: false,
    })
  })
})
