import { describe, expect, test } from "bun:test"
import {
  AI_GATEWAY_API_KEY_QUOTA_MESSAGE,
  AI_GATEWAY_QUOTA_CONFIGURE_MODEL_LABEL,
  AI_GATEWAY_QUOTA_MESSAGE,
  AI_GATEWAY_QUOTA_QUOTA_UPDATED_LABEL,
  clickzettaQuotaModelQuestions,
  clickzettaQuotaProviderQuestion,
  clickzettaQuotaRecoveryQuestion,
  isClickzettaAiGatewayApiKeyQuotaExhausted,
  isClickzettaAiGatewayQuotaExhausted,
} from "../../src/config/llm-quota-recovery"

describe("llm quota recovery", () => {
  test("recognizes free ClickZetta virtual key quota failures", () => {
    expect(
      isClickzettaAiGatewayQuotaExhausted({
        providerType: "clickzetta",
        statusCode: 429,
        message:
          "LLM request failed: Too Many Requests: Virtual key total quota exceeded: limit is 10000000 tokens for virtual key 'cz-code_auto_pdiaxzjq', current usage: 10082801 tokens",
      }),
    ).toBe(true)
  })

  test("does not treat non-free ClickZetta virtual key quota failures as free quota", () => {
    expect(
      isClickzettaAiGatewayQuotaExhausted({
        providerType: "clickzetta",
        statusCode: 429,
        message:
          "LLM request failed: Too Many Requests: Virtual key total quota exceeded: limit is 10000000 tokens for virtual key 'cz-cli_auto_UAT_TEST', current usage: 10082801 tokens",
      }),
    ).toBe(false)
  })

  test("recognizes non-free ClickZetta virtual key quota failures as API key quota", () => {
    expect(
      isClickzettaAiGatewayApiKeyQuotaExhausted({
        providerType: "clickzetta",
        statusCode: 429,
        message:
          "LLM request failed: Too Many Requests: Virtual key total quota exceeded: limit is 10000000 tokens for virtual key 'cz-cli_user_alice', current usage: 10082801 tokens",
      }),
    ).toBe(true)
  })

  test("does not treat generic ClickZetta quota failures without a free key as free quota", () => {
    expect(
      isClickzettaAiGatewayQuotaExhausted({
        providerType: "clickzetta",
        statusCode: 429,
        message: "LLM request failed: Too Many Requests: quota exceeded",
      }),
    ).toBe(false)
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
      "Your complimentary token quota has been exhausted.\nWe also offer competitively priced paid token plans, and I'd be happy to help you create and configure a paid API key.",
    )
    expect(AI_GATEWAY_API_KEY_QUOTA_MESSAGE).toBe(
      "The current API key has run out of quota.\nPlease go to https://aitoken.clickzetta.com/apikey to add quota, or configure another token service source.",
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
