import { describe, expect, mock, test } from "bun:test"

const actualSdk = await import("@clickzetta/sdk")

mock.module("@clickzetta/sdk", () => ({
  ...actualSdk,
  studioRequest: async (_sc: unknown, path: string) => {
    if (path === "/llm-gateway-admin/v2/model/list") {
      return { code: 200, data: [], count: 0 }
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
    const result = await execute("ai-gateway model list czt_virtual_key")
    const json = firstJson(result.output)

    expect(result.exitCode).toBe(0)
    expect(json.data).toEqual([])
    expect(json.ai_message).toBe("No AIGW models returned. This usually means the virtual key VALUE is wrong (did you pass the alias by mistake?). Get the actual key value via: cz-cli ai-gateway key get <alias>")
  })
})
