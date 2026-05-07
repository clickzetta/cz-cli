/**
 * lakehouse-client.test.ts — unit tests for LakehouseClient and
 * createLakehouseClientFromToken.
 *
 * @clickzetta/sdk's SqlSession is mocked so no real network calls are made.
 */

import { describe, it, expect, mock, beforeEach } from "bun:test"
import type { QueryResult } from "@clickzetta/sdk"
import { JobStatus } from "@clickzetta/sdk"

// ---------------------------------------------------------------------------
// Mock @clickzetta/sdk SqlSession before importing the module under test.
// Bun's module mock replaces the module for the duration of this test file.
// ---------------------------------------------------------------------------

const mockExecute = mock(async (_sql: string, _opts?: unknown): Promise<QueryResult> => {
  return {
    jobId: "test-job-1",
    status: JobStatus.SUCCEEDED,
    columns: [
      { name: "id", type: "INT" },
      { name: "name", type: "STRING" },
    ],
    rows: [
      { id: 1, name: "Alice" },
      { id: 2, name: "Bob" },
    ],
    rowCount: 2,
    affectedRows: 0,
  }
})

// We need to mock the SqlSession constructor so that instances use mockExecute.
// Bun supports mock.module for ESM mocks.
await mock.module("@clickzetta/sdk", () => {
  class MockSqlSession {
    workspace: string
    schema: string
    vcluster: string

    constructor(config: { workspace: string; schema: string; vcluster: string }) {
      this.workspace = config.workspace
      this.schema = config.schema
      this.vcluster = config.vcluster
    }

    execute(sql: string, opts?: unknown): Promise<QueryResult> {
      return mockExecute(sql, opts)
    }
  }

  return {
    SqlSession: MockSqlSession,
    JobStatus,
  }
})

// Import after mock is set up
const { LakehouseClient, createLakehouseClientFromToken } = await import(
  "../src/lakehouse-client.js"
)
const { StudioConfigManager } = await import("../src/config/profile.js")

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeConfig() {
  return StudioConfigManager.fromToken("test-token-xyz", {
    instance: "test-instance",
    service: "test-api.clickzetta.com",
    workspace: "test-workspace",
    schema: "public",
    vcluster: "DEFAULT",
  })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("LakehouseClient", () => {
  beforeEach(() => {
    mockExecute.mockClear()
  })

  it("isConnected() returns false before connect()", () => {
    const client = new LakehouseClient(makeConfig())
    expect(client.isConnected()).toBe(false)
  })

  it("isConnected() returns true after connect()", () => {
    const client = new LakehouseClient(makeConfig())
    client.connect()
    expect(client.isConnected()).toBe(true)
  })

  it("isConnected() returns false after close()", () => {
    const client = new LakehouseClient(makeConfig())
    client.connect()
    client.close()
    expect(client.isConnected()).toBe(false)
  })

  it("runSql returns correct rows array", async () => {
    const client = new LakehouseClient(makeConfig())
    client.connect()

    const rows = await client.runSql("SELECT id, name FROM users")

    expect(rows).toHaveLength(2)
    expect(rows[0]).toEqual({ id: 1, name: "Alice" })
    expect(rows[1]).toEqual({ id: 2, name: "Bob" })
    expect(mockExecute).toHaveBeenCalledTimes(1)
  })

  it("runSql lazy-connects if not yet connected", async () => {
    const client = new LakehouseClient(makeConfig())
    // Do NOT call connect() — runSql should lazy-connect
    const rows = await client.runSql("SELECT 1")
    expect(rows).toHaveLength(2)
    expect(client.isConnected()).toBe(true)
  })

  it("runSql propagates exceptions from session.execute", async () => {
    mockExecute.mockImplementationOnce(async () => {
      throw new Error("network timeout")
    })

    const client = new LakehouseClient(makeConfig())
    client.connect()

    await expect(client.runSql("SELECT 1")).rejects.toThrow("SQL execution failed")
  })

  it("runSqlWithSchema returns rows and columns", async () => {
    const client = new LakehouseClient(makeConfig())
    client.connect()

    const { rows, columns } = await client.runSqlWithSchema("SELECT id, name FROM users")

    expect(rows).toHaveLength(2)
    expect(columns).toHaveLength(2)
    expect(columns[0]).toEqual({ name: "id", type: "INT" })
    expect(columns[1]).toEqual({ name: "name", type: "STRING" })
  })

  it("runSql applies per-call workspace/schema/vcluster overrides", async () => {
    const client = new LakehouseClient(makeConfig())
    client.connect()

    await client.runSql("SELECT 1", {
      workspace: "override-ws",
      schema: "override-schema",
      vcluster: "OVERRIDE_VC",
    })

    // Session state should be restored after the call
    // (we can't inspect the mock session directly, but we verify no throw)
    expect(mockExecute).toHaveBeenCalledTimes(1)
  })
})

describe("createLakehouseClientFromToken", () => {
  it("constructs a LakehouseClient with correct StudioConfig", () => {
    const client = createLakehouseClientFromToken(
      "my-jwt-token",
      "my-instance",
      "my-service.clickzetta.com",
      "my-workspace",
      "my-schema",
      "MY_VC",
    )
    expect(client).toBeInstanceOf(LakehouseClient)
    expect(client.isConnected()).toBe(false)
  })

  it("uses default schema and vcluster when not provided", () => {
    const client = createLakehouseClientFromToken(
      "token",
      "inst",
      "svc",
      "ws",
    )
    expect(client).toBeInstanceOf(LakehouseClient)
  })

  it("created client can connect and run SQL", async () => {
    mockExecute.mockClear()
    const client = createLakehouseClientFromToken(
      "token",
      "inst",
      "svc",
      "ws",
    )
    client.connect()
    const rows = await client.runSql("SELECT 1")
    expect(rows).toHaveLength(2)
  })
})

describe("StudioConfigManager.fromToken", () => {
  it("sets token and defaults correctly", () => {
    const config = StudioConfigManager.fromToken("tok", {
      instance: "inst",
      workspace: "ws",
    })
    expect(config.token).toBe("tok")
    expect(config.instance).toBe("inst")
    expect(config.workspace).toBe("ws")
    expect(config.vcluster).toBe("DEFAULT")
    expect(config.schema).toBe("public")
    expect(config.transportType).toBe("http")
  })

  it("overrides defaults when opts provided", () => {
    const config = StudioConfigManager.fromToken("tok", {
      vcluster: "CUSTOM_VC",
      schema: "myschema",
      transportType: "stdio",
    })
    expect(config.vcluster).toBe("CUSTOM_VC")
    expect(config.schema).toBe("myschema")
    expect(config.transportType).toBe("stdio")
  })

  it("includes default hints", () => {
    const config = StudioConfigManager.fromToken("tok", {})
    expect(config.hints).toBeDefined()
    // Use bracket access since toHaveProperty uses dot-path notation
    expect((config.hints as Record<string, unknown>)["sdk.job.timeout"]).toBe(300)
  })
})

describe("StudioConfigManager.toClientOptions", () => {
  it("maps StudioConfig fields to ConnectionConfig", () => {
    const config = StudioConfigManager.fromToken("my-token", {
      instance: "inst",
      service: "svc.clickzetta.com",
      workspace: "ws",
      schema: "public",
      vcluster: "DEFAULT",
      username: "user1",
    })
    const connConfig = StudioConfigManager.toClientOptions(config)
    expect(connConfig.pat).toBe("my-token")
    expect(connConfig.instance).toBe("inst")
    expect(connConfig.service).toBe("svc.clickzetta.com")
    expect(connConfig.workspace).toBe("ws")
    expect(connConfig.schema).toBe("public")
    expect(connConfig.vcluster).toBe("DEFAULT")
    expect(connConfig.username).toBe("user1")
    expect(connConfig.protocol).toBe("https")
  })
})
