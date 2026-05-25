import { describe, expect, test } from "bun:test"
import {
  findDialogSelectOptionIndex,
  isDialogSelectOptionActive,
  isDialogSelectOptionCurrent,
  resolveDialogSelectOptionKey,
} from "../../../../src/cli/cmd/tui/ui/dialog-select-identity"

describe("dialog select identity", () => {
  const options = [
    {
      key: "llm:clickzetta:clickzetta:deepseek/deepseek-v4-pro",
      value: { providerID: "clickzetta", modelID: "deepseek/deepseek-v4-pro" },
    },
    {
      key: "llm:clickzetta-all:clickzetta:deepseek/deepseek-v4-pro",
      value: { providerID: "clickzetta", modelID: "deepseek/deepseek-v4-pro" },
    },
    {
      key: "llm:test001:clickzetta:qwen/qwen3.5-plus",
      value: { providerID: "clickzetta", modelID: "qwen/qwen3.5-plus" },
    },
  ]

  test("prefers the explicit option key when duplicate values exist", () => {
    expect(
      findDialogSelectOptionIndex(options, {
        current: { providerID: "clickzetta", modelID: "deepseek/deepseek-v4-pro" },
        currentKey: "llm:clickzetta-all:clickzetta:deepseek/deepseek-v4-pro",
      }),
    ).toBe(1)
  })

  test("falls back to provider/model equality when there is no current key", () => {
    expect(
      findDialogSelectOptionIndex(options, {
        current: { providerID: "clickzetta", modelID: "qwen/qwen3.5-plus" },
      }),
    ).toBe(2)
  })

  test("marks only the keyed duplicate as current", () => {
    expect(
      isDialogSelectOptionCurrent(options[0], {
        current: { providerID: "clickzetta", modelID: "deepseek/deepseek-v4-pro" },
        currentKey: "llm:clickzetta-all:clickzetta:deepseek/deepseek-v4-pro",
      }),
    ).toBe(false)
    expect(
      isDialogSelectOptionCurrent(options[1], {
        current: { providerID: "clickzetta", modelID: "deepseek/deepseek-v4-pro" },
        currentKey: "llm:clickzetta-all:clickzetta:deepseek/deepseek-v4-pro",
      }),
    ).toBe(true)
  })

  test("uses the provided key before serializing the value", () => {
    expect(resolveDialogSelectOptionKey(options[1])).toBe("llm:clickzetta-all:clickzetta:deepseek/deepseek-v4-pro")
  })

  test("keeps duplicate values from sharing the active state", () => {
    expect(
      isDialogSelectOptionActive(options[0], {
        key: options[1].key,
        value: options[1].value,
      }),
    ).toBe(false)
    expect(
      isDialogSelectOptionActive(options[1], {
        key: options[1].key,
        value: options[1].value,
      }),
    ).toBe(true)
  })
})
