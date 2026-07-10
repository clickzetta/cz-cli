import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js"
import { buildLakehouseAuthHeaders, hasLakehouseAuth, serviceUrlToMcpUrl } from "../clickzetta-mcp.js"
import { resolveConnectionConfig } from "../connection/config.js"
import { VERSION } from "../version.js"
export { serviceUrlToMcpUrl }
export const buildAuthHeaders = buildLakehouseAuthHeaders

function maskToken(pat?: string): string {
  if (!pat || pat.length <= 10) return pat ?? "(none)"
  return pat.slice(0, 7) + "****"
}

export function pruneUndefined(params: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(params).filter((entry) => entry[1] !== undefined))
}

export type AnalyzeJobOptions = {
  profile?: string
  workspaceName?: string
  jobId?: string
  path?: string
  enableIncrementalAlgorithm?: boolean
  enableStateTable?: boolean
  analysisMode?: "quick" | "detailed" | "expert"
  signal?: AbortSignal
}

export async function analyzeJobPerformance(options: AnalyzeJobOptions, debug?: boolean): Promise<string> {
  const profile = resolveConnectionConfig({ profile: options.profile })
  if (!hasLakehouseAuth(profile)) throw new Error("未找到可用的 ClickZetta 连接认证信息（缺少 PAT 或 username/password）。")
  const mcpUrl = serviceUrlToMcpUrl(profile.service)
  const headers = buildAuthHeaders(profile)
  const args = pruneUndefined({
    workspace_name: (options.workspaceName ?? profile.workspace) || undefined,
    job_id: options.jobId,
    path: options.path,
    enable_incremental_algorithm: options.enableIncrementalAlgorithm,
    enable_state_table: options.enableStateTable,
    analysis_mode: options.analysisMode,
  })
  if (debug) {
    const sanitizedHeaders: Record<string, string> = {}
    for (const [k, v] of Object.entries(headers)) sanitizedHeaders[k] = k.toLowerCase().includes("token") ? maskToken(profile.pat) : v
    process.stderr.write(`[DEBUG] MCP URL: ${mcpUrl}\n[DEBUG] Headers: ${JSON.stringify(sanitizedHeaders)}\n[DEBUG] Args: ${JSON.stringify(args)}\n`)
  }
  const transport = new StreamableHTTPClientTransport(new URL(mcpUrl), {
    requestInit: { headers },
  })
  const client = new Client({ name: "cz-cli", version: VERSION })
  try {
    await client.connect(transport)
    const result = await client.callTool({ name: "analyze_lakehouse_job", arguments: args }, CallToolResultSchema, {
      signal: options.signal,
      timeout: 120_000,
      resetTimeoutOnProgress: true,
    })
    const content = (result.content ?? []) as Array<{ type?: string; text?: string }>
    const text = content.filter((item) => item.type === "text").map((item) => item.text ?? "").join("\n") || "（远程 MCP 无文本返回）"
    if (debug) process.stderr.write(`[DEBUG] MCP result (first 500 chars): ${text.slice(0, 500)}\n`)
    return text
  } finally {
    await client.close().catch(() => {})
  }
}
