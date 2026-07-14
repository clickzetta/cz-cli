import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { disableUpstreamAutoupdate } from "../src/bootstrap/upstream-autoupdate"

describe("disableUpstreamAutoupdate", () => {
  let saved: string | undefined

  beforeEach(() => {
    saved = process.env.OPENCODE_DISABLE_AUTOUPDATE
  })

  afterEach(() => {
    if (saved === undefined) delete process.env.OPENCODE_DISABLE_AUTOUPDATE
    else process.env.OPENCODE_DISABLE_AUTOUPDATE = saved
  })

  test("forces the flag on when unset", () => {
    delete process.env.OPENCODE_DISABLE_AUTOUPDATE
    disableUpstreamAutoupdate()
    expect(process.env.OPENCODE_DISABLE_AUTOUPDATE).toBe("1")
  })

  test("overrides an explicit re-enable value (hard force, no opt-out)", () => {
    process.env.OPENCODE_DISABLE_AUTOUPDATE = "0"
    disableUpstreamAutoupdate()
    expect(process.env.OPENCODE_DISABLE_AUTOUPDATE).toBe("1")
  })

  test("overrides a stray falsy value from the environment", () => {
    process.env.OPENCODE_DISABLE_AUTOUPDATE = "false"
    disableUpstreamAutoupdate()
    expect(process.env.OPENCODE_DISABLE_AUTOUPDATE).toBe("1")
  })

  test("is idempotent", () => {
    delete process.env.OPENCODE_DISABLE_AUTOUPDATE
    disableUpstreamAutoupdate()
    disableUpstreamAutoupdate()
    expect(process.env.OPENCODE_DISABLE_AUTOUPDATE).toBe("1")
  })
})
