import { describe, expect, test } from "bun:test"
import { convertToOpenAIResponsesInput } from "../../../src/provider/sdk/copilot/responses/convert-to-openai-responses-input"

describe("convertToOpenAIResponsesInput", () => {
  test("sends provider-executed tool results when store is false", async () => {
    const result = await convertToOpenAIResponsesInput({
      prompt: [
        {
          role: "assistant",
          content: [
            {
              type: "tool-call",
              toolCallId: "call_jobperf",
              toolName: "analyze_lakehouse_job",
              input: { job_id: "2026012808001805432z9g3fx1sok" },
              providerExecuted: true,
            },
            {
              type: "tool-result",
              toolCallId: "call_jobperf",
              toolName: "analyze_lakehouse_job",
              output: { type: "text", value: "job profile summary" },
            },
          ],
        },
      ],
      systemMessageMode: "system",
      store: false,
    })

    expect(result.input).toContainEqual({
      type: "function_call_output",
      call_id: "call_jobperf",
      output: "job profile summary",
    })
    expect(result.warnings).toEqual([])
  })
})
