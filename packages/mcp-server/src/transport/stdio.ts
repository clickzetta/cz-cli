/**
 * STDIO transport — port of transport/mcp_server.py stdio section (lines ~961-983)
 *
 * Python → TS mapping:
 *   mcp_server.py:961-983  elif transport_type == "stdio": ... stdio_server() → runStdio()
 *
 * Uses @modelcontextprotocol/sdk StdioServerTransport (Node.js stdin/stdout).
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"

/**
 * Create a StdioServerTransport and connect the given MCP Server to it.
 *
 * Mirrors mcp_server.py:971-983:
 *   async with stdio_server() as (read_stream, write_stream):
 *       await self.low_level_server.run(read_stream, write_stream, ...)
 */
export async function runStdio(server: Server): Promise<void> {
  const transport = new StdioServerTransport()
  await server.connect(transport)
}
