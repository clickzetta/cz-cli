import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { mkdtempSync } from "node:fs"
import { writeFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

let mockedAgentContext: Record<string, unknown> | undefined

mock.module("../src/connection/profile-store.js", () => ({
  readAgentEndpoint: () => "https://example.clickzetta.com",
}))

mock.module("../src/commands/studio-context.js", () => ({
  getProfileAgentContext: () => mockedAgentContext,
  getStudioContext: async () => ({
    token: "studio-token",
    instanceId: 11,
    workspaceId: 22,
    projectId: 33,
    userId: 44,
    tenantId: 55,
    instanceName: "inst",
    workspaceName: "ws",
    env: "uat",
    baseUrl: "https://example.clickzetta.com",
    customHeaders: {},
    userName: "tester",
  }),
}))

mock.module("../src/logger.js", () => ({
  logOperation: () => {},
}))

const { createCli } = await import("../src/cli.ts")
const { registerAnalyticsAgentCommand } = await import("../src/commands/analytics-agent.ts")

const originalFetch = globalThis.fetch
const originalStdoutWrite = process.stdout.write.bind(process.stdout)
const originalStderrWrite = process.stderr.write.bind(process.stderr)

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "content-type": "application/json" },
  })
}

async function runAnalyticsCli(args: string[]): Promise<{ exitCode: number; output: string }> {
  const chunks: string[] = []
  const savedExitCode = process.exitCode

  process.stdout.write = ((chunk: string | Uint8Array) => {
    chunks.push(typeof chunk === "string" ? chunk : chunk.toString())
    return true
  }) as typeof process.stdout.write

  process.stderr.write = ((chunk: string | Uint8Array) => {
    chunks.push(typeof chunk === "string" ? chunk : chunk.toString())
    return true
  }) as typeof process.stderr.write

  process.exitCode = 0
  try {
    const cli = createCli(args)
    registerAnalyticsAgentCommand(cli)
    await cli.demandCommand(1, "").help().parseAsync()
  } catch {
    if (!process.exitCode) process.exitCode = 1
  } finally {
    process.stdout.write = originalStdoutWrite
    process.stderr.write = originalStderrWrite
  }

  const exitCode = process.exitCode ?? 0
  process.exitCode = savedExitCode ?? 0
  return { exitCode, output: chunks.join("") }
}

describe("analytics-agent knowledge", () => {
  beforeEach(() => {
    process.exitCode = 0
    mockedAgentContext = undefined
  })

  afterEach(async () => {
    globalThis.fetch = originalFetch
    process.stdout.write = originalStdoutWrite
    process.stderr.write = originalStderrWrite
    process.exitCode = 0
  })

  test("create maps text knowledge payload", async () => {
    let capturedUrl = ""
    let capturedBody: Record<string, unknown> | undefined

    globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input)
      capturedBody = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>
      return jsonResponse({
        success: true,
        data: {
          id: 301,
          aliases: ["华北销量"],
          type: "text",
          status: 2,
          statusLabel: "enabled",
          content: "这是文本知识",
          domainIds: [195],
        },
      })
    }) as typeof fetch

    const result = await runAnalyticsCli([
      "analytics-agent",
      "knowledge",
      "create",
      "--alias",
      "华北销量",
      "--content",
      "这是文本知识",
      "--domain-id",
      "195",
    ])

    expect(result.exitCode).toBe(0)
    expect(capturedUrl).toContain("/open/api/v1/analytics-agent/knowledge/entries?tenantId=55")
    expect(capturedBody).toEqual({
      aliases: ["华北销量"],
      content: "这是文本知识",
      domainIds: [195],
    })
    const parsed = JSON.parse(result.output.trim()) as Record<string, any>
    expect(parsed.data).toEqual({
      id: 301,
      aliases: ["华北销量"],
      type: "text",
      status: 2,
      statusLabel: "enabled",
      content: "这是文本知识",
      domainIds: [195],
    })
    expect(parsed.time_ms).toBeNumber()
  })

  test("create maps file knowledge payload", async () => {
    let capturedBody: Record<string, unknown> | undefined
    const dir = mkdtempSync(join(tmpdir(), "knowledge-create-file-"))
    const file = join(dir, "knowledge.txt")
    await writeFile(file, "文件知识内容")

    globalThis.fetch = mock(async (_input: RequestInfo | URL, init?: RequestInit) => {
      capturedBody = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>
      return jsonResponse({
        success: true,
        data: {
          id: 303,
          aliases: ["文件知识"],
          type: "text",
          content: "文件知识内容",
        },
      })
    }) as typeof fetch

    try {
      const result = await runAnalyticsCli([
        "analytics-agent",
        "knowledge",
        "create",
        "--alias",
        "文件知识",
        "--file",
        file,
      ])

      expect(result.exitCode).toBe(0)
      expect(capturedBody).toEqual({
        aliases: ["文件知识"],
        content: "文件知识内容",
      })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("create rejects missing content for text knowledge", async () => {
    const result = await runAnalyticsCli([
      "analytics-agent",
      "knowledge",
      "create",
      "--alias",
      "华北销量",
    ])

    expect(result.exitCode).toBe(1)
    const parsed = JSON.parse(result.output.trim()) as Record<string, any>
    expect(parsed.error.code).toBe("USAGE_ERROR")
    expect(parsed.error.message).toContain("text knowledge requires --content")
  })

  test("create rejects missing local file path", async () => {
    const result = await runAnalyticsCli([
      "analytics-agent",
      "knowledge",
      "create",
      "--alias",
      "文件知识",
      "--file",
      join(tmpdir(), "knowledge-create-file-missing.txt"),
    ])

    expect(result.exitCode).toBe(1)
    const parsed = JSON.parse(result.output.trim()) as Record<string, any>
    expect(parsed.error.code).toBe("ANALYTICS_AGENT_ERROR")
    expect(parsed.error.message).toContain("local path does not exist")
  })

  test("create maps dictionary knowledge payload", async () => {
    let capturedBody: Record<string, unknown> | undefined

    globalThis.fetch = mock(async (_input: RequestInfo | URL, init?: RequestInit) => {
      capturedBody = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>
      return jsonResponse({
        success: true,
        data: {
          id: 302,
          aliases: ["行业词典"],
          type: "dictionary",
          dictionary: { bj: "北京" },
        },
      })
    }) as typeof fetch

    const result = await runAnalyticsCli([
      "analytics-agent",
      "knowledge",
      "create",
      "--type",
      "dictionary",
      "--alias",
      "行业词典",
      "--dictionary",
      "{\"bj\":\"北京\"}",
    ])

    expect(result.exitCode).toBe(0)
    expect(capturedBody).toEqual({
      aliases: ["行业词典"],
      dictionary: { bj: "北京" },
      type: "dictionary",
    })
  })

  test("list calls the structured knowledge list endpoint", async () => {
    let capturedUrl = ""

    globalThis.fetch = mock(async (input: RequestInfo | URL) => {
      capturedUrl = String(input)
      return jsonResponse({
        success: true,
        data: [
          { id: 301, aliases: ["华北销量"], type: "text", content: "这是文本知识" },
        ],
      })
    }) as typeof fetch

    const result = await runAnalyticsCli([
      "analytics-agent",
      "knowledge",
      "list",
      "--keyword",
      "华北",
      "--domain-id",
      "195",
      "--type",
      "text",
      "--page-num",
      "2",
      "--page-size",
      "10",
    ])

    expect(result.exitCode).toBe(0)
    expect(capturedUrl).toContain("/open/api/v1/analytics-agent/knowledge/entries?tenantId=55&keyword=%E5%8D%8E%E5%8C%97&domainId=195&type=text&pageNum=2&pageSize=10")
  })

  test("get calls the knowledge detail endpoint", async () => {
    let capturedUrl = ""

    globalThis.fetch = mock(async (input: RequestInfo | URL) => {
      capturedUrl = String(input)
      return jsonResponse({
        success: true,
        data: {
          id: 301,
          aliases: ["华北销量"],
          type: "text",
          content: "这是文本知识",
        },
      })
    }) as typeof fetch

    const result = await runAnalyticsCli([
      "analytics-agent",
      "knowledge",
      "get",
      "301",
    ])

    expect(result.exitCode).toBe(0)
    expect(capturedUrl).toContain("/open/api/v1/analytics-agent/knowledge/entries/301?tenantId=55")
    const parsed = JSON.parse(result.output.trim()) as Record<string, any>
    expect(parsed.data.id).toBe(301)
    expect(parsed.data.content).toBe("这是文本知识")
  })

  test("update maps structured knowledge payload", async () => {
    let capturedUrl = ""
    let capturedBody: Record<string, unknown> | undefined

    globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input)
      capturedBody = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>
      return jsonResponse({
        success: true,
        data: {
          id: 301,
          aliases: ["华北销量"],
          type: "text",
          content: "更新后的内容",
        },
      })
    }) as typeof fetch

    const result = await runAnalyticsCli([
      "analytics-agent",
      "knowledge",
      "update",
      "301",
      "--content",
      "更新后的内容",
      "--alias",
      "华北销量",
    ])

    expect(result.exitCode).toBe(0)
    expect(capturedUrl).toContain("/open/api/v1/analytics-agent/knowledge/entries/301?tenantId=55")
    expect(capturedBody).toEqual({
      aliases: ["华北销量"],
      content: "更新后的内容",
    })
  })

  test("delete succeeds on structured knowledge no-data response", async () => {
    let capturedUrl = ""

    globalThis.fetch = mock(async (input: RequestInfo | URL) => {
      capturedUrl = String(input)
      return jsonResponse({
        code: "204",
        message: "操作成功",
        success: false,
        data: null,
      })
    }) as typeof fetch

    const result = await runAnalyticsCli([
      "analytics-agent",
      "knowledge",
      "delete",
      "301",
    ])

    expect(result.exitCode).toBe(0)
    expect(capturedUrl).toContain("/open/api/v1/analytics-agent/knowledge/entries/301?tenantId=55")
  })

  test("delete treats code 200 no-data success as success", async () => {
    globalThis.fetch = mock(async () => jsonResponse({
      code: 200,
      message: "操作成功",
      success: false,
      data: null,
    })) as typeof fetch

    const result = await runAnalyticsCli([
      "analytics-agent",
      "knowledge",
      "delete",
      "301",
    ])

    expect(result.exitCode).toBe(0)
  })

  test("space list calls the knowledge space endpoint", async () => {
    let capturedUrl = ""

    globalThis.fetch = mock(async (input: RequestInfo | URL) => {
      capturedUrl = String(input)
      return jsonResponse({
        success: true,
        data: [
          {
            id: 7,
            name: "投研空间",
            storageBackend: "lakehouse",
            fileCount: 3,
            domainIds: [195],
          },
        ],
      })
    }) as typeof fetch

    const result = await runAnalyticsCli([
      "analytics-agent",
      "knowledge",
      "space",
      "list",
      "--domain-id",
      "195",
    ])

    expect(result.exitCode).toBe(0)
    expect(capturedUrl).toContain("/open/api/v1/analytics-agent/knowledge/spaces?tenantId=55&domainId=195")
    const parsed = JSON.parse(result.output.trim()) as Record<string, any>
    expect(parsed.count).toBe(1)
    expect(parsed.data).toEqual([
      {
        id: 7,
        name: "投研空间",
        storageBackend: "lakehouse",
        fileCount: 3,
        domainIds: [195],
      },
    ])
  })

  test("space list prefers profile agent tenant context when available", async () => {
    let capturedUrl = ""
    let capturedAuthorization = ""

    mockedAgentContext = {
      token: "agent-token",
      instanceId: 0,
      workspaceId: 0,
      projectId: 0,
      userId: 1,
      tenantId: 1504,
      instanceName: "inst",
      workspaceName: "ws",
      env: "uat",
      baseUrl: "https://example.clickzetta.com",
      customHeaders: {},
      debug: false,
      userName: "profile-agent",
    }

    globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input)
      capturedAuthorization = String(new Headers(init?.headers).get("Authorization") ?? "")
      return jsonResponse({
        success: true,
        data: [],
      })
    }) as typeof fetch

    const result = await runAnalyticsCli([
      "--profile",
      "local8015",
      "analytics-agent",
      "knowledge",
      "space",
      "list",
    ])

    expect(result.exitCode).toBe(0)
    expect(capturedUrl).toContain("/open/api/v1/analytics-agent/knowledge/spaces?tenantId=1504")
    expect(capturedAuthorization).toBe("agent-token")
  })

  test("space rename calls the knowledge space update endpoint", async () => {
    let capturedUrl = ""
    let capturedBody: Record<string, unknown> | undefined

    globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input)
      capturedBody = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>
      return jsonResponse({
        success: true,
        data: {
          id: 7,
          name: "投研空间-renamed",
          storageBackend: "lakehouse",
          fileCount: 3,
          domainIds: [195],
        },
      })
    }) as typeof fetch

    const result = await runAnalyticsCli([
      "analytics-agent",
      "knowledge",
      "space",
      "rename",
      "7",
      "--name",
      "投研空间-renamed",
    ])

    expect(result.exitCode).toBe(0)
    expect(capturedUrl).toContain("/open/api/v1/analytics-agent/knowledge/spaces/7?tenantId=55")
    expect(capturedBody).toEqual({
      name: "投研空间-renamed",
    })
    const parsed = JSON.parse(result.output.trim()) as Record<string, any>
    expect(parsed.data.id).toBe(7)
    expect(parsed.data.name).toBe("投研空间-renamed")
  })

  test("knowledge nested mutating command help no longer exposes body options", async () => {
    const spaceCreate = spawnSync(process.execPath, [
      "./src/main.ts",
      "analytics-agent",
      "knowledge",
      "space",
      "create",
      "--help",
    ], {
      cwd: process.cwd(),
      encoding: "utf-8",
    })
    const folderRename = spawnSync(process.execPath, [
      "./src/main.ts",
      "analytics-agent",
      "knowledge",
      "folder",
      "rename",
      "--help",
    ], {
      cwd: process.cwd(),
      encoding: "utf-8",
    })
    const fileMove = spawnSync(process.execPath, [
      "./src/main.ts",
      "analytics-agent",
      "knowledge",
      "file",
      "move",
      "--help",
    ], {
      cwd: process.cwd(),
      encoding: "utf-8",
    })

    expect(spaceCreate.status).toBe(0)
    expect(spaceCreate.stdout).not.toContain("--body")
    expect(folderRename.status).toBe(0)
    expect(folderRename.stdout).not.toContain("--body")
    expect(fileMove.status).toBe(0)
    expect(fileMove.stdout).not.toContain("--body")
  })

  test("space delete succeeds on no-data response", async () => {
    let capturedUrl = ""

    globalThis.fetch = mock(async (input: RequestInfo | URL) => {
      capturedUrl = String(input)
      return jsonResponse({
        code: "204",
        message: "操作成功",
        success: false,
        data: null,
      })
    }) as typeof fetch

    const result = await runAnalyticsCli([
      "analytics-agent",
      "knowledge",
      "space",
      "delete",
      "7",
    ])

    expect(result.exitCode).toBe(0)
    expect(capturedUrl).toContain("/open/api/v1/analytics-agent/knowledge/spaces/7?tenantId=55")
  })

  test("space delete treats code 200 no-data success as success", async () => {
    globalThis.fetch = mock(async () => jsonResponse({
      code: 200,
      message: "操作成功",
      success: false,
      data: null,
    })) as typeof fetch

    const result = await runAnalyticsCli([
      "analytics-agent",
      "knowledge",
      "space",
      "delete",
      "7",
    ])

    expect(result.exitCode).toBe(0)
  })

  test("node bind-domain calls the knowledge node domain set endpoint", async () => {
    const capturedUrls: string[] = []
    let capturedBody: Record<string, unknown> | undefined

    globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrls.push(String(input))
      if (capturedUrls.length === 1) {
        capturedBody = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>
        return jsonResponse({
          success: true,
          data: {
            code: 200,
            success: false,
            message: "操作成功",
            data: null,
          },
        })
      }
      return jsonResponse({
        success: true,
        data: {
          node: {
            id: 11,
            spaceId: 7,
            parentId: 0,
            nodeType: 2,
            name: "report.md",
            fileExt: "md",
            path: [
              { id: 9, name: "docs" },
            ],
            domainAssoc: {
              domainIds: [195, 196],
              inherited: false,
              inheritedFromNodeId: null,
              inheritedFromNodeName: null,
            },
          },
        },
      })
    }) as typeof fetch

    const result = await runAnalyticsCli([
      "analytics-agent",
      "knowledge",
      "node",
      "bind-domain",
      "7",
      "11",
      "--domain-id",
      "195",
      "--domain-id",
      "196",
    ])

    expect(result.exitCode).toBe(0)
    expect(capturedUrls[0]).toContain("/api/v1/kb/nodes/domains/set?tenantId=55")
    expect(capturedUrls[1]).toContain("/api/v1/kb/nodes/detail/with-path?tenantId=55&spaceId=7&nodeId=11")
    expect(capturedBody).toEqual({
      nodeId: 11,
      domainIds: [195, 196],
    })
    const parsed = JSON.parse(result.output.trim()) as Record<string, any>
    expect(parsed.data.domainIds).toEqual([195, 196])
    expect(parsed.data.inherited).toBe(false)
    expect(parsed.data.path).toBe("docs/report.md")
  })

  test("node unbind-domain calls the knowledge node domain remove endpoint", async () => {
    const capturedUrls: string[] = []
    let capturedBody: Record<string, unknown> | undefined

    globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrls.push(String(input))
      if (capturedUrls.length === 1) {
        capturedBody = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>
        return jsonResponse({
          success: true,
          data: {
            code: 200,
            success: false,
            message: "操作成功",
            data: null,
          },
        })
      }
      return jsonResponse({
        success: true,
        data: {
          node: {
            id: 11,
            spaceId: 7,
            parentId: 0,
            nodeType: 2,
            name: "report.md",
            fileExt: "md",
            path: [
              { id: 9, name: "docs" },
            ],
            domainAssoc: {
              domainIds: [201],
              inherited: true,
              inheritedFromNodeId: 9,
              inheritedFromNodeName: "reports",
            },
          },
        },
      })
    }) as typeof fetch

    const result = await runAnalyticsCli([
      "analytics-agent",
      "knowledge",
      "node",
      "unbind-domain",
      "7",
      "11",
      "--domain-id",
      "195",
    ])

    expect(result.exitCode).toBe(0)
    expect(capturedUrls[0]).toContain("/api/v1/kb/nodes/domains/remove?tenantId=55")
    expect(capturedUrls[1]).toContain("/api/v1/kb/nodes/detail/with-path?tenantId=55&spaceId=7&nodeId=11")
    expect(capturedBody).toEqual({
      nodeId: 11,
      domainIds: [195],
    })
    const parsed = JSON.parse(result.output.trim()) as Record<string, any>
    expect(parsed.data.domainIds).toEqual([201])
    expect(parsed.data.inherited).toBe(true)
    expect(parsed.data.inheritedFromNodeId).toBe(9)
  })

  test("node bind-domain rejects missing domain ids", async () => {
    const result = await runAnalyticsCli([
      "analytics-agent",
      "knowledge",
      "node",
      "bind-domain",
      "7",
      "11",
    ])

    expect(result.exitCode).toBe(1)
    const parsed = JSON.parse(result.output.trim()) as Record<string, any>
    expect(parsed.error.code).toBe("USAGE_ERROR")
    expect(parsed.error.message).toContain("--domain-id is required")
  })

  test("folder list calls the knowledge node list endpoint", async () => {
    let capturedUrl = ""

    globalThis.fetch = mock(async (input: RequestInfo | URL) => {
      capturedUrl = String(input)
      return jsonResponse({
        success: true,
        data: [
          {
            id: 11,
            spaceId: 7,
            parentId: 0,
            nodeType: 1,
            nodeTypeLabel: "folder",
            name: "docs",
            path: "docs",
          },
        ],
      })
    }) as typeof fetch

    const result = await runAnalyticsCli([
      "analytics-agent",
      "knowledge",
      "folder",
      "list",
      "7",
      "--parent-id",
      "0",
      "--domain-id",
      "195",
    ])

    expect(result.exitCode).toBe(0)
    expect(capturedUrl).toContain("/open/api/v1/analytics-agent/knowledge/spaces/7/nodes?tenantId=55&parentId=0&domainId=195")
    const parsed = JSON.parse(result.output.trim()) as Record<string, any>
    expect(parsed.data[0].nodeTypeLabel).toBe("folder")
  })

  test("folder create calls the folder create endpoint", async () => {
    let capturedUrl = ""
    let capturedBody: Record<string, unknown> | undefined

    globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input)
      capturedBody = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>
      return jsonResponse({
        success: true,
        data: {
          id: 12,
          spaceId: 7,
          parentId: 0,
          nodeType: 1,
          nodeTypeLabel: "folder",
          name: "reports",
          path: "reports",
        },
      })
    }) as typeof fetch

    const result = await runAnalyticsCli([
      "analytics-agent",
      "knowledge",
      "folder",
      "create",
      "7",
      "--name",
      "reports",
      "--parent-id",
      "0",
    ])

    expect(result.exitCode).toBe(0)
    expect(capturedUrl).toContain("/open/api/v1/analytics-agent/knowledge/spaces/7/folders?tenantId=55")
    expect(capturedBody).toEqual({
      parentId: 0,
      name: "reports",
    })
  })

  test("folder by-path returns found folder node", async () => {
    let capturedUrl = ""

    globalThis.fetch = mock(async (input: RequestInfo | URL) => {
      capturedUrl = String(input)
      return jsonResponse({
        success: true,
        data: {
          found: true,
          node: {
            id: 12,
            spaceId: 7,
            parentId: 0,
            nodeType: 1,
            nodeTypeLabel: "folder",
            name: "reports",
            path: "reports",
          },
        },
      })
    }) as typeof fetch

    const result = await runAnalyticsCli([
      "analytics-agent",
      "knowledge",
      "folder",
      "by-path",
      "7",
      "--path",
      "reports",
    ])

    expect(result.exitCode).toBe(0)
    expect(capturedUrl).toContain("/open/api/v1/analytics-agent/knowledge/spaces/7/nodes/by-path?tenantId=55&path=reports")
    const parsed = JSON.parse(result.output.trim()) as Record<string, any>
    expect(parsed.data).toEqual({
      found: true,
      node: {
        id: 12,
        spaceId: 7,
        parentId: 0,
        nodeType: 1,
        nodeTypeLabel: "folder",
        name: "reports",
        path: "reports",
      },
    })
  })

  test("folder by-path normalizes leading slash", async () => {
    let capturedUrl = ""

    globalThis.fetch = mock(async (input: RequestInfo | URL) => {
      capturedUrl = String(input)
      return jsonResponse({
        success: true,
        data: {
          found: true,
          node: {
            id: 12,
            spaceId: 7,
            parentId: 0,
            nodeType: 1,
            nodeTypeLabel: "folder",
            name: "reports",
            path: "reports",
          },
        },
      })
    }) as typeof fetch

    const result = await runAnalyticsCli([
      "analytics-agent",
      "knowledge",
      "folder",
      "by-path",
      "7",
      "--path",
      "/reports",
    ])

    expect(result.exitCode).toBe(0)
    expect(capturedUrl).toContain("/open/api/v1/analytics-agent/knowledge/spaces/7/nodes/by-path?tenantId=55&path=reports")
  })

  test("folder by-path hides file matches", async () => {
    globalThis.fetch = mock(async () => jsonResponse({
      success: true,
      data: {
        found: true,
        node: {
          id: 12,
          spaceId: 7,
          parentId: 0,
          nodeType: 2,
          nodeTypeLabel: "file",
          name: "report.md",
          path: "report.md",
        },
      },
    })) as typeof fetch

    const result = await runAnalyticsCli([
      "analytics-agent",
      "knowledge",
      "folder",
      "by-path",
      "7",
      "--path",
      "report.md",
    ])

    expect(result.exitCode).toBe(0)
    const parsed = JSON.parse(result.output.trim()) as Record<string, any>
    expect(parsed.data).toEqual({
      found: false,
      node: null,
    })
  })

  test("folder search calls the knowledge node search endpoint", async () => {
    let capturedUrl = ""

    globalThis.fetch = mock(async (input: RequestInfo | URL) => {
      capturedUrl = String(input)
      return jsonResponse({
        success: true,
        data: {
          total: 1,
          list: [
            {
              id: 12,
              spaceId: 7,
              parentId: 0,
              nodeType: 1,
              nodeTypeLabel: "folder",
              name: "reports",
              path: "reports",
            },
          ],
        },
      })
    }) as typeof fetch

    const result = await runAnalyticsCli([
      "analytics-agent",
      "knowledge",
      "folder",
      "search",
      "7",
      "--keyword",
      "rep",
      "--page-num",
      "2",
      "--page-size",
      "10",
    ])

    expect(result.exitCode).toBe(0)
    expect(capturedUrl).toContain("/open/api/v1/analytics-agent/knowledge/spaces/7/nodes/search?tenantId=55&keyword=rep&nodeType=folder&pageNum=2&pageSize=10")
    const parsed = JSON.parse(result.output.trim()) as Record<string, any>
    expect(parsed.count).toBe(1)
    expect(parsed.data[0].nodeTypeLabel).toBe("folder")
  })

  test("folder search rejects missing keyword", async () => {
    const result = await runAnalyticsCli([
      "analytics-agent",
      "knowledge",
      "folder",
      "search",
      "7",
    ])

    expect(result.exitCode).toBe(2)
    const parsed = JSON.parse(result.output.trim()) as Record<string, any>
    expect(parsed.error.code).toBe("USAGE_ERROR")
  })

  test("folder sort calls the knowledge node sort endpoint", async () => {
    let capturedUrl = ""
    let capturedBody: Record<string, unknown> | undefined

    globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input)
      capturedBody = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>
      return jsonResponse({
        code: "204",
        message: "操作成功",
        success: false,
        data: null,
      })
    }) as typeof fetch

    const result = await runAnalyticsCli([
      "analytics-agent",
      "knowledge",
      "folder",
      "sort",
      "7",
      "--parent-id",
      "0",
      "--node-id",
      "12",
      "--node-id",
      "11",
    ])

    expect(result.exitCode).toBe(0)
    expect(capturedUrl).toContain("/open/api/v1/analytics-agent/knowledge/spaces/7/nodes/sort?tenantId=55")
    expect(capturedBody).toEqual({
      parentId: 0,
      nodeIds: [12, 11],
    })
  })

  test("folder sort treats code 200 no-data success as success", async () => {
    globalThis.fetch = mock(async () => jsonResponse({
      code: 200,
      message: "操作成功",
      success: false,
      data: null,
    })) as typeof fetch

    const result = await runAnalyticsCli([
      "analytics-agent",
      "knowledge",
      "folder",
      "sort",
      "7",
      "--node-id",
      "12",
    ])

    expect(result.exitCode).toBe(0)
  })

  test("folder sort rejects missing node-id", async () => {
    const result = await runAnalyticsCli([
      "analytics-agent",
      "knowledge",
      "folder",
      "sort",
      "7",
    ])

    expect(result.exitCode).toBe(2)
    const parsed = JSON.parse(result.output.trim()) as Record<string, any>
    expect(parsed.error.code).toBe("USAGE_ERROR")
    expect(parsed.error.message).toMatch(/Missing required argument: node-id|缺少必须的选项：node-id/)
  })

  test("folder delete succeeds on no-data response", async () => {
    let capturedUrl = ""

    globalThis.fetch = mock(async (input: RequestInfo | URL) => {
      capturedUrl = String(input)
      return jsonResponse({
        code: "204",
        message: "操作成功",
        success: false,
        data: null,
      })
    }) as typeof fetch

    const result = await runAnalyticsCli([
      "analytics-agent",
      "knowledge",
      "folder",
      "delete",
      "7",
      "12",
    ])

    expect(result.exitCode).toBe(0)
    expect(capturedUrl).toContain("/open/api/v1/analytics-agent/knowledge/spaces/7/nodes/12?tenantId=55")
  })

  test("folder delete treats code 200 no-data success as success", async () => {
    globalThis.fetch = mock(async () => jsonResponse({
      code: 200,
      message: "操作成功",
      success: false,
      data: null,
    })) as typeof fetch

    const result = await runAnalyticsCli([
      "analytics-agent",
      "knowledge",
      "folder",
      "delete",
      "7",
      "12",
    ])

    expect(result.exitCode).toBe(0)
  })

  test("folder rename calls the knowledge node update endpoint", async () => {
    let capturedUrl = ""
    let capturedBody: Record<string, unknown> | undefined

    globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input)
      capturedBody = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>
      return jsonResponse({
        success: true,
        data: {
          id: 12,
          spaceId: 7,
          parentId: 0,
          nodeType: 1,
          nodeTypeLabel: "folder",
          name: "reports-renamed",
          path: "reports-renamed",
        },
      })
    }) as typeof fetch

    const result = await runAnalyticsCli([
      "analytics-agent",
      "knowledge",
      "folder",
      "rename",
      "7",
      "12",
      "--name",
      "reports-renamed",
    ])

    expect(result.exitCode).toBe(0)
    expect(capturedUrl).toContain("/open/api/v1/analytics-agent/knowledge/spaces/7/nodes/12?tenantId=55")
    expect(capturedBody).toEqual({
      name: "reports-renamed",
    })
  })

  test("folder move calls the knowledge node move endpoint", async () => {
    let capturedUrl = ""
    let capturedBody: Record<string, unknown> | undefined

    globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input)
      capturedBody = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>
      return jsonResponse({
        success: true,
        data: {
          id: 12,
          spaceId: 7,
          parentId: 20,
          nodeType: 1,
          nodeTypeLabel: "folder",
          name: "reports",
          path: "archive/reports",
        },
      })
    }) as typeof fetch

    const result = await runAnalyticsCli([
      "analytics-agent",
      "knowledge",
      "folder",
      "move",
      "7",
      "12",
      "--parent-id",
      "20",
    ])

    expect(result.exitCode).toBe(0)
    expect(capturedUrl).toContain("/open/api/v1/analytics-agent/knowledge/spaces/7/nodes/12/move?tenantId=55")
    expect(capturedBody).toEqual({
      parentId: 20,
    })
  })

  test("folder copy calls the knowledge node copy endpoint", async () => {
    let capturedUrl = ""
    let capturedBody: Record<string, unknown> | undefined

    globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input)
      capturedBody = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>
      return jsonResponse({
        success: true,
        data: {
          id: 112,
          spaceId: 7,
          parentId: 20,
          nodeType: 1,
          nodeTypeLabel: "folder",
          name: "reports-copy",
          path: "archive/reports-copy",
        },
      })
    }) as typeof fetch

    const result = await runAnalyticsCli([
      "analytics-agent",
      "knowledge",
      "folder",
      "copy",
      "7",
      "12",
      "--parent-id",
      "20",
    ])

    expect(result.exitCode).toBe(0)
    expect(capturedUrl).toContain("/open/api/v1/analytics-agent/knowledge/spaces/7/nodes/12/copy?tenantId=55")
    expect(capturedBody).toEqual({
      parentId: 20,
    })
  })

  test("file by-path returns found file node", async () => {
    let capturedUrl = ""

    globalThis.fetch = mock(async (input: RequestInfo | URL) => {
      capturedUrl = String(input)
      return jsonResponse({
        success: true,
        data: {
          found: true,
          node: {
            id: 13,
            spaceId: 7,
            parentId: 12,
            nodeType: 2,
            nodeTypeLabel: "file",
            name: "report.md",
            path: "reports/report.md",
          },
        },
      })
    }) as typeof fetch

    const result = await runAnalyticsCli([
      "analytics-agent",
      "knowledge",
      "file",
      "by-path",
      "7",
      "--path",
      "reports/report.md",
    ])

    expect(result.exitCode).toBe(0)
    expect(capturedUrl).toContain("/open/api/v1/analytics-agent/knowledge/spaces/7/nodes/by-path?tenantId=55&path=reports%2Freport.md")
    const parsed = JSON.parse(result.output.trim()) as Record<string, any>
    expect(parsed.data).toEqual({
      found: true,
      node: {
        id: 13,
        spaceId: 7,
        parentId: 12,
        nodeType: 2,
        nodeTypeLabel: "file",
        name: "report.md",
        path: "reports/report.md",
      },
    })
  })

  test("file by-path normalizes leading slash", async () => {
    let capturedUrl = ""

    globalThis.fetch = mock(async (input: RequestInfo | URL) => {
      capturedUrl = String(input)
      return jsonResponse({
        success: true,
        data: {
          found: true,
          node: {
            id: 13,
            spaceId: 7,
            parentId: 12,
            nodeType: 2,
            nodeTypeLabel: "file",
            name: "report.md",
            path: "reports/report.md",
          },
        },
      })
    }) as typeof fetch

    const result = await runAnalyticsCli([
      "analytics-agent",
      "knowledge",
      "file",
      "by-path",
      "7",
      "--path",
      "/reports/report.md",
    ])

    expect(result.exitCode).toBe(0)
    expect(capturedUrl).toContain("/open/api/v1/analytics-agent/knowledge/spaces/7/nodes/by-path?tenantId=55&path=reports%2Freport.md")
  })

  test("file search calls the knowledge node search endpoint", async () => {
    let capturedUrl = ""

    globalThis.fetch = mock(async (input: RequestInfo | URL) => {
      capturedUrl = String(input)
      return jsonResponse({
        success: true,
        data: {
          total: 1,
          list: [
            {
              id: 21,
              spaceId: 7,
              parentId: 12,
              nodeType: 2,
              nodeTypeLabel: "file",
              name: "report.md",
              path: "reports/report.md",
            },
          ],
        },
      })
    }) as typeof fetch

    const result = await runAnalyticsCli([
      "analytics-agent",
      "knowledge",
      "file",
      "search",
      "7",
      "--keyword",
      "report",
    ])

    expect(result.exitCode).toBe(0)
    expect(capturedUrl).toContain("/open/api/v1/analytics-agent/knowledge/spaces/7/nodes/search?tenantId=55&keyword=report&nodeType=file")
    const parsed = JSON.parse(result.output.trim()) as Record<string, any>
    expect(parsed.count).toBe(1)
    expect(parsed.data[0].nodeTypeLabel).toBe("file")
  })

  test("file by-path hides folder matches", async () => {
    globalThis.fetch = mock(async () => jsonResponse({
      success: true,
      data: {
        found: true,
        node: {
          id: 12,
          spaceId: 7,
          parentId: 0,
          nodeType: 1,
          nodeTypeLabel: "folder",
          name: "reports",
          path: "reports",
        },
      },
    })) as typeof fetch

    const result = await runAnalyticsCli([
      "analytics-agent",
      "knowledge",
      "file",
      "by-path",
      "7",
      "--path",
      "reports",
    ])

    expect(result.exitCode).toBe(0)
    const parsed = JSON.parse(result.output.trim()) as Record<string, any>
    expect(parsed.data).toEqual({
      found: false,
      node: null,
    })
  })

  test("file list filters file nodes from the knowledge node list endpoint", async () => {
    let capturedUrl = ""

    globalThis.fetch = mock(async (input: RequestInfo | URL) => {
      capturedUrl = String(input)
      return jsonResponse({
        success: true,
        data: [
          {
            id: 11,
            spaceId: 7,
            parentId: 0,
            nodeType: 1,
            nodeTypeLabel: "folder",
            name: "docs",
            path: "docs",
          },
          {
            id: 12,
            spaceId: 7,
            parentId: 0,
            nodeType: 2,
            nodeTypeLabel: "file",
            name: "report.md",
            path: "report.md",
          },
        ],
      })
    }) as typeof fetch

    const result = await runAnalyticsCli([
      "analytics-agent",
      "knowledge",
      "file",
      "list",
      "7",
      "--parent-id",
      "0",
      "--domain-id",
      "195",
    ])

    expect(result.exitCode).toBe(0)
    expect(capturedUrl).toContain("/open/api/v1/analytics-agent/knowledge/spaces/7/nodes?tenantId=55&parentId=0&domainId=195")
    const parsed = JSON.parse(result.output.trim()) as Record<string, any>
    expect(parsed.count).toBe(1)
    expect(parsed.data).toEqual([
      {
        id: 12,
        spaceId: 7,
        parentId: 0,
        nodeType: 2,
        nodeTypeLabel: "file",
        name: "report.md",
        path: "report.md",
      },
    ])
  })

  test("file get calls the file content endpoint", async () => {
    let capturedUrl = ""

    globalThis.fetch = mock(async (input: RequestInfo | URL) => {
      capturedUrl = String(input)
      return jsonResponse({
        success: true,
        data: {
          id: 21,
          spaceId: 7,
          parentId: 12,
          name: "report.md",
          fileExt: "md",
          fileSize: 12,
          contentReady: 1,
          path: "reports/report.md",
          plainText: true,
          content: "# hello",
        },
      })
    }) as typeof fetch

    const result = await runAnalyticsCli([
      "analytics-agent",
      "knowledge",
      "file",
      "get",
      "7",
      "21",
      "--offset-line",
      "2",
      "--limit-line",
      "10",
    ])

    expect(result.exitCode).toBe(0)
    expect(capturedUrl).toContain("/open/api/v1/analytics-agent/knowledge/spaces/7/nodes/21/content?tenantId=55&offsetLine=2&limitLine=10")
    const parsed = JSON.parse(result.output.trim()) as Record<string, any>
    expect(parsed.data.content).toBe("# hello")
    expect(parsed.data.plainText).toBeTrue()
  })

  test("file delete succeeds on no-data response", async () => {
    let capturedUrl = ""

    globalThis.fetch = mock(async (input: RequestInfo | URL) => {
      capturedUrl = String(input)
      return jsonResponse({
        code: "204",
        message: "操作成功",
        success: false,
        data: null,
      })
    }) as typeof fetch

    const result = await runAnalyticsCli([
      "analytics-agent",
      "knowledge",
      "file",
      "delete",
      "7",
      "21",
    ])

    expect(result.exitCode).toBe(0)
    expect(capturedUrl).toContain("/open/api/v1/analytics-agent/knowledge/spaces/7/nodes/21?tenantId=55")
  })

  test("file delete treats code 200 no-data success as success", async () => {
    globalThis.fetch = mock(async () => jsonResponse({
      code: 200,
      message: "操作成功",
      success: false,
      data: null,
    })) as typeof fetch

    const result = await runAnalyticsCli([
      "analytics-agent",
      "knowledge",
      "file",
      "delete",
      "7",
      "21",
    ])

    expect(result.exitCode).toBe(0)
  })

  test("file rename calls the knowledge node update endpoint", async () => {
    let capturedUrl = ""
    let capturedBody: Record<string, unknown> | undefined

    globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input)
      capturedBody = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>
      return jsonResponse({
        success: true,
        data: {
          id: 21,
          spaceId: 7,
          parentId: 12,
          nodeType: 2,
          nodeTypeLabel: "file",
          name: "report-v2.md",
          path: "reports/report-v2.md",
        },
      })
    }) as typeof fetch

    const result = await runAnalyticsCli([
      "analytics-agent",
      "knowledge",
      "file",
      "rename",
      "7",
      "21",
      "--name",
      "report-v2.md",
    ])

    expect(result.exitCode).toBe(0)
    expect(capturedUrl).toContain("/open/api/v1/analytics-agent/knowledge/spaces/7/nodes/21?tenantId=55")
    expect(capturedBody).toEqual({
      name: "report-v2.md",
    })
    const parsed = JSON.parse(result.output.trim()) as Record<string, any>
    expect(parsed.data.path).toBe("reports/report-v2.md")
  })

  test("file move calls the knowledge node move endpoint", async () => {
    let capturedUrl = ""
    let capturedBody: Record<string, unknown> | undefined

    globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input)
      capturedBody = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>
      return jsonResponse({
        success: true,
        data: {
          id: 21,
          spaceId: 7,
          parentId: 20,
          nodeType: 2,
          nodeTypeLabel: "file",
          name: "report.md",
          path: "archive/report.md",
        },
      })
    }) as typeof fetch

    const result = await runAnalyticsCli([
      "analytics-agent",
      "knowledge",
      "file",
      "move",
      "7",
      "21",
      "--parent-id",
      "20",
    ])

    expect(result.exitCode).toBe(0)
    expect(capturedUrl).toContain("/open/api/v1/analytics-agent/knowledge/spaces/7/nodes/21/move?tenantId=55")
    expect(capturedBody).toEqual({
      parentId: 20,
    })
    const parsed = JSON.parse(result.output.trim()) as Record<string, any>
    expect(parsed.data.path).toBe("archive/report.md")
  })

  test("file copy calls the knowledge node copy endpoint", async () => {
    let capturedUrl = ""
    let capturedBody: Record<string, unknown> | undefined

    globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input)
      capturedBody = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>
      return jsonResponse({
        success: true,
        data: {
          id: 121,
          spaceId: 7,
          parentId: 20,
          nodeType: 2,
          nodeTypeLabel: "file",
          name: "report-copy.md",
          path: "archive/report-copy.md",
        },
      })
    }) as typeof fetch

    const result = await runAnalyticsCli([
      "analytics-agent",
      "knowledge",
      "file",
      "copy",
      "7",
      "21",
      "--parent-id",
      "20",
    ])

    expect(result.exitCode).toBe(0)
    expect(capturedUrl).toContain("/open/api/v1/analytics-agent/knowledge/spaces/7/nodes/21/copy?tenantId=55")
    expect(capturedBody).toEqual({
      parentId: 20,
    })
    const parsed = JSON.parse(result.output.trim()) as Record<string, any>
    expect(parsed.data.path).toBe("archive/report-copy.md")
  })

  test("file upload creates target folders and completes upload", async () => {
    const localRoot = mkdtempSync(join(tmpdir(), "cz-knowledge-file-upload-"))
    const localFile = join(localRoot, "report.md")
    await writeFile(localFile, "# report")

    const folderCreates: Array<Record<string, unknown>> = []
    const uploadRequests: Array<Record<string, unknown>> = []
    const uploadPuts: string[] = []
    const completeCalls: string[] = []

    globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)

      if (url.startsWith("https://upload.example/")) {
        uploadPuts.push(url)
        return new Response("", { status: 200 })
      }

      if (url.includes("/nodes/by-path")) {
        const parsed = new URL(url)
        const path = parsed.searchParams.get("path")
        if (path === "remote-root") {
          return jsonResponse({ success: true, data: { found: false, node: null } })
        }
        if (path === "remote-root/report.md") {
          return jsonResponse({ success: true, data: { found: false, node: null } })
        }
        return jsonResponse({ success: true, data: { found: false, node: null } })
      }

      if (url.includes("/folders")) {
        const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>
        folderCreates.push(body)
        return jsonResponse({
          success: true,
          data: {
            id: 91,
            name: "remote-root",
            nodeTypeLabel: "folder",
          },
        })
      }

      if (url.includes("/nodes/upload-url")) {
        const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>
        uploadRequests.push(body)
        return jsonResponse({
          success: true,
          data: {
            nodeId: 101,
            uploadUrl: "https://upload.example/report.md",
            objectKey: "object/report.md",
          },
        })
      }

      if (url.includes("/upload-complete")) {
        completeCalls.push(url)
        return jsonResponse({
          success: true,
          data: {
            nodeId: 101,
            asyncTaskId: 1101,
          },
        })
      }

      throw new Error(`unexpected url: ${url}`)
    }) as typeof fetch

    try {
      const result = await runAnalyticsCli([
        "analytics-agent",
        "knowledge",
        "file",
        "upload",
        "7",
        localFile,
        "--target-path",
        "remote-root",
        "--domain-id",
        "195",
      ])

      expect(result.exitCode).toBe(0)
      expect(folderCreates).toEqual([
        { parentId: undefined, name: "remote-root" },
      ])
      expect(uploadRequests).toEqual([
        { parentId: 91, filename: "report.md", domainIds: [195], nodeId: undefined },
      ])
      expect(uploadPuts).toEqual([
        "https://upload.example/report.md",
      ])
      expect(completeCalls).toHaveLength(1)
      const parsed = JSON.parse(result.output.trim()) as Record<string, any>
      expect(parsed.data).toEqual({
        local_path: localFile,
        space_id: 7,
        target_path: "remote-root",
        remote_name: "report.md",
        remote_file_path: "remote-root/report.md",
        overwritten: false,
        created_folders: ["remote-root"],
        async_task_id: 1101,
        node_id: 101,
      })
    } finally {
      await rm(localRoot, { recursive: true, force: true })
    }
  })

  test("file upload overwrites existing remote file with nodeId", async () => {
    const localRoot = mkdtempSync(join(tmpdir(), "cz-knowledge-file-overwrite-"))
    const localFile = join(localRoot, "report.md")
    await writeFile(localFile, "# report")

    const uploadRequests: Array<Record<string, unknown>> = []

    globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)

      if (url.startsWith("https://upload.example/")) {
        return new Response("", { status: 200 })
      }

      if (url.includes("/nodes/by-path")) {
        const path = new URL(url).searchParams.get("path")
        if (path === "remote-root") {
          return jsonResponse({
            success: true,
            data: {
              found: true,
              node: {
                id: 91,
                nodeTypeLabel: "folder",
              },
            },
          })
        }
        if (path === "remote-root/report.md") {
          return jsonResponse({
            success: true,
            data: {
              found: true,
              node: {
                id: 222,
                nodeTypeLabel: "file",
              },
            },
          })
        }
        return jsonResponse({ success: true, data: { found: false, node: null } })
      }

      if (url.includes("/nodes/upload-url")) {
        const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>
        uploadRequests.push(body)
        return jsonResponse({
          success: true,
          data: {
            nodeId: 222,
            uploadUrl: "https://upload.example/report.md",
            objectKey: "object/report.md",
          },
        })
      }

      if (url.includes("/upload-complete")) {
        return jsonResponse({
          success: true,
          data: {
            nodeId: 222,
            asyncTaskId: 1222,
          },
        })
      }

      throw new Error(`unexpected url: ${url}`)
    }) as typeof fetch

    try {
      const result = await runAnalyticsCli([
        "analytics-agent",
        "knowledge",
        "file",
        "upload",
        "7",
        localFile,
        "--target-path",
        "remote-root",
      ])

      expect(result.exitCode).toBe(0)
      expect(uploadRequests).toEqual([
        { parentId: 91, filename: "report.md", domainIds: undefined, nodeId: 222 },
      ])
      const parsed = JSON.parse(result.output.trim()) as Record<string, any>
      expect(parsed.data.overwritten).toBe(true)
      expect(parsed.data.node_id).toBe(222)
      expect(parsed.data.async_task_id).toBe(1222)
    } finally {
      await rm(localRoot, { recursive: true, force: true })
    }
  })

  test("file upload keeps async_task_id when upload-complete returns numeric string", async () => {
    const localRoot = mkdtempSync(join(tmpdir(), "cz-knowledge-file-async-string-"))
    const localFile = join(localRoot, "report.md")
    await writeFile(localFile, "# report")

    globalThis.fetch = mock(async (input: RequestInfo | URL) => {
      const url = String(input)

      if (url.startsWith("https://upload.example/")) {
        return new Response("", { status: 200 })
      }

      if (url.includes("/nodes/by-path")) {
        return jsonResponse({ success: true, data: { found: false, node: null } })
      }

      if (url.includes("/nodes/upload-url")) {
        return jsonResponse({
          success: true,
          data: {
            nodeId: "223",
            uploadUrl: "https://upload.example/report.md",
            objectKey: "object/report.md",
          },
        })
      }

      if (url.includes("/upload-complete")) {
        return jsonResponse({
          success: true,
          data: {
            nodeId: "223",
            asyncTaskId: "1223",
          },
        })
      }

      throw new Error(`unexpected url: ${url}`)
    }) as typeof fetch

    try {
      const result = await runAnalyticsCli([
        "analytics-agent",
        "knowledge",
        "file",
        "upload",
        "7",
        localFile,
      ])

      expect(result.exitCode).toBe(0)
      const parsed = JSON.parse(result.output.trim()) as Record<string, any>
      expect(parsed.data.node_id).toBe(223)
      expect(parsed.data.async_task_id).toBe(1223)
    } finally {
      await rm(localRoot, { recursive: true, force: true })
    }
  })

  test("file upload rejects target path that resolves to a file node", async () => {
    const localRoot = mkdtempSync(join(tmpdir(), "cz-knowledge-file-target-file-"))
    const localFile = join(localRoot, "report.md")
    await writeFile(localFile, "# report")

    const fetchSpy = mock(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes("/nodes/by-path")) {
        return jsonResponse({
          success: true,
          data: {
            found: true,
            node: {
              id: 333,
              nodeTypeLabel: "file",
            },
          },
        })
      }
      throw new Error(`unexpected url: ${url}`)
    })
    globalThis.fetch = fetchSpy as typeof fetch

    try {
      const result = await runAnalyticsCli([
        "analytics-agent",
        "knowledge",
        "file",
        "upload",
        "7",
        localFile,
        "--target-path",
        "report.md",
      ])

      expect(result.exitCode).toBe(1)
      const parsed = JSON.parse(result.output.trim()) as Record<string, any>
      expect(parsed.error.code).toBe("ANALYTICS_AGENT_ERROR")
      expect(parsed.error.message).toContain("target path must be a folder path")
      expect(fetchSpy).toHaveBeenCalledTimes(1)
    } finally {
      await rm(localRoot, { recursive: true, force: true })
    }
  })

})
