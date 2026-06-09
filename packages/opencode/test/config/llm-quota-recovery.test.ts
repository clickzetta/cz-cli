import { describe, expect, test } from "bun:test"
import {
  AI_GATEWAY_QUOTA_CONFIGURE_MODEL_LABEL,
  AI_GATEWAY_QUOTA_MESSAGE,
  AI_GATEWAY_QUOTA_QUOTA_UPDATED_LABEL,
  clickzettaQuotaModelQuestions,
  clickzettaQuotaProviderQuestion,
  clickzettaQuotaRecoveryQuestion,
  isClickzettaAiGatewayQuotaExhausted,
} from "../../src/config/llm-quota-recovery"

describe("llm quota recovery", () => {
  test("recognizes screenshot weekly quota failures for ClickZetta", () => {
    expect(
      isClickzettaAiGatewayQuotaExhausted({
        providerType: "clickzetta",
        statusCode: 429,
        message:
          "LLM request failed: Too Many Requests: Virtual key weekly quota exceeded: limit is 10000000 tokens for virtual key 'default', current usage: 10003377 tokens",
      }),
    ).toBe(true)
  })

  test("recognizes generic ClickZetta quota exceeded failures", () => {
    expect(
      isClickzettaAiGatewayQuotaExhausted({
        providerType: "clickzetta",
        statusCode: 429,
        message: "LLM request failed: Too Many Requests: quota exceeded",
      }),
    ).toBe(true)
  })

  test("does not trigger for non-ClickZetta quota failures", () => {
    expect(
      isClickzettaAiGatewayQuotaExhausted({
        providerType: "openai",
        statusCode: 429,
        message: "LLM request failed: quota exceeded",
      }),
    ).toBe(false)
  })

  test("keeps the user-facing recovery copy and labels in English", () => {
    expect(AI_GATEWAY_QUOTA_MESSAGE).toBe(
      "The current AI Gateway key quota has been exhausted. Configure more quota at xxx.",
    )
    expect(AI_GATEWAY_QUOTA_CONFIGURE_MODEL_LABEL).toBe("Configure my own model")
    expect(AI_GATEWAY_QUOTA_QUOTA_UPDATED_LABEL).toBe("I've updated the quota")
  })

  test("builds QuestionPrompt-compatible recovery question", () => {
    expect(clickzettaQuotaRecoveryQuestion()).toMatchObject({
      header: "Quota",
      question: AI_GATEWAY_QUOTA_MESSAGE,
      custom: false,
      options: [
        { label: AI_GATEWAY_QUOTA_CONFIGURE_MODEL_LABEL },
        {
          label: AI_GATEWAY_QUOTA_QUOTA_UPDATED_LABEL,
          description: "Close this prompt after updating quota, then send your request again.",
        },
      ],
    })
  })

  test("provider question lists all supported providers", () => {
    const q = clickzettaQuotaProviderQuestion()
    expect(q.header).toBe("Provider")
    expect(q.options.map((o) => o.label)).toEqual([
      "clickzetta",
      "openai-compatible",
      "openai",
      "anthropic",
      "google",
      "openrouter",
      "azure",
    ])
  })

  test("clickzetta model questions skip model step", () => {
    const questions = clickzettaQuotaModelQuestions("clickzetta")
    expect(questions.map((q) => q.header)).toEqual(["Base URL", "API Key", "Name"])
    expect(questions[0]?.options[0]?.label).toBe("https://cn-shanghai-alicloud-aimesh.api.clickzetta.com/gateway/v1")
  })

  test("openai model questions include model step with suggestions", () => {
    const questions = clickzettaQuotaModelQuestions("openai")
    expect(questions.map((q) => q.header)).toEqual(["Model", "Base URL", "API Key", "Name"])
    expect(questions[0]?.options.length).toBeGreaterThan(0)
  })

  test("anthropic model questions include model step with suggestions", () => {
    const questions = clickzettaQuotaModelQuestions("anthropic")
    expect(questions.map((q) => q.header)).toEqual(["Model", "Base URL", "API Key", "Name"])
    expect(questions[0]?.options.map((o) => o.label)).toContain("claude-sonnet-4-6")
  })

  test("unknown provider falls back to model + baseURL + apiKey", () => {
    const questions = clickzettaQuotaModelQuestions("some-custom-provider")
    expect(questions.map((q) => q.header)).toEqual(["Model", "Base URL", "API Key", "Name"])
  })
})

