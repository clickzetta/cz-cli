/**
 * Direct Langfuse integration — sends complete LLM request/response to Langfuse
 * independently of OTEL. Activated when LANGFUSE_SECRET_KEY + LANGFUSE_PUBLIC_KEY are set.
 * Does nothing (no error) if not configured.
 */

let langfuseInstance: any | undefined
let enabled = false

export function isEnabled() {
  return enabled
}

export async function init() {
  const publicKey = process.env.LANGFUSE_PUBLIC_KEY
  const secretKey = process.env.LANGFUSE_SECRET_KEY
  if (!publicKey || !secretKey) return

  try {
    const { Langfuse } = await import("langfuse")
    langfuseInstance = new Langfuse({
      publicKey,
      secretKey,
      baseUrl: process.env.LANGFUSE_BASEURL || process.env.LANGFUSE_BASE_URL || "https://cloud.langfuse.com",
    })
    enabled = true
  } catch {}
}

export function traceGeneration(input: {
  sessionID: string
  model: string
  provider: string
  system: string[]
  messages: unknown[]
  tools?: Record<string, unknown>
  output?: { text?: string; toolCalls?: unknown[]; finishReason?: string }
  tokens?: { input?: number; output?: number; reasoning?: number; cache?: { read?: number; write?: number } }
  durationMs?: number
  error?: string
}) {
  if (!enabled || !langfuseInstance) return

  try {
    const trace = langfuseInstance.trace({
      name: `chat ${input.model}`,
      sessionId: input.sessionID,
      metadata: { provider: input.provider },
    })

    // Build OpenAI-style messages array with system prompt prepended
    const inputMessages: unknown[] = []
    if (input.system.length > 0) {
      inputMessages.push({ role: "system", content: input.system.join("\n\n") })
    }
    for (const msg of input.messages) {
      inputMessages.push(msg)
    }

    trace.generation({
      name: `chat ${input.model}`,
      model: input.model,
      input: inputMessages,
      output: input.output ?? input.error ?? undefined,
      modelParameters: {
        ...(input.tools ? { tools: Object.keys(input.tools) } : {}),
      },
      usage: input.tokens ? {
        input: (input.tokens.input ?? 0) + (input.tokens.cache?.read ?? 0),
        output: (input.tokens.output ?? 0) + (input.tokens.reasoning ?? 0),
        total: (input.tokens.input ?? 0) + (input.tokens.output ?? 0) + (input.tokens.reasoning ?? 0) + (input.tokens.cache?.read ?? 0),
      } : undefined,
      completionStartTime: input.durationMs ? new Date(Date.now() - input.durationMs) : undefined,
      endTime: new Date(),
      ...(input.error ? { level: "ERROR", statusMessage: input.error } : {}),
    })
  } catch {}
}

export async function flush() {
  if (!langfuseInstance) return
  try {
    await langfuseInstance.flushAsync()
  } catch {}
}
