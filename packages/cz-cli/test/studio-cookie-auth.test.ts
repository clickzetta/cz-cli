import { afterEach, expect, setDefaultTimeout, test } from "bun:test"
import { createServer } from "node:http"
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { clearTokenCache } from "@clickzetta/sdk"

afterEach(() => {
  clearTokenCache()
})

setDefaultTimeout(15_000)

function jwt(payload: Record<string, unknown>) {
  return ["header", Buffer.from(JSON.stringify(payload)).toString("base64url"), "signature"].join(".")
}

async function withHome<T>(name: string, run: (home: string) => Promise<T>) {
  const previousHome = process.env.HOME
  const previousTestHome = process.env.CLICKZETTA_TEST_HOME
  const home = mkdtempSync(join(tmpdir(), name))
  mkdirSync(join(home, ".clickzetta"), { recursive: true })
  process.env.HOME = home
  process.env.CLICKZETTA_TEST_HOME = home
  try {
    return await run(home)
  } finally {
    if (previousHome === undefined) delete process.env.HOME
    else process.env.HOME = previousHome
    if (previousTestHome === undefined) delete process.env.CLICKZETTA_TEST_HOME
    else process.env.CLICKZETTA_TEST_HOME = previousTestHome
    await Bun.$`rm -rf ${home}`
  }
}

test("getStudioContext resolves via profile Cookie token without hitting loginSingle", async () => {
  const token = jwt({ userId: 7, accountId: 3, instanceId: 86, exp: 4_102_444_800 })
  const cookie = `theme=light; X-ClickZetta-Token=${token}`
  const hits: string[] = []
  const cookies: Record<string, string | undefined> = {}
  let currentUserToken: string | undefined
  let workspaceToken: string | undefined

  const server = createServer(async (request, response) => {
    const path = (request.url ?? "").split("?")[0]
    hits.push(request.url ?? "")
    cookies[path] = request.headers["cookie"] as string | undefined
    const bodyChunks: Uint8Array[] = []
    for await (const chunk of request) bodyChunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk)

    if (request.url === "/clickzetta-portal/user/getCurrentUser" && request.method === "POST") {
      currentUserToken = request.headers["x-clickzetta-token"] as string | undefined
      response.writeHead(200, { "content-type": "application/json" })
      response.end(JSON.stringify({ code: 0, data: { id: 7, accountId: 3, name: "tester", instanceId: 86 } }))
      return
    }

    if (path === "/clickzetta-portal/service/serviceInstanceList") {
      response.writeHead(200, { "content-type": "application/json" })
      response.end(JSON.stringify({ code: 0, data: [{ id: 86, name: "acct", serviceId: 1 }] }))
      return
    }

    if (request.url === "/ide-authority/v1/workspace/listUserWorkspaces" && request.method === "POST") {
      workspaceToken = request.headers["x-clickzetta-token"] as string | undefined
      response.writeHead(200, { "content-type": "application/json" })
      response.end(JSON.stringify({
        code: 0,
        data: [{ workspaceName: "ws", workspaceId: "wid-1", projectId: 9, projectName: "ws", showName: "ws" }],
      }))
      return
    }

    response.writeHead(404, { "content-type": "application/json" })
    response.end(JSON.stringify({ code: 404, message: "not found" }))
  })

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()))
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("server address unavailable")
  const service = `127.0.0.1:${address.port}`

  await withHome("cz-studio-cookie-", async (home) => {
    writeFileSync(
      join(home, ".clickzetta", "profiles.toml"),
      [
        'default_profile = "cookie"',
        "",
        "[profiles.cookie]",
        `service = "${service}"`,
        'protocol = "http"',
        'instance = "acct"',
        'workspace = "ws"',
        "",
        "[profiles.cookie.header]",
        `"Cookie" = "${cookie}"`,
        "",
      ].join("\n"),
    )

    const { getStudioContext } = await import(`../src/commands/studio-context.ts?studio-cookie-${Date.now()}`)
    try {
      const ctx = await getStudioContext({ format: "json" })
      expect(ctx.token).toBe(token)
      expect(ctx.userId).toBe(7)
      expect(ctx.instanceId).toBe(86)
      expect(ctx.workspaceId).toBe("wid-1")
      expect(ctx.projectId).toBe(9)
      expect(currentUserToken).toBe(token)
      expect(workspaceToken).toBe(token)
      // Every identity-resolution preflight must carry the profile Cookie, not
      // just the token extracted from it — deployments that authenticate the
      // session cookie reject these calls otherwise.
      expect(cookies["/clickzetta-portal/user/getCurrentUser"]).toBe(cookie)
      expect(cookies["/clickzetta-portal/service/serviceInstanceList"]).toBe(cookie)
      expect(cookies["/ide-authority/v1/workspace/listUserWorkspaces"]).toBe(cookie)
      // Cookie token must never trigger a login exchange.
      expect(hits).not.toContain("/clickzetta-portal/user/loginSingle")
    } finally {
      if (server.listening) {
        try {
          server.closeAllConnections()
        } catch {}
        await new Promise<void>((resolve) => server.close(() => resolve()))
      }
    }
  })
})
