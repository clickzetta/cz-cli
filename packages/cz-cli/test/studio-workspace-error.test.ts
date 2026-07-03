import { afterEach, expect, setDefaultTimeout, test } from "bun:test"
import { createServer } from "node:http"
import { clearTokenCache } from "@clickzetta/sdk"
import { getStudioContext } from "../src/commands/studio-context.ts"
import { isHandledCliError } from "../src/output/index.ts"

function firstJson(output: string) {
  return JSON.parse(output.trim().split("\n")[0] ?? "{}") as Record<string, any>
}

afterEach(() => {
  clearTokenCache()
})

setDefaultTimeout(15_000)

test("getStudioContext emits a single WORKSPACE_NOT_FOUND error and stops", async () => {
  let workspaceRequestBody: Record<string, unknown> | undefined
  let workspaceRequestHeaders: Record<string, string> | undefined
  const chunks: string[] = []
  const originalStdoutWrite = process.stdout.write.bind(process.stdout)
  const savedExitCode = process.exitCode

  const server = createServer(async (request, response) => {
    const bodyChunks: Uint8Array[] = []
    for await (const chunk of request) {
      bodyChunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk)
    }
    const bodyText = Buffer.concat(bodyChunks).toString("utf-8")
    const body = bodyText ? JSON.parse(bodyText) as Record<string, unknown> : {}

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

    if (request.url === "/clickzetta-portal/user/getCurrentUser" && request.method === "POST") {
      response.writeHead(200, { "content-type": "application/json" })
      response.end(JSON.stringify({
        code: 0,
        data: {
          id: 1,
          accountId: 3,
          name: "tester",
          instanceId: 11,
        },
      }))
      return
    }

    if (request.url === "/ide-authority/v1/workspace/listUserWorkspaces" && request.method === "POST") {
      workspaceRequestBody = body
      workspaceRequestHeaders = Object.fromEntries(
        Object.entries(request.headers).flatMap(([key, value]) =>
          typeof value === "string" ? [[key, value]] : value ? [[key, value.join(",")]] : [],
        ),
      )
      response.writeHead(200, { "content-type": "application/json" })
      response.end(JSON.stringify({
        code: 0,
        data: [
          {
            workspaceName: "studio_internal_name",
            workspaceId: "wid-1",
            projectId: 9,
            projectName: "another_workspace",
            showName: "another_workspace",
          },
        ],
      }))
      return
    }

    response.writeHead(404, { "content-type": "application/json" })
    response.end(JSON.stringify({ code: 404, message: "not found" }))
  })

  process.stdout.write = ((chunk: string | Uint8Array) => {
    chunks.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf-8"))
    return true
  }) as typeof process.stdout.write
  process.exitCode = 0

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()))
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("server address unavailable")

  try {
    await getStudioContext({
      output: "json",
      pat: "czt_test_pat",
      service: `http://127.0.0.1:${address.port}`,
      protocol: "http",
      instance: "acct",
      workspace: "qa_test_prj01",
      schema: "tianzhu",
    })
    throw new Error("expected getStudioContext to fail")
  } catch (err) {
    expect(isHandledCliError(err)).toBe(true)
    expect(process.exitCode).toBe(1)
    const output = chunks.join("")
    const json = firstJson(output)
    expect(json.error.code).toBe("WORKSPACE_NOT_FOUND")
    expect(output.trim().split("\n")).toHaveLength(1)
    expect(output).not.toContain("TASK_ERROR")
    expect(output).not.toContain("undefined is not an object")
  } finally {
    process.stdout.write = originalStdoutWrite
    process.exitCode = savedExitCode
    if (server.listening) {
      try {
        server.closeAllConnections()
      } catch {}
      try {
        await new Promise<void>((resolve, reject) => server.close((closeError) => closeError ? reject(closeError) : resolve()))
      } catch {}
    }
  }

  expect(workspaceRequestBody).toEqual({
    forWrite: "true",
    listType: 4,
    pageIndex: 1,
    pageSize: 99999,
    tenantId: 3,
    userId: 1,
  })
  expect(workspaceRequestHeaders?.instanceid).toBe("11")
  expect(workspaceRequestHeaders?.userid).toBe("1")
  expect(workspaceRequestHeaders?.accountid).toBe("3")
  expect(workspaceRequestHeaders?.instancename).toBe("acct")
  expect(workspaceRequestHeaders?.tenantid).toBe("3")
})
