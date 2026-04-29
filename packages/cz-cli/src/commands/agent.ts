import type { Argv } from "yargs"
import { agentHealth, createConversation, chat, getToken, toServiceUrl } from "@clickzetta/sdk"
import type { GlobalArgs } from "../cli.js"
import { success, error } from "../output/index.js"
import { logOperation } from "../logger.js"
import { resolveConnectionConfig } from "../connection/config.js"

export function registerAgentCommand(cli: Argv<GlobalArgs>): void {
  cli.command("agent", "AI Agent commands", (yargs) =>
    yargs
      .command(
        "status",
        "Check AI Agent health",
        (y) => y.option("agent-url", { type: "string", describe: "Agent base URL" }),
        async (argv) => {
          const format = argv.output
          try {
            const url = argv["agent-url"] ?? resolveAgentUrl(argv)
            const healthy = await agentHealth(url)
            logOperation("agent status", { ok: true })
            success({ healthy, url }, { format })
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
            .option("token", { type: "string", describe: "JWT token override" }),
        async (argv) => {
          const format = argv.output
          try {
            const url = argv["agent-url"] ?? resolveAgentUrl(argv)
            const config = resolveConnectionConfig(argv)
            const authToken = argv.token ? undefined : await getToken(config)
            const token = (argv.token as string | undefined) ?? authToken!.token
            let conversationId = argv["conversation-id"] as string | undefined
            if (!conversationId) {
              conversationId = await createConversation(url, token, {
                userId: authToken!.userId,
                instanceId: authToken!.instanceId,
              })
            }
            const answer = await chat(url, token, conversationId, argv.question as string)
            logOperation("agent ask", { ok: true })
            success({ question: argv.question, answer, conversation_id: conversationId }, { format })
          } catch (err) {
            error("AGENT_ERROR", err instanceof Error ? err.message : String(err), { format })
          }
        },
      )
      .demandCommand(1, ""),
  )
}

function resolveAgentUrl(argv: Record<string, unknown>): string {
  try {
    const config = resolveConnectionConfig(argv as Record<string, string>)
    const baseUrl = toServiceUrl(config.service, config.protocol)
    return baseUrl
  } catch {
    return "https://dev-api.clickzetta.com"
  }
}
