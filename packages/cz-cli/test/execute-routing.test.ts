import { describe, expect, test } from "bun:test"
import { execute } from "../src/execute.ts"

function firstJson(output: string) {
  return JSON.parse(output.trim().split("\n")[0] ?? "{}") as Record<string, any>
}

describe("execute() routing", () => {
  test("returns the same no-profile payload shape as the CLI for data commands", async () => {
    const previousHome = process.env.HOME
    const previousTestHome = process.env.CLICKZETTA_TEST_HOME
    const home = await Bun.$`mktemp -d`.text()
    process.env.HOME = home.trim()
    process.env.CLICKZETTA_TEST_HOME = home.trim()
    try {
      const result = await execute("status")
      const json = firstJson(result.output)
      expect(result.exitCode).toBe(1)
      expect(json.error.code).toBe("NO_PROFILE")
      expect(json.error.next_step).toBe("cz-cli setup")
      expect(Array.isArray(json.error.next_steps)).toBe(true)
    } finally {
      if (previousHome === undefined) delete process.env.HOME
      else process.env.HOME = previousHome
      if (previousTestHome === undefined) delete process.env.CLICKZETTA_TEST_HOME
      else process.env.CLICKZETTA_TEST_HOME = previousTestHome
      await Bun.$`rm -rf ${home.trim()}`
    }
  })

  test("rejects agent runtime commands so callers use the real cz-cli binary", async () => {
    const result = await execute("llm test")
    const json = firstJson(result.output)
    expect(result.exitCode).toBe(1)
    expect(json.error.code).toBe("UNSUPPORTED_PROGRAMMATIC_AGENT_RUNTIME")
  })

  test("rejects serve so callers use the real cz-cli binary", async () => {
    const result = await execute("serve --help")
    const json = firstJson(result.output)
    expect(result.exitCode).toBe(1)
    expect(json.error.code).toBe("UNSUPPORTED_PROGRAMMATIC_AGENT_RUNTIME")
  })
})
