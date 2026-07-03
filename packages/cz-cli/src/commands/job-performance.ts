import { readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { parse as parseTOML } from "smol-toml"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js"
import { VERSION } from "../version.js"

type Profile = {
  pat?: string
  username?: string
  password?: string
  service?: string
  instance?: string
  workspace?: string
  schema?: string
  vcluster?: string
}

const VW_UAT_HOST = "lakehouse-studio.uat.cn-vw.volkswagen-cea.com"

function centralApiUrl(host: string): string {
  if (host.startsWith("uat-")) return "https://uat-api.clickzetta.com"
  if (host.startsWith("dev-") || host.startsWith("localhost") || host.startsWith("0.0.0.0")) return "https://dev-api.clickzetta.com"
  if (host.endsWith("singdata.com")) return "https://ap-southeast-1-alicloud.api.singdata.com"
  if (host.endsWith("clickzetta-inc.com") || host.endsWith("kuaishou.com")) return `https://${host}`
  if (host.endsWith("clickzetta.com") && !host.includes(".api.clickzetta.com")) {
    if (!host.startsWith("cn-") && !host.startsWith("ap-") && !host.startsWith("us-") && !host.startsWith("eu-")) return `https://${host}`
    return "https://cn-shanghai-alicloud.api.clickzetta.com"
  }
  if (host.endsWith("clickzetta.com")) return "https://cn-shanghai-alicloud.api.clickzetta.com"
  return `https://${host}`
}

function normalizeHost(serviceUrl: string): string {
  if (!serviceUrl) return ""
  const value = serviceUrl.trim().toLowerCase()
  const withScheme = value.includes("://") ? value : `https://${value}`
  try {
    return new URL(withScheme).host
  } catch {
    return value.replace(/^https?:\/\//, "").split("/", 1)[0]!
  }
}

export function serviceUrlToMcpUrl(serviceUrl: string): string {
  const host = normalizeHost(serviceUrl)
  if (host === VW_UAT_HOST) return `http://${VW_UAT_HOST}/mcp`
  const apiHost = normalizeHost(centralApiUrl(host))
  if (!apiHost.includes("api")) return `https://${apiHost}/mcp`
  return `https://${apiHost.replace(/([.-])api(?=\.)/, "-mcp$1api")}/mcp`
}

function loadProfile(profileName?: string): Profile {
  const env = process.env
  let p: Record<string, unknown> = {}
  try {
    const toml = parseTOML(readFileSync(join(env.CLICKZETTA_TEST_HOME || homedir(), ".clickzetta", "profiles.toml"), "utf-8")) as Record<string, unknown>
    const profiles = (toml.profiles ?? {}) as Record<string, Record<string, unknown>>
    const name = profileName || env.CZ_PROFILE || (typeof toml.default_profile === "string" ? toml.default_profile : undefined) || Object.keys(profiles)[0]
    p = (name && profiles[name]) || {}
  } catch {}
  const pick = (envKey: string, field: string) => {
    if (env[envKey]) return env[envKey]
    const value = p[field]
    return typeof value === "string" ? value : undefined
  }
  return {
    pat: pick("CZ_PAT", "pat"),
    username: pick("CZ_USERNAME", "username"),
    password: pick("CZ_PASSWORD", "password"),
    service: pick("CZ_SERVICE", "service"),
    instance: pick("CZ_INSTANCE", "instance"),
    workspace: pick("CZ_WORKSPACE", "workspace"),
    schema: pick("CZ_SCHEMA", "schema"),
    vcluster: pick("CZ_VCLUSTER", "vcluster"),
  }
}

export function buildAuthHeaders(profile: Profile): Record<string, string> {
  const hasToken = !!profile.pat
  const headers: Record<string, string> = {}
  if (hasToken) headers["X-Lakehouse-Token"] = `Bearer ${profile.pat}`
  if (profile.username && !hasToken) headers["x-Lakehouse-Username"] = profile.username
  if (profile.password && !hasToken) headers["x-Lakehouse-Password"] = profile.password
  if (profile.service) headers["x-Lakehouse-Service"] = normalizeHost(profile.service)
  if (profile.instance) headers["x-Lakehouse-Instance"] = profile.instance
  if (profile.workspace) headers["x-Lakehouse-Workspace"] = profile.workspace
  if (profile.schema) headers["x-Lakehouse-Schema"] = profile.schema
  if (profile.vcluster) headers["x-Lakehouse-VCluster"] = profile.vcluster
  return headers
}

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
  const profile = loadProfile(options.profile)
  if (!profile.service) throw new Error("未找到可用的 ClickZetta 连接（~/.clickzetta/profiles.toml 缺少 default_profile 或 service）。")
  const mcpUrl = serviceUrlToMcpUrl(profile.service)
  const headers = buildAuthHeaders(profile)
  const args = pruneUndefined({
    workspace_name: options.workspaceName ?? profile.workspace,
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
