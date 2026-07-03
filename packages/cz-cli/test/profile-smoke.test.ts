import { expect, test } from "bun:test"
import { mkdtempSync, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { execute } from "../src/execute.ts"

function firstJson(output: string) {
  return JSON.parse(output.trim().split("\n")[0] ?? "{}") as Record<string, any>
}

test("profile commands do not emit success after PROFILE_NOT_FOUND", async () => {
  const previousHome = process.env.HOME
  const previousTestHome = process.env.CLICKZETTA_TEST_HOME
  const home = mkdtempSync(join(tmpdir(), "cz-profile-smoke-"))
  mkdirSync(join(home, ".clickzetta"), { recursive: true })
  process.env.HOME = home
  process.env.CLICKZETTA_TEST_HOME = home
  try {
    const detail = await execute("profile detail foo")
    const use = await execute("profile use foo")
    const remove = await execute("profile delete foo")
    const update = await execute("profile update foo workspace w2")

    expect(detail.exitCode).toBe(1)
    expect(firstJson(detail.output).error.code).toBe("PROFILE_NOT_FOUND")
    expect(detail.output).not.toContain("\"is_default\"")

    expect(use.exitCode).toBe(1)
    expect(firstJson(use.output).error.code).toBe("PROFILE_NOT_FOUND")
    expect(use.output).not.toContain("set as default")

    expect(remove.exitCode).toBe(1)
    expect(firstJson(remove.output).error.code).toBe("PROFILE_NOT_FOUND")
    expect(remove.output).not.toContain("deleted successfully")

    expect(update.exitCode).toBe(1)
    expect(firstJson(update.output).error.code).toBe("PROFILE_NOT_FOUND")
    expect(update.output).not.toContain("INTERNAL_ERROR")
  } finally {
    if (previousHome === undefined) delete process.env.HOME
    else process.env.HOME = previousHome
    if (previousTestHome === undefined) delete process.env.CLICKZETTA_TEST_HOME
    else process.env.CLICKZETTA_TEST_HOME = previousTestHome
    await Bun.$`rm -rf ${home}`
  }
})
