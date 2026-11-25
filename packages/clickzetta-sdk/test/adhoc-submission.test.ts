import { expect, test } from "bun:test"
import { staticTokenSource } from "../src/auth/token.js"
import { executeAdhoc } from "../src/studio/execute.js"

// A gateway can return 503 after the scheduler accepted the request. The
// transport must not replay a non-idempotent submission in that situation.
test("ad-hoc execution sends one request when its outcome is unknown", async () => {
  let submissions = 0
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch() {
      submissions++
      return new Response("Unavailable", { status: 503 })
    },
  })
  try {
    await expect(executeAdhoc({
      baseUrl: server.url.origin,
      tokens: staticTokenSource({ token: "test-only", instanceId: 1, userId: 1 }),
      instanceName: "test",
      instanceId: 1,
      projectId: 1,
      workspaceId: 1,
      workspaceName: "test",
      userId: 1,
    }, {
      updateBy: "1",
      dataFileId: 1,
      collectType: 0,
      maxRowSize: 1,
      offsetLine: 0,
      offsetCol: 0,
      instanceName: "test",
      multiDataSource: [],
      adhocVcCode: "test",
      adhocSchemaName: "public",
      adhocVcId: "1",
      dataFileContent: "select 1",
      params: {},
    })).rejects.toThrow()
    expect(submissions).toBe(1)
  } finally {
    server.stop(true)
  }
})
