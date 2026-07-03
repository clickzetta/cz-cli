import { describe, expect, test, beforeAll, afterAll } from "bun:test"
import PROMPT_CZ_CLI_INNER from "../../src/session/prompt/cz-cli-inner.txt"
import { ClickzettaSystemPromptPlugin } from "../../src/clickzetta/plugin/system-prompt"
import { markClickzettaRuntime } from "../../src/clickzetta/runtime"

// cz plugins only inject when the cz runtime is marked. Scope the marker to this
// file's tests so it doesn't leak into other test files in the same bun process
// (e.g. recorded-fixture tests that expect the unmodified upstream prompt).
const hadRuntime = process.env.CLICKZETTA_RUNTIME
beforeAll(() => markClickzettaRuntime())
afterAll(() => {
  if (hadRuntime === undefined) delete process.env.CLICKZETTA_RUNTIME
  else process.env.CLICKZETTA_RUNTIME = hadRuntime
})

// The inner prompt is injected through the real `experimental.chat.system.transform`
// hook (not a hard-coded upstream return). This pins the contract main relied on:
// the assembled system array must carry the ClickZetta inner prompt.

const model = { providerID: "clickzetta", api: { id: "qwen" } } as any

async function transform(system: string[]) {
  const hooks = await ClickzettaSystemPromptPlugin({} as any)
  await hooks["experimental.chat.system.transform"]!({ model }, { system })
  return system
}

describe("clickzetta system-prompt plugin", () => {
  test("appends the cz-cli inner prompt to the system array", async () => {
    const system = await transform(["BASE PROMPT"])
    expect(system[0]).toBe("BASE PROMPT")
    expect(system).toContain(PROMPT_CZ_CLI_INNER)
    expect(system.join("\n")).toContain("cz-cli")
  })

  test("preserves existing system entries (additive, two-element shape)", async () => {
    const system = await transform(["A", "B"])
    expect(system.slice(0, 2)).toEqual(["A", "B"])
    expect(system[system.length - 1]).toBe(PROMPT_CZ_CLI_INNER)
  })

  test("is idempotent — does not double-inject", async () => {
    const system = ["BASE"]
    await transform(system)
    await transform(system)
    const count = system.filter((s) => s === PROMPT_CZ_CLI_INNER).length
    expect(count).toBe(1)
  })
})
