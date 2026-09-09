import { describe, expect, test } from "bun:test"
import {
  assertVersionInChannel,
  channelForVersion,
  compareReleaseVersions,
  isLocalBuildVersion,
  isReleaseVersion,
  shouldUpgradeToVersion,
  toComparableSemver,
} from "../src/bootstrap/release-version"

const NIGHTLY = "dev-v2.0.4.20260901105751"

describe("toComparableSemver", () => {
  test("maps a nightly tag onto a real semver prerelease", () => {
    expect(toComparableSemver(NIGHTLY)).toBe("2.0.4-dev.20260901105751")
  })

  test("passes plain semver through", () => {
    expect(toComparableSemver("2.0.4")).toBe("2.0.4")
    expect(toComparableSemver("2.0.4-rc.1")).toBe("2.0.4-rc.1")
  })

  test("returns undefined for versions we never publish", () => {
    expect(toComparableSemver("local")).toBeUndefined()
    expect(toComparableSemver("")).toBeUndefined()
  })
})

describe("compareReleaseVersions", () => {
  test("a nightly sorts before the stable release of the same base", () => {
    expect(compareReleaseVersions(NIGHTLY, "2.0.4")).toBeLessThan(0)
    expect(compareReleaseVersions("2.0.4", NIGHTLY)).toBeGreaterThan(0)
  })

  test("nightly timestamps order numerically, not lexically", () => {
    // The previous comparator joined the suffix and used localeCompare, which
    // ranks "100" below "9" and would call the newer build a downgrade.
    expect(compareReleaseVersions("dev-v2.0.4.100", "dev-v2.0.4.9")).toBeGreaterThan(0)
  })

  test("base version still dominates the suffix", () => {
    expect(compareReleaseVersions("dev-v2.1.0.1", "dev-v2.0.4.99999999")).toBeGreaterThan(0)
  })
})

describe("shouldUpgradeToVersion", () => {
  test("nightly -> stable at the same base is an upgrade", () => {
    expect(shouldUpgradeToVersion(NIGHTLY, "2.0.4")).toBe(true)
  })

  test("a lagging stable source is not an upgrade for a newer nightly", () => {
    // The npm registry `latest` dist-tag has been observed behind cz-cli.ai.
    expect(shouldUpgradeToVersion(NIGHTLY, "2.0.0")).toBe(false)
  })

  test("refuses a prerelease that precedes the installed release", () => {
    // Old behaviour: both sides collapsed to "2.0.4", order === 0, strings
    // differed, so this reported an upgrade and silently downgraded.
    expect(shouldUpgradeToVersion("2.0.4", "2.0.4-rc.1")).toBe(false)
  })

  test("advances within the nightly stream", () => {
    expect(shouldUpgradeToVersion(NIGHTLY, "dev-v2.0.4.20260901120000")).toBe(true)
    expect(shouldUpgradeToVersion("dev-v2.0.4.20260901120000", NIGHTLY)).toBe(false)
  })

  test("identical versions are not an upgrade", () => {
    expect(shouldUpgradeToVersion(NIGHTLY, NIGHTLY)).toBe(false)
    expect(shouldUpgradeToVersion("2.0.4", "2.0.4")).toBe(false)
  })

  test("differing build metadata still reinstalls", () => {
    expect(shouldUpgradeToVersion("2.0.4+a", "2.0.4+b")).toBe(true)
  })
})

describe("isLocalBuildVersion", () => {
  test("worktree builds are never update targets", () => {
    // Script.version stamps 0.0.0-<git-branch>-<ts> when OPENCODE_VERSION is unset.
    expect(isLocalBuildVersion("0.0.0-main-202609081234")).toBe(true)
    // version.ts fallback under `bun run`.
    expect(isLocalBuildVersion("0.0.0-dev+202609081234")).toBe(true)
    expect(isLocalBuildVersion("local")).toBe(true)
  })

  test("published releases are update targets", () => {
    expect(isLocalBuildVersion("2.0.4")).toBe(false)
    expect(isLocalBuildVersion(NIGHTLY)).toBe(false)
    expect(isLocalBuildVersion("0.3.62")).toBe(false)
  })

  test("local builds still look like release versions by shape", () => {
    // Which is exactly why the shape check alone was not enough to stop
    // auto-update from replacing a worktree build.
    expect(isReleaseVersion("0.0.0-main-202609081234")).toBe(true)
  })
})

describe("channelForVersion", () => {
  test("dev tags belong to nightly and plain semver to stable", () => {
    expect(channelForVersion(NIGHTLY)).toBe("nightly")
    expect(channelForVersion("2.0.4")).toBe("stable")
    expect(channelForVersion("garbage")).toBeUndefined()
  })
})

describe("assertVersionInChannel", () => {
  test("passes a version through when the channel matches", () => {
    expect(assertVersionInChannel(NIGHTLY, "nightly", "src")).toBe(NIGHTLY)
    expect(assertVersionInChannel("2.0.4", "stable", "src")).toBe("2.0.4")
  })

  test("rejects a stable version offered to a nightly install", () => {
    expect(() => assertVersionInChannel("2.1.0", "nightly", "https://registry.npmjs.org/...")).toThrow(
      /belongs to the stable channel, not nightly/,
    )
  })

  test("rejects a nightly version offered to a stable install", () => {
    expect(() => assertVersionInChannel(NIGHTLY, "stable", "src")).toThrow(/not stable/)
  })

  test("names the command that switches channels deliberately", () => {
    expect(() => assertVersionInChannel("2.1.0", "nightly", "src")).toThrow(/--channel stable/)
  })
})
