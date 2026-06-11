import { describe, expect, mock, test } from "bun:test"

const actualSdk = await import("@clickzetta/sdk")
const modelListBodies: unknown[] = []

function modelRows(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    modelIdentifier: `model-${i + 1}`,
    modelName: `Model ${i + 1}`,
    modelDesc: `Desc ${i + 1}`,
  }))
}

mock.module("@clickzetta/sdk", () => ({
  ...actualSdk,
  studioRequest: async (_sc: unknown, path: string, body?: unknown) => {
    if (path === "/llm-gateway-admin/v2/model/list") {
      modelListBodies.push(body)
      if ((body as Record<string, unknown>).virtualKey === "empty_key") {
        return { code: 200, data: [], count: 0 }
      }
      const pageSize = typeof (body as Record<string, unknown> | undefined)?.pageSize === "number"
        ? (body as Record<string, number>).pageSize
        : 0
      return pageSize === 0
        ? { code: 200, data: [], count: 0 }
        : { code: 200, data: modelRows(Math.min(pageSize, 12)), count: 12 }
    }
    throw new Error(`unexpected gateway path: ${path}`)
  },
}))

mock.module("../src/commands/studio-context.js", () => ({
  getGatewayContext: async () => ({
    token: "token",
    instanceId: 1,
    workspaceId: 0,
    projectId: 0,
    userId: 2,
    tenantId: 3,
    instanceName: "inst",
    workspaceName: "",
    env: "dev",
    baseUrl: "https://example.clickzetta.com",
    customHeaders: {},
    userName: "user",
  }),
  getStudioContext: async () => ({}),
}))

mock.module("../src/logger.js", () => ({
  logOperation: () => {},
}))

const { execute } = await import("../src/execute.ts")

function firstJson(output: string) {
  return JSON.parse(output.trim().split("\n")[0] ?? "{}") as Record<string, unknown>
}

describe("ai-gateway model list", () => {
  test("explains empty model lists as likely missing AIGW admin permission", async () => {
    const result = await execute("ai-gateway model list empty_key")
    const json = firstJson(result.output)

    expect(result.exitCode).toBe(0)
    expect(json.data).toEqual([])
    expect(json.ai_message).toBe("No AIGW models returned. This usually means the virtual key VALUE is wrong (did you pass the alias by mistake?). Get the actual key value via: cz-cli ai-gateway key get <alias>")
  })

  test("defaults to 10 models and explains how to adjust the cap", async () => {
    const result = await execute("ai-gateway model list czt_virtual_key")
    const json = firstJson(result.output)

    expect(result.exitCode).toBe(0)
    expect((modelListBodies.at(-1) as Record<string, unknown>).pageSize).toBe(10)
    expect(json.count).toBe(10)
    expect(json.ai_message).toBe("Showing 10 of 12 models. Use --limit to increase the cap, or --no-limit to remove the default cap.")
  })

  test("passes explicit limit through to the model list page size", async () => {
    const result = await execute("ai-gateway model list czt_virtual_key --limit 3")
    const json = firstJson(result.output)

    expect(result.exitCode).toBe(0)
    expect((modelListBodies.at(-1) as Record<string, unknown>).pageSize).toBe(3)
    expect(json.count).toBe(3)
    expect(json.ai_message).toBe("Showing 3 of 12 models. Use --limit to increase the cap, or --no-limit to remove the default cap.")
  })

  test("no-limit disables the default ten model cap", async () => {
    const result = await execute("ai-gateway model list czt_virtual_key --no-limit")
    const json = firstJson(result.output)

    expect(result.exitCode).toBe(0)
    expect((modelListBodies.at(-1) as Record<string, unknown>).pageSize).toBe(200)
    expect(json.count).toBe(12)
    expect(json.ai_message).toBeUndefined()
  })

})
