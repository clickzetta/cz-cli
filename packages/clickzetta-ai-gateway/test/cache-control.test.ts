import { describe, expect, test } from "bun:test"
import { applyClickzettaPromptCaching } from "../src/index"

describe("applyClickzettaPromptCaching", () => {
  test("adds ephemeral cache_control to the system message for cache-eligible models", () => {
    const prompt = [
      { role: "system", content: "BASE PROMPT" },
      { role: "user", content: [{ type: "text", text: "hi" }] },
    ] as any
    const output = applyClickzettaPromptCaching(prompt, "qwen/qwen3.6-plus") as any[]
    expect(output[0].content[0]).toEqual({
      type: "text",
      text: "BASE PROMPT",
      cache_control: { type: "ephemeral" },
    })
  })

  test("leaves non-cache models unchanged", () => {
    const prompt = [{ role: "system", content: "BASE" }] as any
    expect(applyClickzettaPromptCaching(prompt, "qwen/other")).toBe(prompt)
  })
})
