/**
 * http.test.ts — HTTP transport smoke test
 *
 * Tests:
 *   1. GET /health → 200 { status: "ok" }
 *   2. POST /mcp without token → 401
 *   3. POST /mcp with valid Bearer token → 200 with result.capabilities (MCP initialize)
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test"
import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { createServer } from "node:net"
import { runHttp } from "../src/transport/http.js"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Find a free TCP port by binding to port 0 */
function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer()
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address() as { port: number }
      srv.close(() => resolve(addr.port))
    })
    srv.on("error", reject)
  })
}

const TEST_TOKEN = "test-bearer-token-abc123"
const MCP_INITIALIZE = JSON.stringify({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "test", version: "0" },
  },
})

let baseUrl: string
let serverAbortController: AbortController

// ---------------------------------------------------------------------------
// Setup: start HTTP server on a random port
// ---------------------------------------------------------------------------
beforeAll(async () => {
  const port = await getFreePort()
  baseUrl = `http://127.0.0.1:${port}`

  const mcpServer = new Server(
    { name: "test-http-server", version: "0.0.1" },
    { capabilities: { tools: {}, resources: {}, prompts: {} } },
  )

  serverAbortController = new AbortController()

  // Start server in background — runHttp returns a promise that resolves when server closes
  runHttp(mcpServer, { host: "127.0.0.1", port, token: TEST_TOKEN }).catch(() => {
    // Server closed — expected on test teardown
  })

  // Wait for server to be ready
  await waitForServer(baseUrl + "/health", 5000)
})

afterAll(() => {
  serverAbortController.abort()
})

/** Poll /health until it responds or timeout */
async function waitForServer(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url)
      if (res.ok) return
    } catch {
      // not ready yet
    }
    await new Promise((r) => setTimeout(r, 50))
  }
  throw new Error(`Server at ${url} did not become ready within ${timeoutMs}ms`)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("HTTP transport smoke test", () => {
  it("GET /health → 200 { status: 'ok' }", async () => {
    const res = await fetch(`${baseUrl}/health`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body["status"]).toBe("ok")
  })

  it("POST /mcp without token → 401", async () => {
    const res = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: MCP_INITIALIZE,
    })
    expect(res.status).toBe(401)
    const body = (await res.json()) as Record<string, unknown>
    expect(body["error"]).toBe("Unauthorized")
  })

  it("POST /mcp with wrong token → 401", async () => {
    const res = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer wrong-token",
      },
      body: MCP_INITIALIZE,
    })
    expect(res.status).toBe(401)
  })

  it("POST /mcp with valid Bearer token → MCP initialize response with capabilities", async () => {
    const res = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${TEST_TOKEN}`,
        Accept: "application/json, text/event-stream",
      },
      body: MCP_INITIALIZE,
    })

    expect(res.status).toBe(200)

    const contentType = res.headers.get("content-type") ?? ""
    let responseBody: Record<string, unknown>

    if (contentType.includes("text/event-stream")) {
      // SSE response — read first data event
      const text = await res.text()
      const dataLine = text.split("\n").find((l) => l.startsWith("data:"))
      expect(dataLine).toBeDefined()
      responseBody = JSON.parse(dataLine!.slice("data:".length).trim()) as Record<string, unknown>
    } else {
      responseBody = (await res.json()) as Record<string, unknown>
    }

    expect(responseBody["jsonrpc"]).toBe("2.0")
    expect(responseBody["id"]).toBe(1)
    const result = responseBody["result"] as Record<string, unknown> | undefined
    expect(result).toBeDefined()
    expect(result!["capabilities"]).toBeDefined()
  }, 10000)
})
