import type { Plugin } from "@opencode-ai/plugin"
import type { Event } from "@opencode-ai/sdk"
import { initOtelSdk, type OtelSdk } from "./setup"
import {
  handleEvent,
  initHandlers,
  recordInputMessages,
  recordSystemInstructions,
  shutdown as shutdownHandlers,
} from "./handlers"
import { getSessionTraceparent } from "./context"
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
      // End the spans still open before the SDK stops accepting them: without this the
      // turn, step and tool spans live at exit are dropped rather than exported late.
      // One-shot: `flush` now wipes handler state as well as stopping the SDK, and
      // `beforeExit` can fire more than once because this handler itself schedules async
      // work. A second run would leave spans being created against a shut-down SDK and
      // silently dropped.
      let flushed: Promise<void> | undefined
      const flush = () => {
        if (flushed) return flushed
        try {
          shutdownHandlers()
        } catch {}
        flushed = sdk!.shutdown().catch(() => {})
        return flushed
      }
      globalFlush = flush
      ;(globalThis as any).__otelFlush = flush
      process.on("beforeExit", flush)
      process.on("SIGTERM", () => flush().finally(() => process.exit(0)))
      process.on("SIGINT", () => flush().finally(() => process.exit(130)))
    }

    return {
      // Typed from the published union rather than widened to `{ type: string }`, which is
      // what allowed a subscription to a nonexistent event name to compile.
      async event({ event }: { event: Event }) {
        handleEvent(event)
      },
      // The prompt as it is about to be sent. Both hooks fire per step, before the LLM
      // call, so the `chat` span can carry the content from the moment it opens. This is
      // the channel the pre-rebaseline handler got from an upstream patch on llm.ts; these
      // hooks make it a cz-layer read instead.
      async "experimental.chat.messages.transform"(
        _input: unknown,
        output: { messages: Array<{ info?: Record<string, any>; parts?: Record<string, any>[] }> },
      ) {
        recordInputMessages(output?.messages ?? [])
      },
      async "experimental.chat.system.transform"(
        input: { sessionID?: string; model?: unknown },
        output: { system: string[] },
      ) {
        recordSystemInstructions(input?.sessionID, output?.system ?? [])
      },
      async "shell.env"(
        input: { cwd: string; sessionID?: string; callID?: string },
        output: { env: Record<string, string> },
      ) {
        // The shell and task tools both supply sessionID; only the pty paths omit it.
        const sessionTp = getSessionTraceparent(input?.sessionID)
        if (sessionTp) output.env.CLICKZETTA_TRACEPARENT = createTraceparent(sessionTp)
      },
    }
  },
  { pluginName: "otel" },
)
