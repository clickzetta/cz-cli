import { describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { classifyCliArgs } from "../src/run-cli"

function withNoProfileHome(run: () => void) {
  const previous = process.env.CLICKZETTA_TEST_HOME
  const home = mkdtempSync(join(tmpdir(), "cz-no-profile-"))
  mkdirSync(join(home, ".clickzetta"), { recursive: true })
  process.env.CLICKZETTA_TEST_HOME = home
  try {
    run()
  } finally {
    if (previous === undefined) delete process.env.CLICKZETTA_TEST_HOME
    else process.env.CLICKZETTA_TEST_HOME = previous
    rmSync(home, { recursive: true, force: true })
  }
}

describe("job analyze profile gating", () => {
  test("does not require a ClickZetta profile when analyzing a local profile path", () => {
    withNoProfileHome(() => {
      expect(classifyCliArgs(["job", "analyze", "--path", "/tmp/job-profile"]).requiresProfile).toBe(false)
    })
  })

  test("still requires a ClickZetta profile when analyzing by job id", () => {
    withNoProfileHome(() => {
      expect(classifyCliArgs(["job", "analyze", "202606081115127730367220"]).requiresProfile).toBe(true)
    })
  })
})
