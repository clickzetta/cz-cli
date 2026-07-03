import z from "zod"
import { Effect } from "effect"
import { readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { parse as parseTOML } from "smol-toml"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js"
import { InstallationVersion } from "../installation/version"
import * as Tool from "./tool"

const Parameters = z.object({
  workspace_name: z.string().optional().describe("Workspace name"),
  job_id: z
    .string()
    .optional()
    .describe("Lakehouse engine SQL job_id. This job ID does not need to be checked for existence."),
  enable_incremental_algorithm: z.boolean().optional().describe("Enable incremental algorithm, default is false"),
  enable_state_table: z.boolean().optional().describe("Enable state table optimization, default is true"),
  analysis_mode: z
    .enum(["quick", "detailed", "expert"])
    .optional()
    .describe(
      "分析模式，默认 quick。必须严格按以下关键词匹配，不要自行升级：quick='分析'/'看看'/'帮我分析'（默认）；detailed='详细分析'/'仔细看看'/'再详细分析下'；expert=仅当用户原话包含'专家模式'/'深度分析'/'全面分析'时才用。'详细'='detailed'，不是'expert'。不确定时选 quick。",
    ),
  path: z
    .string()
    .optional()
    .describe(
      "Optional local folder path containing both job_plan.json and job_profile.json. If provided, data is loaded from these local files instead of the API, and job_id is not required.",
    ),
})

const DESCRIPTION = [
  "Fetch a Lakehouse SQL job's execution plan and runtime profile for performance diagnosis and tuning.",
  "Use this when the user provides a job_id and asks to analyze a job/task's performance, find bottlenecks, or give optimization/tuning suggestions.",
  "Returns structured job plan and profile data.",
  "Examples:",
  "- Analyze job 2026012808001805432z9g3fx1sok.",
  "- 帮我分析下这个任务并给出调优建议。",
].join("\n")

// MCP 只在「中央 region」提供服务。按 cz-mcp-server 的 host→env 规则，把任意 service host
// 映射到其中央 region 的 API URL；else 分支回退到 host 自身（再按统一规则拼 MCP 后缀）。
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
 * 由 service URL 推导「中央 region」的 MCP endpoint：先把 host 映射到中央 region 的 API URL，
 * 再在 `api` 标签前插入 `-mcp`、路径设为 `/mcp`。
 */
export function serviceUrlToMcpUrl(serviceUrl: string): string {
  const host = normalizeHost(serviceUrl)
  if (host === VW_UAT_HOST) return `http://${VW_UAT_HOST}/mcp`
  const apiHost = normalizeHost(centralApiUrl(host))
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

const VW_UAT_HOST = "lakehouse-studio.uat.cn-vw.volkswagen-cea.com"

/** 取活跃连接：优先 CZ_* 环境变量，否则读 ~/.clickzetta/profiles.toml 的 CZ_PROFILE / default_profile。 */
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

/** 鉴权头：有 PAT 用 Bearer，否则透传 x-Lakehouse-* 凭证由远程 MCP 自行登录。 */
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

export function pruneUndefined(params: z.infer<typeof Parameters>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(params)) if (v !== undefined) out[k] = v
  return out
}

/** 经 Streamable-HTTP MCP（initialize + session 握手由 SDK 处理）调用远程工具，返回文本内容。 */
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
      execute: (params: z.infer<typeof Parameters>, ctx: Tool.Context) =>
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
