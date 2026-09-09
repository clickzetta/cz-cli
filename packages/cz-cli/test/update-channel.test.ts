import { describe, expect, test } from "bun:test"
import { resolveUpdateAction, shouldSkipAutoUpdateCommand } from "../src/bootstrap/update"
import { describeStableAlternative, shouldApplyUpdate } from "../src/commands/update"
import { channelForVersion } from "../src/bootstrap/release-version"

const NIGHTLY = "dev-v2.0.4.20260901105751"
const baseAction = {
  channel: "stable",
  now: 1_000_000,
  intervalMs: 1_000,
  method: "curl" as const,
}

describe("auto-update never touches an unpublished build", () => {
  test("skips a worktree build stamped 0.0.0-<branch>-<ts>", () => {
    expect(shouldSkipAutoUpdateCommand({ args: ["sql"], env: {}, version: "0.0.0-main-202609081234" })).toBe(true)
  })

  test("skips the `bun run` fallback version", () => {
    expect(shouldSkipAutoUpdateCommand({ args: ["sql"], env: {}, version: "0.0.0-dev+202609081234" })).toBe(true)
  })

  test("still runs for a published nightly", () => {
    expect(shouldSkipAutoUpdateCommand({ args: ["sql"], env: {}, version: NIGHTLY })).toBe(false)
  })

  test("still runs for a published stable", () => {
    expect(shouldSkipAutoUpdateCommand({ args: ["sql"], env: {}, version: "2.0.4" })).toBe(false)
  })

  test("resolveUpdateAction reports the local-build skip explicitly", () => {
    expect(
      resolveUpdateAction({ ...baseAction, currentVersion: "0.0.0-main-202609081234", latestVersion: "2.0.4" }),
    ).toEqual({ kind: "skip", reason: "local-build" })
  })

  test("a published build with a newer latest still upgrades", () => {
    expect(resolveUpdateAction({ ...baseAction, currentVersion: "2.0.0", latestVersion: "2.0.4" })).toEqual({
      kind: "upgrade",
      reason: "managed-install",
    })
  })
})

describe("shouldApplyUpdate", () => {
  test("an explicit channel switch authorizes a cross-stream move", () => {
    // `switchingChannel` is passed through the same `force` parameter as --target.
    expect(shouldApplyUpdate("dev-v2.1.0.20260901105751", "2.0.4", true)).toBe(true)
    expect(shouldApplyUpdate("dev-v2.1.0.20260901105751", "2.0.4", false)).toBe(false)
  })
})

describe("a crossed install is a pending switch, not a downgrade", () => {
  // What `pendingChannelSwitch` detects: the stored channel and the installed
  // binary's own channel disagree, so the move to the stored channel's latest
  // must be allowed even when semver calls it a step back.
  test("a stable binary pinned to nightly is detected as crossed", () => {
    expect(channelForVersion("2.0.4")).not.toBe("nightly")
    // Same base: switching stable -> nightly is a semver downgrade...
    expect(shouldApplyUpdate("2.0.4", NIGHTLY, false)).toBe(false)
    // ...but authorized once the crossing is recognized.
    expect(shouldApplyUpdate("2.0.4", NIGHTLY, true)).toBe(true)
  })

  test("an aligned install is not treated as crossed", () => {
    expect(channelForVersion(NIGHTLY)).toBe("nightly")
    expect(channelForVersion("2.0.4")).toBe("stable")
  })
})

describe("describeStableAlternative", () => {
  test("surfaces stable when a stalled nightly is reported as current", () => {
    expect(describeStableAlternative(NIGHTLY, "2.1.0")).toContain("stable channel is at 2.1.0")
    expect(describeStableAlternative(NIGHTLY, "2.1.0")).toContain("cz-cli update --channel stable")
  })

  test("stays quiet when stable is not ahead", () => {
    expect(describeStableAlternative("dev-v2.2.0.20260901105751", "2.1.0")).toBeUndefined()
  })

  test("stays quiet when stable could not be probed", () => {
    expect(describeStableAlternative(NIGHTLY, undefined)).toBeUndefined()
  })
})
