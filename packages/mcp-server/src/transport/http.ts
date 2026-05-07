/**
 * HTTP transport — port of transport/mcp_server.py HTTP section (lines ~939-959)
 *
 * Python → TS mapping:
 *   mcp_server.py:939-959  run() HTTP branch → runHttp()
 *   mcp_server.py:945-953  FastMCP.run_streamable_http_async() → WebStandardStreamableHTTPServerTransport
 *   mcp_server.py:66-68    HTTP mode init (low_level_server only) → Server + transport
 *   run_http_server.py:155-165  server startup banner → logger.info calls
 *
 * Uses @modelcontextprotocol/sdk WebStandardStreamableHTTPServerTransport (Web Standard APIs)
 * with Hono as the HTTP framework, served via @hono/node-server.
 *
 * Divergences from Python:
 *   - FastAPI/uvicorn → Hono + @hono/node-server
 *   - Python uses FastMCP wrapper; TS uses low-level Server directly
 *   - Stateless transport (no sessionIdGenerator) — matches Python's per-request model
 */

import { randomUUID } from "node:crypto"
import { createServer } from "node:http"
import type { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js"
import { Hono } from "hono"
import { bearerAuthMiddleware } from "../auth/bearer.js"
import { logger } from "../logger.js"

export interface HttpTransportOptions {
  host: string
  port: number
  /** Bearer token for authentication. If empty/undefined, auth is disabled. */
  token?: string
}

/**
 * runHttp — mcp_server.py:939-959 HTTP branch
 *
 * Creates a Hono app with:
 *   - GET  /health  → { status: "ok" }  (no auth required)
 *   - POST /mcp     → MCP Streamable HTTP endpoint (Bearer auth required)
 *   - GET  /mcp     → MCP SSE stream endpoint (Bearer auth required)
 *   - DELETE /mcp   → MCP session termination (Bearer auth required)
 *
 * The transport is stateless (sessionIdGenerator: undefined) to match the
 * Python server's per-request model where each request is independently
 * authenticated via the Bearer token.
 */
export async function runHttp(server: Server, opts: HttpTransportOptions): Promise<void> {
  const { host, port, token } = opts

  // mcp_server.py:946-949 — startup banner
  logger.info("Starting HTTP MCP Server")
  logger.info({ host, port }, "Binding address")
  logger.info("MCP endpoint: /mcp")
  logger.info({ authEnabled: Boolean(token) }, "Bearer auth")

  // Create a new transport per server instance.
  // Stateless mode (sessionIdGenerator: undefined) — mcp_server.py:953 run_streamable_http_async
  // uses FastMCP which defaults to stateless for HTTP.
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
  })

  // Connect the MCP server to the transport
  await server.connect(transport)

  const app = new Hono()

  // ---------------------------------------------------------------------------
  // GET /health — run_http_server.py health check (no auth)
  // Returns { status: "ok" } — used by load balancers and smoke tests
  // ---------------------------------------------------------------------------
  app.get("/health", (c) => {
    return c.json({ status: "ok" })
  })

  // ---------------------------------------------------------------------------
  // /mcp routes — mcp_server.py:945-953 HTTP MCP endpoint
  // Bearer auth applied to all /mcp routes
  // ---------------------------------------------------------------------------
  const mcp = new Hono()
  mcp.use("*", bearerAuthMiddleware(token))

  // POST /mcp — MCP JSON-RPC requests (initialize, tools/call, etc.)
  mcp.post("/", async (c) => {
    const req = c.req.raw
    const response = await transport.handleRequest(req)
    return response
  })

  // GET /mcp — SSE stream for server-initiated notifications
  mcp.get("/", async (c) => {
    const req = c.req.raw
    const response = await transport.handleRequest(req)
    return response
  })

  // DELETE /mcp — session termination
  mcp.delete("/", async (c) => {
    const req = c.req.raw
    const response = await transport.handleRequest(req)
    return response
  })

  app.route("/mcp", mcp)

  // ---------------------------------------------------------------------------
  // Start the Node.js HTTP server — run_http_server.py:163-165 uvicorn.run(...)
  // @hono/node-server wraps Hono's fetch handler for Node.js compatibility
  // ---------------------------------------------------------------------------
  return new Promise((resolve, reject) => {
    const nodeServer = createServer(async (req, res) => {
      // Convert Node.js IncomingMessage to Web Standard Request for Hono
      const url = `http://${req.headers.host ?? `${host}:${port}`}${req.url ?? "/"}`
      const headers = new Headers()
      for (const [key, value] of Object.entries(req.headers)) {
        if (value === undefined) continue
        if (Array.isArray(value)) {
          for (const v of value) headers.append(key, v)
        } else {
          headers.set(key, value)
        }
      }

      // Read body for POST requests
      let body: BodyInit | null = null
      if (req.method !== "GET" && req.method !== "HEAD") {
        const chunks: Buffer[] = []
        for await (const chunk of req) {
          chunks.push(chunk as Buffer)
        }
        body = Buffer.concat(chunks)
      }

      const webReq = new Request(url, {
        method: req.method ?? "GET",
        headers,
        body,
        // @ts-expect-error — duplex is required for streaming bodies in Node.js fetch
        duplex: "half",
      })

      try {
        const webRes = await app.fetch(webReq)
        res.statusCode = webRes.status
        webRes.headers.forEach((value, key) => {
          res.setHeader(key, value)
        })
        if (webRes.body) {
          const reader = webRes.body.getReader()
          const pump = async (): Promise<void> => {
            const { done, value } = await reader.read()
            if (done) {
              res.end()
              return
            }
            res.write(value)
            return pump()
          }
          await pump()
        } else {
          res.end()
        }
      } catch (err) {
        logger.error({ err }, "HTTP request handler error")
        res.statusCode = 500
        res.end(JSON.stringify({ error: "Internal server error" }))
      }
    })

    nodeServer.on("error", (err) => {
      logger.error({ err }, "HTTP server error")
      reject(err)
    })

    nodeServer.listen(port, host, () => {
      logger.info({ host, port }, "HTTP MCP Server listening")
      logger.info(`  Health: http://${host}:${port}/health`)
      logger.info(`  MCP:    http://${host}:${port}/mcp`)
    })

    // Keep the promise pending until the server closes (or process exits)
    nodeServer.on("close", () => resolve())
  })
}
