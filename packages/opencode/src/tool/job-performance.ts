import { Effect, Schema } from "effect"
import { readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { parse as parseTOML } from "smol-toml"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js"
import { InstallationVersion } from "@opencode-ai/core/installation/version"
import * as Tool from "./tool"

const Parameters = Schema.Struct({
  workspace_name: Schema.optional(Schema.String).annotate({ description: "Workspace name" }),
  job_id: Schema.optional(Schema.String).annotate({
    description: "Lakehouse engine SQL job_id. This job ID does not need to be checked for existence.",
  }),
  enable_incremental_algorithm: Schema.optional(Schema.Boolean).annotate({
    description: "Enable incremental algorithm, default is false",
  }),
  enable_state_table: Schema.optional(Schema.Boolean).annotate({
    description: "Enable state table optimization, default is true",
  }),
  analysis_mode: Schema.optional(Schema.Literals(["quick", "detailed", "expert"])).annotate({
    description:
      "分析模式，默认 quick。必须严格按以下关键词匹配，不要自行升级：quick='分析'/'看看'/'帮我分析'（默认）；detailed='详细分析'/'仔细看看'/'再详细分析下'；expert=仅当用户原话包含'专家模式'/'深度分析'/'全面分析'时才用。'详细'='detailed'，不是'expert'。不确定时选 quick。",
  }),
  path: Schema.optional(Schema.String).annotate({
    description:
      "Optional local folder path containing both job_plan.json and job_profile.json. If provided, data is loaded from these local files instead of the API, and job_id is not required.",
  }),
})

const DESCRIPTION = [
  "Fetch a Lakehouse SQL job's execution plan and runtime profile for performance diagnosis and tuning.",
  "Use this when the user provides a job_id and asks to analyze a job/task's performance, find bottlenecks, or give optimization/tuning suggestions.",
  "Returns structured job plan and profile data.",
  "Examples:",
  "- Analyze job 2026012808001805432z9g3fx1sok.",
  "- 帮我分析下这个任务并给出调优建议。",
].join("\n")

// MCP is only served from the "central region". Following cz-mcp-server's
// host→env rules, map any service host to its central-region API URL; the else
// branch falls back to the host itself (then appends the MCP suffix uniformly).
function centralApiUrl(host: string): string {
  if (host.startsWith("uat-")) return "https://uat-api.clickzetta.com"
  if (host.startsWith("dev-") || host.startsWith("localhost") || host.startsWith("0.0.0.0"))
    return "https://dev-api.clickzetta.com"
  if (host.endsWith("singdata.com")) return "https://ap-southeast-1-alicloud.api.singdata.com"
  // OP single-domain deployments: keep as-is (no central region redirect)
  if (host.endsWith("clickzetta-inc.com") || host.endsWith("kuaishou.com")) return `https://${host}`
  // Exclude OP subdomains that don't follow the {region}.api.clickzetta.com pattern
  if (host.endsWith("clickzetta.com") && !host.includes(".api.clickzetta.com")) {
    // e.g. fumi-cn-south-1-huaweicloud.clickzetta.com — OP deployment, keep as-is
    if (!host.startsWith("cn-") && !host.startsWith("ap-") && !host.startsWith("us-") && !host.startsWith("eu-"))
      return `https://${host}`
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

/**
 * Derive the "central region" MCP endpoint from a service URL: first map the
 * host to the central-region API URL, then insert `-mcp` before the `api` label
 * and set the path to `/mcp`.
 */
export function serviceUrlToMcpUrl(serviceUrl: string): string {
  const apiHost = normalizeHost(centralApiUrl(normalizeHost(serviceUrl)))
  // OP domains without "api" in hostname: use directly with /mcp path
  if (!apiHost.includes("api")) return `https://${apiHost}/mcp`
  return `https://${apiHost.replace(/([.-])api(?=\.)/, "-mcp$1api")}/mcp`
}

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

/** Resolve the active connection: prefer CZ_* env vars, else read CZ_PROFILE / default_profile from ~/.clickzetta/profiles.toml. */
function loadProfile(): Profile {
  const env = process.env
  let p: Record<string, unknown> = {}
  try {
    const home = env.CLICKZETTA_TEST_HOME || homedir()
    const toml = parseTOML(readFileSync(join(home, ".clickzetta", "profiles.toml"), "utf-8")) as Record<string, unknown>
    const profiles = (toml.profiles ?? {}) as Record<string, Record<string, unknown>>
    const name = env.CZ_PROFILE || (typeof toml.default_profile === "string" ? toml.default_profile : undefined) || Object.keys(profiles)[0]
    p = (name && profiles[name]) || {}
  } catch {}
  const pick = (envKey: string, field: string) => {
    if (env[envKey]) return env[envKey]
    const v = p[field]
    return typeof v === "string" ? v : undefined
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

/** Auth header: use Bearer when a PAT is present, otherwise pass through x-Lakehouse-* credentials for the remote MCP to log in itself. */
export function buildAuthHeaders(p: Profile): Record<string, string> {
  if (p.pat) return { "X-Lakehouse-Token": `Bearer ${p.pat}` }
  const h: Record<string, string> = {}
  if (p.username) h["x-Lakehouse-Username"] = p.username
  if (p.password) h["x-Lakehouse-Password"] = p.password
  if (p.service) h["x-Lakehouse-Service"] = normalizeHost(p.service)
  if (p.instance) h["x-Lakehouse-Instance"] = p.instance
  if (p.workspace) h["x-Lakehouse-Workspace"] = p.workspace
  if (p.schema) h["x-Lakehouse-Schema"] = p.schema
  if (p.vcluster) h["x-Lakehouse-VCluster"] = p.vcluster
  return h
}

export function pruneUndefined(params: Schema.Schema.Type<typeof Parameters>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(params)) if (v !== undefined) out[k] = v
  return out
}

/** Call a remote tool over Streamable-HTTP MCP (the SDK handles the initialize + session handshake) and return its text content. */
export async function callMcp(
  url: string,
  authHeaders: Record<string, string>,
  args: Record<string, unknown>,
  signal: AbortSignal,
): Promise<string> {
  const transport = new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers: authHeaders } })
  const client = new Client({ name: "cz-cli", version: InstallationVersion })
  try {
    await client.connect(transport)
    const result = await client.callTool({ name: "analyze_lakehouse_job", arguments: args }, CallToolResultSchema, {
      signal,
      timeout: 120_000,
      resetTimeoutOnProgress: true,
    })
    const content = (result.content ?? []) as Array<{ type?: string; text?: string }>
    const text = content
      .filter((c) => c.type === "text")
      .map((c) => c.text ?? "")
      .join("\n")
    return text || "（远程 MCP 无文本返回）"
  } finally {
    await client.close().catch(() => {})
  }
}

export const JobPerformanceTool = Tool.define(
  "analyze_lakehouse_job",
  Effect.gen(function* () {
    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          yield* ctx.ask({
            permission: "analyze_lakehouse_job",
            patterns: [params.job_id ?? params.path ?? "*"],
            always: ["*"],
            metadata: { ...params },
          })

          const profile = loadProfile()
          if (!profile.service) {
            return {
              output: "未找到可用的 ClickZetta 连接（~/.clickzetta/profiles.toml 缺少 default_profile 或 service）。",
              title: "Job perf",
              metadata: {},
            }
          }

          const output = yield* Effect.tryPromise({
            try: () =>
              callMcp(serviceUrlToMcpUrl(profile.service!), buildAuthHeaders(profile), pruneUndefined(params), ctx.abort),
            catch: (e) => (e instanceof Error ? e : new Error(String(e))),
          }).pipe(Effect.catch((e) => Effect.succeed(`远程 MCP 调用失败: ${e.message}`)))

          return {
            output,
            title: `Job perf: ${params.job_id ?? params.path ?? "(unspecified)"}`,
            metadata: {},
          }
        }).pipe(Effect.orDie),
    }
  }),
)
