import { metrics } from "@opentelemetry/api"

const meter = metrics.getMeter("opencode")

export const sessionCounter = meter.createCounter("session.count", { description: "Number of sessions created" })
export const messageCounter = meter.createCounter("message.count", { description: "Number of messages sent" })
export const tokenUsage = meter.createCounter("token.usage", { description: "Token usage by type" })
export const toolCallCounter = meter.createCounter("tool.call.count", { description: "Number of tool calls" })
export const toolCallDuration = meter.createHistogram("tool.call.duration_ms", {
  description: "Tool call duration in ms",
})
export const llmCallDuration = meter.createHistogram("llm.call.duration_ms", { description: "LLM call duration in ms" })
export const errorCounter = meter.createCounter("error.count", { description: "Number of errors" })
