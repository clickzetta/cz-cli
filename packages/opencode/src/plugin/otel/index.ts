import type { Plugin } from "@opencode-ai/plugin"
import { OTEL_DEFAULTS } from "../otel-defaults"
import { initOtelSdk, type OtelSdk } from "./setup"
import { handleEvent, shutdown as shutdownHandlers } from "./handlers"
import { getCurrentSessionTraceparent } from "./context"
import { createTraceparent } from "@clickzetta/sdk"
import { InstallationVersion } from "@/installation/version"
import { Flag } from "@/flag/flag"

function parseHeaders(raw?: string): Record<string, string> {
  if (!raw) return {}
  const result: Record<string, string> = {}
  for (const part of raw.split(",")) {
    const eqIdx = part.indexOf("=")
    if (eqIdx > 0) result[part.slice(0, eqIdx).trim()] = part.slice(eqIdx + 1).trim()
  }
  return result
}

export const OtelPlugin: Plugin = Object.assign(
  async () => {
    const endpoint = process.env.OPENCODE_OTLP_ENDPOINT ?? OTEL_DEFAULTS.endpoint
    const headers = parseHeaders(process.env.OPENCODE_OTLP_HEADERS ?? OTEL_DEFAULTS.headers)

    const resourceAttrs: Record<string, string> = {
      "service.name": "opencode",
      "service.version": InstallationVersion,
      "opencode.client": Flag.CLICKZETTA_CLIENT ?? "unknown",
    }
    if (process.env.OPENCODE_RESOURCE_ATTRIBUTES) {
      for (const pair of process.env.OPENCODE_RESOURCE_ATTRIBUTES.split(",")) {
        const eqIdx = pair.indexOf("=")
        if (eqIdx > 0) resourceAttrs[pair.slice(0, eqIdx)] = pair.slice(eqIdx + 1)
      }
    }

    let sdk: OtelSdk | undefined
    try {
      sdk = await initOtelSdk(endpoint, headers, resourceAttrs)
    } catch {}

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
