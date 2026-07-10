import type { Plugin } from "@opencode-ai/plugin"
import { initOtelSdk, type OtelSdk } from "./setup"
import { handleEvent, initHandlers, shutdown as shutdownHandlers } from "./handlers"
import { getCurrentSessionTraceparent } from "./context"
import { createTraceparent } from "./traceparent"
import { InstallationVersion } from "@opencode-ai/core/installation/version"
import { Flag } from "@opencode-ai/core/flag/flag"

function parseHeaders(raw?: string): Record<string, string> {
  if (!raw) return {}
  const result: Record<string, string> = {}
  for (const part of raw.split(",")) {
    const eqIdx = part.indexOf("=")
    if (eqIdx > 0) result[part.slice(0, eqIdx).trim()] = part.slice(eqIdx + 1).trim()
  }
  return result
}

let globalFlush: (() => Promise<void>) | undefined

export async function flushOtel(): Promise<void> {
  const fn = (globalThis as any).__otelFlush as (() => Promise<void>) | undefined
  if (fn) await fn()
  else if (globalFlush) await globalFlush()
}

export const OtelPlugin: Plugin = Object.assign(
  async () => {
    const endpoint = process.env.OPENCODE_OTLP_ENDPOINT
    const headers = parseHeaders(process.env.OPENCODE_OTLP_HEADERS)

    const resourceAttrs: Record<string, string> = {
      "service.name": process.env.OPENCODE_SERVICE_NAME || "opencode",
      "service.version": InstallationVersion,
      "opencode.client": Flag.OPENCODE_CLIENT ?? "unknown",
    }
    if (process.env.OPENCODE_RESOURCE_ATTRIBUTES) {
      for (const pair of process.env.OPENCODE_RESOURCE_ATTRIBUTES.split(",")) {
        const eqIdx = pair.indexOf("=")
        if (eqIdx > 0) resourceAttrs[pair.slice(0, eqIdx)] = pair.slice(eqIdx + 1)
      }
    }

    let sdk: OtelSdk | undefined
    if (endpoint) {
      try {
        sdk = await initOtelSdk(endpoint, headers, resourceAttrs)
      } catch {}
    }

    if (sdk) {
      initHandlers(sdk.logger, process.env.OPENCODE_OTEL_RECORD_CONTENT !== "0")
      const flush = () => sdk!.shutdown().catch(() => {})
      globalFlush = flush
      ;(globalThis as any).__otelFlush = flush
      process.on("beforeExit", flush)
      process.on("SIGTERM", () => flush().finally(() => process.exit(0)))
      process.on("SIGINT", () => flush().finally(() => process.exit(130)))
    }

    return {
      async event({ event }: { event: { type: string; properties: Record<string, any> } }) {
        handleEvent(event)
      },
      async "shell.env"(_input: unknown, output: { env: Record<string, string> }) {
        const sessionTp = getCurrentSessionTraceparent()
        if (sessionTp) output.env.CLICKZETTA_TRACEPARENT = createTraceparent(sessionTp)
      },
    }
  },
  { pluginName: "otel" },
)
