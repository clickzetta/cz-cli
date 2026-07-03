import { describe, expect, test, beforeAll, afterAll } from "bun:test"
import { ClickzettaSkillFilterPlugin } from "../../src/clickzetta/plugin/skill-filter"
import { markClickzettaRuntime } from "../../src/clickzetta/runtime"

const hadRuntime = process.env.CLICKZETTA_RUNTIME
beforeAll(() => markClickzettaRuntime())
afterAll(() => {
  if (hadRuntime === undefined) delete process.env.CLICKZETTA_RUNTIME
  else process.env.CLICKZETTA_RUNTIME = hadRuntime
})

async function skillExcluded(name: string): Promise<boolean> {
  const hooks = await ClickzettaSkillFilterPlugin({} as any)
  const output = { exclude: false }
  await hooks["skill.filter"]!({ name }, output)
  return output.exclude
}

describe("clickzetta skill.filter plugin", () => {
  test("excludes the cz-cli skill (prevents recursive shell-out)", async () => {
    expect(await skillExcluded("cz-cli")).toBe(true)
  })
})
