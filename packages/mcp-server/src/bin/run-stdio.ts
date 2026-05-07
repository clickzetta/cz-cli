#!/usr/bin/env bun
/**
 * run-stdio.ts — STDIO MCP Server entry point
 *
 * Python → TS mapping (run_stdio_server.py):
 *   lines  20-78   create_parser / argparse          → node:util parseArgs
 *   lines  69-78   apply_header_style_overrides       → key=value positional args
 *   lines  81-87   normalize_service_url              → normalizeServiceUrl()
 *   lines  90-133  apply_cli_config_overrides         → StudioConfigManager.loadFromFile overrides
 *   lines 136-148  main() env setup                   → process.env setup
 *   lines 151-162  logger.info startup banner         → logger.info startup banner
 *   lines 164-174  server = ClickzettaMCPServer(...)  → McpServer + runStdio()
 *   lines 177-178  asyncio.run(main())                → top-level await (Bun supports it)
 */

import { parseArgs } from "node:util"
import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import pino from "pino"
import { StudioConfigManager } from "../config/profile.js"
import { getRegionByAlias, getRegionByServiceUrl } from "../config/region.js"
import { runStdio } from "../transport/stdio.js"

// ---------------------------------------------------------------------------
// HEADER_ARG_MAP — run_stdio_server.py:16-26
// Maps header-style key names (used in key=value positional args) to camelCase
// ---------------------------------------------------------------------------
const HEADER_ARG_MAP: Record<string, string> = {
  "x-lakehouse-username": "username",
  "x-lakehouse-password": "password",
  "x-lakehouse-token": "pat",
  "x-lakehouse-service": "service",
  "x-lakehouse-instance": "instance",
  "x-lakehouse-workspace": "workspace",
  "x-lakehouse-schema": "schema",
  "x-lakehouse-vcluster": "vcluster",
  "x-lakehouse-region": "region",
}

// ---------------------------------------------------------------------------
// normalizeServiceUrl — run_stdio_server.py:81-87
// ---------------------------------------------------------------------------
function normalizeServiceUrl(value: string): string {
  const v = value.trim()
  if (v.startsWith("http://") || v.startsWith("https://")) return v
  return `https://${v}`
}

// ---------------------------------------------------------------------------
// CLI argument parsing — run_stdio_server.py:29-66 (create_parser)
// Using node:util parseArgs instead of argparse (no external deps)
// ---------------------------------------------------------------------------
const { values: flags, positionals } = parseArgs({
  args: process.argv.slice(2),
  options: {
    env: { type: "string", default: "dev" },
    "x-lakehouse-username": { type: "string" },
    "x-lakehouse-password": { type: "string" },
    "x-lakehouse-token": { type: "string" },
    "x-lakehouse-service": { type: "string" },
    "x-lakehouse-instance": { type: "string" },
    "x-lakehouse-workspace": { type: "string" },
    "x-lakehouse-schema": { type: "string" },
    "x-lakehouse-vcluster": { type: "string" },
    "x-lakehouse-region": { type: "string" },
    "enable-local-log": { type: "boolean", default: false },
    "app-log-path": { type: "string" },
  },
  allowPositionals: true,
  strict: false,
})

// ---------------------------------------------------------------------------
// apply_header_style_overrides — run_stdio_server.py:69-78
// Support key=value positional args like: x-Lakehouse-Username=UAT_TEST
// ---------------------------------------------------------------------------
const extraOverrides: Record<string, string> = {}
for (const item of positionals) {
  if (!item.includes("=")) continue
  const eqIdx = item.indexOf("=")
  const key = item.slice(0, eqIdx).trim().toLowerCase()
  const value = item.slice(eqIdx + 1).trim()
  const mapped = HEADER_ARG_MAP[key]
  if (mapped) {
    extraOverrides[mapped] = value
  }
}

// Merge flag-based overrides into a single overrides object
const cliOverrides: Record<string, string | undefined> = {
  username: (flags["x-lakehouse-username"] as string | undefined) ?? extraOverrides["username"],
  password: (flags["x-lakehouse-password"] as string | undefined) ?? extraOverrides["password"],
  pat: (flags["x-lakehouse-token"] as string | undefined) ?? extraOverrides["pat"],
  service: (flags["x-lakehouse-service"] as string | undefined) ?? extraOverrides["service"],
  instance: (flags["x-lakehouse-instance"] as string | undefined) ?? extraOverrides["instance"],
  workspace: (flags["x-lakehouse-workspace"] as string | undefined) ?? extraOverrides["workspace"],
  schema: (flags["x-lakehouse-schema"] as string | undefined) ?? extraOverrides["schema"],
  vcluster: (flags["x-lakehouse-vcluster"] as string | undefined) ?? extraOverrides["vcluster"],
  region: (flags["x-lakehouse-region"] as string | undefined) ?? extraOverrides["region"],
}

// Normalize service URL if provided — run_stdio_server.py:96-99
if (cliOverrides["service"]) {
  cliOverrides["service"] = normalizeServiceUrl(cliOverrides["service"])
}

// run_stdio_server.py:101-106 — resolve region from alias, or infer from service URL.
// If both are set, --x-lakehouse-region wins (Python precedence).
if (cliOverrides["region"]) {
  const resolved = getRegionByAlias(cliOverrides["region"], cliOverrides["region"])
  if (resolved) cliOverrides["region"] = resolved
} else if (cliOverrides["service"]) {
  const inferred = getRegionByServiceUrl(cliOverrides["service"], null)
  if (inferred) cliOverrides["region"] = inferred
}

// Strip undefined values
const cleanOverrides = Object.fromEntries(
  Object.entries(cliOverrides).filter(([, v]) => v !== undefined),
) as Record<string, string>

// ---------------------------------------------------------------------------
// Environment setup — run_stdio_server.py:143-149
// STDIO default: no local file logs unless --enable-local-log
// ---------------------------------------------------------------------------
process.env["CZ_MCP_TRANSPORT"] = "stdio"
const enableLocalLog = flags["enable-local-log"] as boolean
if (enableLocalLog) {
  process.env["CZ_MCP_LOG_TO_FILE"] = "1"
  const appLogPath = flags["app-log-path"] as string | undefined
  if (appLogPath) {
    process.env["APP_LOG_PATH"] = appLogPath
  }
} else {
  process.env["CZ_MCP_LOG_TO_FILE"] ??= "0"
}

// ---------------------------------------------------------------------------
// Logger setup — run_stdio_server.py:135-145
// In STDIO mode, log to stderr (not stdout) so MCP JSON-RPC on stdout is clean.
// When --enable-local-log, also write to a file via pino transport.
// ---------------------------------------------------------------------------
const logToFile = process.env["CZ_MCP_LOG_TO_FILE"] === "1"
const appLogPath = process.env["APP_LOG_PATH"]

let logger: pino.Logger
if (logToFile && appLogPath) {
  // pino file transport — run_stdio_server.py:144-147 (loguru file sink)
  const transport = pino.transport({
    targets: [
      { target: "pino/file", options: { destination: `${appLogPath}/cz-mcp-stdio.log`, mkdir: true } },
      { target: "pino/file", options: { destination: 2 } }, // stderr fd
    ],
  })
  logger = pino({ level: process.env["LOG_LEVEL"] ?? "info", base: { app: "cz-mcp-stdio" } }, transport)
} else {
  // Default: stderr only (fd 2) — keeps stdout clean for MCP JSON-RPC
  logger = pino(
    { level: process.env["LOG_LEVEL"] ?? "info", base: { app: "cz-mcp-stdio" } },
    pino.destination(2),
  )
}

// ---------------------------------------------------------------------------
// Config loading — run_stdio_server.py:80-135
// ---------------------------------------------------------------------------
const env = (flags["env"] as string) ?? "dev"
const config = StudioConfigManager.loadFromFile(env, cleanOverrides)

// ---------------------------------------------------------------------------
// Startup banner — run_stdio_server.py:154-162
// ---------------------------------------------------------------------------
logger.info("Starting Clickzetta STDIO MCP Server")
logger.info({ env }, "Environment")
logger.info("Transport type: STDIO (local development)")
logger.info("Authentication: Configuration-based with token caching")
logger.info({ enabled: logToFile }, "Local file logging")
if (appLogPath) {
  logger.info({ appLogPath }, "APP_LOG_PATH")
}
logger.info({ configFile: `config/${env}_properties.ini` }, "Config file")

// ---------------------------------------------------------------------------
// Server startup — run_stdio_server.py:164-174
// Create a low-level MCP Server (mirrors ClickzettaMCPServer.low_level_server)
// Block 2 will wire in real tool handlers; for now we expose empty capabilities.
// ---------------------------------------------------------------------------
const server = new Server(
  { name: "clickzetta-stdio-server", version: "0.1.0" },
  { capabilities: { tools: {}, resources: {}, prompts: {} } },
)

// run_stdio_server.py:167 — await server.run()
try {
  await runStdio(server)
} catch (err) {
  if ((err as NodeJS.ErrnoException).code === "ERR_USE_AFTER_CLOSE") {
    // Client disconnected cleanly
    process.exit(0)
  }
  logger.error({ err }, "Failed to start STDIO MCP Server")
  process.exit(1)
}
