import type { Argv } from "yargs"
import { agentHealth, createConversation, chat, toServiceUrl, type AgentIdentity } from "@clickzetta/sdk"
import type { GlobalArgs } from "../cli.js"
import { success, error } from "../output/index.js"
import { logOperation } from "../logger.js"
import { resolveConnectionConfig } from "../connection/config.js"
import { getStudioContext } from "./studio-context.js"
import { readAgentEndpoint } from "../connection/profile-store.js"

export function registerAgentCommand(cli: Argv<GlobalArgs>): void {
  cli.command("agent", "AI Agent commands", (yargs) =>
    yargs
      .command(
        "status",
        "Check AI Agent health",
        (y) =>
          y
            .option("agent-url", { type: "string", describe: "Agent base URL" })
            .option("token", { type: "string", describe: "Override auth token" }),
        async (argv) => {
          const format = argv.output
          try {
            const url = argv["agent-url"] ?? resolveAgentUrl(argv)
            const result = await agentHealth(url)
            logOperation("agent status", { ok: true })
            if (result === false) {
              error("AGENT_UNREACHABLE", `Cannot connect to agent at ${url}`, { format })
            }
            success({ healthy: true, url, ...(typeof result === "object" ? result : {}) }, { format })
          } catch (err) {
            error("AGENT_ERROR", err instanceof Error ? err.message : String(err), { format })
          }
        },
      )
      .command(
        "ask <question>",
        "Send question to AI Agent",
        (y) =>
          y
            .positional("question", { type: "string", demandOption: true })
            .option("conversation-id", { alias: "c", type: "string", describe: "Reuse conversation" })
            .option("agent-url", { type: "string", describe: "Agent base URL" })
            .option("token", { type: "string", describe: "Override auth token" })
            .option("session", { type: "string", describe: "Session ID for multi-turn" }),
        async (argv) => {
          const format = argv.output
          try {
            const url = argv["agent-url"] ?? resolveAgentUrl(argv)
            const sc = await getStudioContext(argv)
            const identity: AgentIdentity = {
              user_id: String(sc.userId),
              tenant_id: String(sc.tenantId),
              instance_id: String(sc.instanceId),
              token: sc.token,
              instance_name: sc.instanceName,
              workspace: sc.workspaceName,
              workspace_id: String(sc.workspaceId),
              schema_name: (argv as Record<string, unknown>).schema as string | undefined,
            }
            let conversationId = argv["conversation-id"] as string | undefined
            if (!conversationId) {
              conversationId = await createConversation(url, sc.token, identity)
            }
            const answer = await chat(url, sc.token, conversationId, argv.question as string, identity)
            logOperation("agent ask", { ok: true })
            success({ question: argv.question, answer, conversation_id: conversationId }, { format })
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err)
            if (msg.includes("504") || msg.includes("timeout")) {
              error("AGENT_TIMEOUT", "Agent did not respond in time (timeout)", { format })
            }
            error("AGENT_ERROR", msg, { format })
          }
        },
      )
      .demandCommand(1, ""),
  )
}

function resolveAgentUrl(argv: Record<string, unknown>): string {
  // 1. Check profile [agent] endpoint override
  const profileOverride = readAgentEndpoint(argv.profile as string | undefined)
  if (profileOverride) return profileOverride

  // 2. Auto-derive from service
  try {
    const config = resolveConnectionConfig(argv as Record<string, string>)
    return toServiceUrl(config.service, config.protocol)
  } catch {
    return "https://dev-api.clickzetta.com"
  }
}
