import type { Hooks, PluginInput } from "@opencode-ai/plugin"
import { isClickzettaGatewayUrl } from "@/provider/clickzetta"
import { currentTraceparent } from "@/util/traceparent"
import { isClickzettaRuntime } from "../runtime"

/**
 * Injects a W3C `traceparent` header into LLM requests bound for the ClickZetta
 * gateway, via the `chat.headers` hook (headers returned here merge into the
 * request). The gateway is recognized by the provider's baseURL. Gated on the cz
 * runtime marker, so it injects nothing outside the cz agent.
 */
export async function ClickzettaOutboundHeadersPlugin(_input: PluginInput): Promise<Hooks> {
  return {
    "chat.headers": async (input, output) => {
      if (!isClickzettaRuntime()) return
      const baseURL = typeof input.provider?.options?.["baseURL"] === "string" ? input.provider.options["baseURL"] : undefined
      if (!isClickzettaGatewayUrl(baseURL)) return
      output.headers["traceparent"] = currentTraceparent()
    },
  }
}
