/**
 * Release version algebra, shared by the auto-update bootstrap and the
 * `cz-cli update` command so both agree on ordering and on which channel a
 * version belongs to.
 *
 * Wire formats we ship:
 *   stable   `2.0.4`                      (plain semver, promoted to /api/stable)
 *   nightly  `dev-v2.0.4.20260901105751`  (promoted to /api/nightly)
 *
 * `dev-v<base>.<timestamp>` is not parseable by any standard comparator, so the
 * old hand-rolled comparison fell back to string heuristics and returned 0 when
 * comparing a nightly against a stable of the same base — which made
 * "refusing to downgrade" a coin flip. Everything here normalizes to real
 * semver first (`dev-v2.0.4.T` -> `2.0.4-dev.T`) and then uses semver
 * precedence, under which a prerelease sorts *before* its release: nightly ->
 * stable at the same base is an upgrade, and nightly timestamps order
 * numerically.
 *
 * The wire format itself is intentionally left alone: the `dev-v` prefix is
 * baked into git tags, COS version directories, cos-release.mjs / cos-promote.mjs
 * / check-release-lineage.mjs and the install scripts served from cz-cli.ai.
 * Renaming it is a distribution migration, not a comparison fix.
 */
import semver from "semver"

// Our own release channel, intentionally isolated from opencode's
// `InstallationChannel` (the build-time CLICKZETTA_CHANNEL constant, which also
// drives per-channel DB isolation, telemetry env, and dev-mode detection).
// This channel only selects the install/update version stream and is persisted
// in ~/.clickzetta/install.json by every install/update entry point.
export type ReleaseChannel = "stable" | "nightly"
export const DEFAULT_RELEASE_CHANNEL: ReleaseChannel = "stable"
export const RELEASE_CHANNELS: readonly ReleaseChannel[] = ["stable", "nightly"]

export function isPendingChannelSwitch(version: string, selection: { channel: ReleaseChannel; explicit: boolean }) {
  const installed = channelForVersion(version)
  return selection.explicit && installed !== undefined && installed !== selection.channel
}

const DEV_RELEASE_VERSION_RE = /^dev-v(\d+\.\d+\.\d+)\.([\w.-]+)$/
const SEMVER_RELEASE_VERSION_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/

export function coerceChannel(value: unknown): ReleaseChannel | undefined {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : undefined
  return normalized === "stable" || normalized === "nightly" ? normalized : undefined
}

/**
 * Normalize a shipped version to something `semver` can order.
 * Returns undefined for anything that is not a version we publish (notably
 * opencode's "local" sentinel), so callers can treat it as unorderable.
 */
export function toComparableSemver(version: string): string | undefined {
  const dev = DEV_RELEASE_VERSION_RE.exec(version)
  // `_` is legal in our tag suffix but not in a semver prerelease identifier;
  // it only ever affects ordering, so folding it to `-` is safe.
  const candidate = dev ? `${dev[1]}-dev.${dev[2].replace(/_/g, "-")}` : version
  return semver.valid(candidate) ?? undefined
}

export function isReleaseVersion(version: string) {
  return DEV_RELEASE_VERSION_RE.test(version) || SEMVER_RELEASE_VERSION_RE.test(version)
}

/**
 * Which channel a version can legitimately have come from. Mirrors the release
 * pipeline's own rule (scripts/check-release-lineage.mjs): `dev-v*` only ever
 * promotes to nightly, plain semver only ever to stable.
 */
export function channelForVersion(version: string): ReleaseChannel | undefined {
  if (DEV_RELEASE_VERSION_RE.test(version)) return "nightly"
  if (SEMVER_RELEASE_VERSION_RE.test(version)) return "stable"
  return undefined
}

/**
 * True for builds that were never published and therefore can never be an
 * update target. `Script.version` (packages/script/src/index.ts) stamps
 * `0.0.0-<git-branch>-<ts>` whenever OPENCODE_VERSION is unset, and version.ts
 * falls back to `0.0.0-dev+<ts>` under `bun run`. Both used to satisfy
 * isReleaseVersion, so a worktree build would happily auto-update itself onto
 * stable on first run. No published release has a 0.0.0 base.
 */
export function isLocalBuildVersion(version: string) {
  const normalized = toComparableSemver(version)
  if (!normalized) return true
  return semver.major(normalized) === 0 && semver.minor(normalized) === 0 && semver.patch(normalized) === 0
}

/** Negative / zero / positive, semver precedence. 0 when either side is unorderable. */
export function compareReleaseVersions(left: string, right: string) {
  const l = toComparableSemver(left)
  const r = toComparableSemver(right)
  if (!l || !r) return 0
  return semver.compare(l, r)
}

export function shouldUpgradeToVersion(currentVersion: string, latestVersion: string) {
  const current = toComparableSemver(currentVersion)
  const latest = toComparableSemver(latestVersion)
  if (!current || !latest) return currentVersion !== latestVersion
  const order = semver.compare(latest, current)
  // Equal precedence but a different string means build metadata differs; treat
  // it as a reinstall rather than a no-op, matching the previous behaviour.
  return order > 0 || (order === 0 && latestVersion !== currentVersion)
}

/**
 * Reject a remotely-resolved version that does not belong to the channel we
 * asked for. Every entry point that turns a network response into an upgrade
 * target must go through this: a nightly install must never be handed a stable
 * version by a fallback source, and vice versa. Without it a single timeout on
 * /api/nightly was enough to silently move a nightly install onto stable — the
 * downgrade guard only catches that when stable happens to be behind.
 */
export function assertVersionInChannel(version: string, channel: ReleaseChannel, source: string): string {
  const actual = channelForVersion(version)
  if (actual !== channel) {
    throw new Error(
      `${source} returned ${version}, which belongs to the ${actual ?? "unknown"} channel, not ${channel}. ` +
        `Refusing to cross channels; use \`cz-cli update --channel ${actual ?? "stable"}\` to switch deliberately.`,
    )
  }
  return version
}
