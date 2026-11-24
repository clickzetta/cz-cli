import { describe, expect, test } from "bun:test"
import { staticTokenSource } from "../src/auth/token.js"
import { saveTaskConfig } from "../src/studio/task.js"
import { saveFlowNodeConfig } from "../src/studio/flow.js"

describe("schedule mode HTTP body", () => {
  for (const mode of [undefined, "1", "2"]) {
    test(`serializes ${mode ?? "default"} through both config writers`, async () => {
      const bodies: Record<string, unknown>[] = []
      const server = Bun.serve({
        port: 0,
        async fetch(request) {
          bodies.push((await request.json()) as Record<string, unknown>)
          return Response.json({ code: 0, data: {} })
        },
      })
      try {
        const config = {
          baseUrl: server.url.origin,
          tokens: staticTokenSource({ token: "test", instanceId: 1, userId: 2 }),
          instanceName: "inst",
          instanceId: 1,
          userId: 2,
          tenantId: 3,
          workspaceName: "ws",
        }
        const params = { dataFileId: 1, projectId: 2, updateBy: "2", instanceName: "inst", scheduleCreatedType: mode }
        await saveTaskConfig(config, params)
        await saveFlowNodeConfig(config, { ...params, nodeId: 3 })
        expect(bodies.map((body) => body.scheduleCreatedType)).toEqual([mode ?? "2", mode ?? "2"])
      } finally {
        server.stop(true)
      }
    })
  }
})
