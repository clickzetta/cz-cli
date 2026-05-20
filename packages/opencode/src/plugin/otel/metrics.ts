import { metrics } from "@opentelemetry/api"

const meter = metrics.getMeter("opencode")

// GenAI semantic conventions: https://opentelemetry.io/docs/specs/semconv/gen-ai/gen-ai-metrics/
export const tokenUsage = meter.createHistogram("gen_ai.client.token.usage", {
  description: "Measures number of input and output tokens used",
  unit: "{token}",
})

export const operationDuration = meter.createHistogram("gen_ai.client.operation.duration", {
  description: "GenAI operation duration",
  unit: "s",
})

export const sessionCounter = meter.createCounter("opencode.session.count", {
  description: "Number of sessions created",
  unit: "{session}",
})

export const toolCallCounter = meter.createCounter("opencode.tool.call.count", {
  description: "Number of tool calls",
  unit: "{call}",
})

export const toolCallDuration = meter.createHistogram("opencode.tool.call.duration", {
  description: "Tool call duration",
  unit: "s",
})

export const errorCounter = meter.createCounter("opencode.error.count", {
  description: "Number of errors by source",
  unit: "{error}",
})
