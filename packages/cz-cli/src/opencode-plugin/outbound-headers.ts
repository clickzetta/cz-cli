import type { Hooks, Plugin, PluginInput } from "@opencode-ai/plugin"
import { isClickzettaGatewayUrl } from "../llm/clickzetta-provider.js"
import { currentTraceparent } from "./traceparent.js"

export const ClickzettaOutboundHeadersPlugin: Plugin = async (_input: PluginInput): Promise<Hooks> => ({
  "chat.headers": async (input, output) => {
    const baseURL = typeof input.provider?.options?.["baseURL"] === "string" ? input.provider.options["baseURL"] : undefined
    if (!isClickzettaGatewayUrl(baseURL)) return
    output.headers.traceparent = currentTraceparent()
  },
})
