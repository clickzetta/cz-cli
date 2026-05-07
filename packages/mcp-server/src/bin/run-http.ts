#!/usr/bin/env bun
/**
 * run-http.ts — HTTP MCP Server entry point
 *
 * Python → TS mapping (run_http_server.py):
 *   lines   8-10   os.environ HF_ENDPOINT          → (skipped, Python-specific)
 *   lines  14-17   imports                          → node:util parseArgs + pino
 *   lines  20-80   setup_logging()                  → pino with optional file transport
 *   lines  83-113  create_parser() argparse         → node:util parseArgs
 *   lines 116-126  parse_port()                     → parsePort()
 *   lines 129-178  main() startup banner + server   → top-level await (Bun)
 *   lines 155-165  logging.info startup banner      → logger.info startup banner
 *   lines 163-165  ClickzettaMCPServer + server.run → Server + runHttp()
 *   lines 181-182  asyncio.run(main())              → top-level await (Bun supports it)
 *
 * Divergences:
 *   - Python RotatingFileHandler (10MB/5-10 backups) → pino file transport (no rotation in Block 1d)
 *   - Python argparse → node:util parseArgs
 *   - Python ClickzettaMCPServer → bare MCP SDK Server (Block 2 wires real tools)
 *   - Added --token / --enable-local-log / --log-dir flags (not in Python run_http_server.py
 *     but present in the broader HTTP deployment pattern from mcp_server.py auth section)
 */

import { parseArgs } from "node:util"
import { mkdirSync } from "node:fs"
import { resolve } from "node:path"
import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import pino from "pino"
import { runHttp } from "../transport/http.js"
import { McpComponentRegistrar } from "../transport/registrar.js"
import { McpServerCore } from "../server.js"
import { getToolRegistry } from "../tool-registry.js"
import { registerAllTools } from "../tools/index.js"

// ---------------------------------------------------------------------------
// CLI argument parsing — run_http_server.py:83-113 (create_parser)
// Using node:util parseArgs instead of argparse (no external deps)
// ---------------------------------------------------------------------------
const { values: flags } = parseArgs({
  args: process.argv.slice(2),
  options: {
    // run_http_server.py:93-97 — --host default 0.0.0.0
    host: { type: "string", default: "0.0.0.0" },
    // run_http_server.py:99-103 — --port default 8000 (or "random")
    port: { type: "string", default: "8000" },
    // run_http_server.py:105-107 — --random-port flag (shorthand for --port random)
    "random-port": { type: "boolean", default: false },
    // Bearer token for HTTP auth — mcp_server.py auth section
    token: { type: "string" },
    // run_http_server.py:20-80 — setup_logging() file logging
    "enable-local-log": { type: "boolean", default: false },
    "log-dir": { type: "string" },
  },
  strict: false,
})

// ---------------------------------------------------------------------------
// parsePort — run_http_server.py:116-126
// Handles numeric port or "random" (find a free OS port)
// ---------------------------------------------------------------------------
function parsePort(portArg: string, randomPort: boolean): number {
  // run_http_server.py:118 — if port_arg.lower() == 'random'
  if (randomPort || portArg.toLowerCase() === "random") {
    // run_http_server.py:120-122 — socket.bind(('', 0)) to get random port
    // In Bun/Node.js we use net.createServer to find a free port
    const net = require("node:net") as typeof import("node:net")
    const srv = net.createServer()
    srv.listen(0)
    const addr = srv.address() as { port: number }
    const p = addr.port
    srv.close()
    return p
  }
  const p = parseInt(portArg, 10)
  if (isNaN(p) || p < 1 || p > 65535) {
    throw new Error(`Invalid port '${portArg}'. Use a number (1-65535) or 'random'.`)
  }
  return p
}

// ---------------------------------------------------------------------------
// Environment setup
// ---------------------------------------------------------------------------
process.env["CZ_MCP_TRANSPORT"] = "http"

// ---------------------------------------------------------------------------
// Logger setup — run_http_server.py:20-80 (setup_logging)
// Python: RotatingFileHandler 10MB/5-10 backups + console handler
// TS: pino with optional file transport (rotation deferred to Block 2 / logrotate)
// ---------------------------------------------------------------------------
const enableLocalLog = flags["enable-local-log"] as boolean
const logDirArg = flags["log-dir"] as string | undefined

let logDir: string | undefined
if (enableLocalLog) {
  // run_http_server.py:26-31 — determine log directory
  logDir = logDirArg
    ? resolve(logDirArg)
    : resolve(process.cwd(), "logs")

  // run_http_server.py:33-34 — log_dir.mkdir(parents=True, exist_ok=True)
  mkdirSync(logDir, { recursive: true })
}

let logger: pino.Logger
if (enableLocalLog && logDir) {
  // run_http_server.py:37-75 — RotatingFileHandler for app + access logs
  // pino multi-transport: file + stdout
  const transport = pino.transport({
    targets: [
      {
        // run_http_server.py:44-51 — app_log_file = log_dir / "server.log", maxBytes=10MB, backupCount=5
        target: "pino/file",
        options: { destination: resolve(logDir, "server.log"), mkdir: true },
      },
      {
        // run_http_server.py:68-72 — console_handler → stdout
        target: "pino/file",
        options: { destination: 1 }, // stdout fd
      },
    ],
  })
  logger = pino(
    { level: process.env["LOG_LEVEL"] ?? "info", base: { app: "cz-mcp-http" } },
    transport,
  )
  // run_http_server.py:77-80 — log startup information
  logger.info({ logDir, appLog: resolve(logDir, "server.log") }, "Logging configured")
  logger.info("Log rotation: 10MB per file (managed by logrotate in production)")
} else {
  // Default: stdout only
  logger = pino(
    { level: process.env["LOG_LEVEL"] ?? "info", base: { app: "cz-mcp-http" } },
    pino.destination(1),
  )
}

// ---------------------------------------------------------------------------
// Parse port — run_http_server.py:129-135
// ---------------------------------------------------------------------------
const host = flags["host"] as string
let port: number
try {
  port = parsePort(flags["port"] as string, flags["random-port"] as boolean)
} catch (err) {
  logger.error({ err }, "Invalid port argument")
  process.exit(1)
}

const token = flags["token"] as string | undefined

// ---------------------------------------------------------------------------
// Startup banner — run_http_server.py:137-155
// ---------------------------------------------------------------------------
logger.info("=".repeat(60))
logger.info("   Starting Clickzetta HTTP MCP Server")
logger.info({ host }, "   Host")
logger.info({ port }, "   Port")
logger.info("   Transport type: HTTP (centralized deployment)")
logger.info({ authEnabled: Boolean(token) }, "   Authentication: Bearer token from headers")
if (logDir) {
  logger.info({ logDir }, "   Log directory")
}
logger.info("")
logger.info("Example client requests:")
logger.info("  With Authorization header:")
logger.info(`    curl 'http://${host}:${port}/mcp' \\`)
logger.info("      -H 'Authorization: Bearer YOUR_TOKEN' \\")
logger.info("=".repeat(60))

// ---------------------------------------------------------------------------
// Server startup — run_http_server.py:163-165
// Create a low-level MCP Server and wire all tools/resources/prompts via
// McpComponentRegistrar (mirrors ClickzettaMCPServer.low_level_server setup).
// ---------------------------------------------------------------------------
const server = new Server(
  { name: "clickzetta-http-server", version: "0.1.0" },
  { capabilities: { tools: {}, resources: {}, prompts: {} } },
)

// mcp_registrar.py:36-57 — create registrar with server_core + tool_registry
const serverCore = new McpServerCore()
const toolRegistry = getToolRegistry()

// HTTP mode: tools are registered without a pre-initialized DB connection.
// Each tool call acquires a connection on demand via serverCore.getDb().
// (No config available at startup in HTTP mode — auth comes per-request.)
logger.info("HTTP mode: tools registered without pre-initialized DB (per-request auth)")

// mcp_registrar.py:200-278 — register tools, resources, prompts
const registrar = new McpComponentRegistrar(serverCore, toolRegistry)
registrar.registerAll(server)

// run_http_server.py:165 — await server.run()
try {
  await runHttp(server, { host, port, token })
} catch (err) {
  logger.error({ err }, "Failed to start HTTP MCP Server")
  process.exit(1)
}
