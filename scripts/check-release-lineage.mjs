#!/usr/bin/env bun
/**
 * Release lineage guard.
 *
 * Blocks a release whose version number would win the channel pointer while
 * carrying an OLDER opencode baseline than the version already published there.
 *
 * Why this exists: cz-cli has two long-lived code lines that share one release
 * channel and one semver space (`cz-1.17.11` on opencode 1.17.11, `main` on
 * opencode 1.4.7). Their version numbers are independent counters, so "higher
 * version" does not imply "newer code". On 2026-08-05 `dev-v1.17.24` (opencode
 * 1.4.7) took the nightly pointer from `dev-v1.17.11.*` (opencode 1.17.11) and
 * silently downgraded users onto a code line that cannot read their database.
 *
 * The rule:
 *   if (incomingVersion >= publishedVersion && incomingBaseline < publishedBaseline)
 *     -> refuse
 *
 * Usage:
 *   bun run scripts/check-release-lineage.mjs --version dev-v1.17.25.20260806120000
 *   bun run scripts/check-release-lineage.mjs --version 1.17.25 [--channel stable]
 *
 * Flags:
 *   --version <v>   required; release version (tag name form)
 *   --channel <c>   stable | nightly; defaults to nightly for dev-v*, else stable
 *   --baseline <v>  override the incoming opencode baseline (default: read from
 *                   packages/opencode/package.json in the working tree)
 *   --published <v> override the version considered already published on the
 *                   channel, instead of querying it (for testing and dry runs)
 *   --force         report the violation but exit 0 (deliberate lineage switch)
 *   --json          emit a machine-readable verdict on stdout
 */

import { readFileSync } from "node:fs"
import { execFileSync } from "node:child_process"
import path from "node:path"

const CHANNEL_API = {
  stable: "https://cz-cli.ai/api/stable",
  nightly: "https://cz-cli.ai/api/nightly",
}

const DEV_VERSION_RE = /^dev-v(\d+)\.(\d+)\.(\d+)\.([0-9A-Za-z.-]+)$/
const SEMVER_VERSION_RE = /^v?(\d+)\.(\d+)\.(\d+)([-+][\w.-]+)?$/

class GuardError extends Error {}

function parseArgs(argv) {
  const out = { force: false, json: false }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    switch (arg) {
      case "--version":
        out.version = argv[++i]
        break
      case "--channel":
        out.channel = argv[++i]
        break
      case "--baseline":
        out.baseline = argv[++i]
        break
      case "--published":
        out.published = argv[++i]
        break
      case "--force":
        out.force = true
        break
      case "--json":
        out.json = true
        break
      default:
        throw new GuardError(`Unknown argument: ${arg}`)
    }
  }
  if (!out.version) throw new GuardError("--version is required")
  if (out.channel && !(out.channel in CHANNEL_API)) {
    throw new GuardError(`--channel must be one of: ${Object.keys(CHANNEL_API).join(", ")}`)
  }
  return out
}

/**
 * The channel a version can reach, decided by its own shape.
 *
 * dev-v* releases only ever promote to nightly, plain semver only to stable
 * (release-cos.yml passes --no-promote-nightly --promote-stable for stable tags,
 * and cos-release.mjs defaults to nightly otherwise). The two streams are
 * therefore independent: a dev release can never take the stable pointer and a
 * stable release can never take the nightly one, so they must never be compared
 * against each other.
 */
function channelForVersion(parsed) {
  return parsed.isDev ? "nightly" : "stable"
}

/** Split a release version into its comparable semver triple. */
function parseVersion(version) {
  const dev = DEV_VERSION_RE.exec(version)
  if (dev) {
    return {
      raw: version,
      isDev: true,
      triple: [Number(dev[1]), Number(dev[2]), Number(dev[3])],
      suffix: dev[4],
    }
  }
  const release = SEMVER_VERSION_RE.exec(version)
  if (release) {
    return {
      raw: version,
      isDev: false,
      triple: [Number(release[1]), Number(release[2]), Number(release[3])],
      suffix: "",
    }
  }
  throw new GuardError(`Unrecognized version shape: ${version}`)
}

/** Compare two [major, minor, patch] triples. */
function compareTriple(left, right) {
  for (let i = 0; i < 3; i++) {
    if (left[i] !== right[i]) return left[i] - right[i]
  }
  return 0
}

/**
 * Mirrors the client's own comparison in packages/cz-cli/src/bootstrap/update.ts
 * (compareReleaseVersions): the timestamp suffix only breaks ties when the
 * triples are equal. Anything else is decided on the triple alone.
 */
function compareVersions(left, right) {
  const order = compareTriple(left.triple, right.triple)
  if (order !== 0) return order
  if (left.isDev && right.isDev) return left.suffix.localeCompare(right.suffix)
  return 0
}

function repoRoot() {
  return path.resolve(import.meta.dirname, "..")
}

/** The opencode baseline of the working tree being released. */
function localBaseline() {
  const file = path.join(repoRoot(), "packages/opencode/package.json")
  const version = JSON.parse(readFileSync(file, "utf-8")).version
  if (typeof version !== "string") {
    throw new GuardError(`No version field in ${file}`)
  }
  return version
}

/** Map a release version back to the git tag that carries it. */
function tagForVersion(version) {
  return version.startsWith("dev-v") ? version : `v${version.replace(/^v/, "")}`
}

/**
 * The opencode baseline of an already-published version, read out of its tag.
 * Returns undefined when the tag is not present locally — callers treat that as
 * "cannot compare" rather than as a pass.
 */
function baselineAtTag(tag) {
  try {
    const json = execFileSync("git", ["show", `${tag}:packages/opencode/package.json`], {
      cwd: repoRoot(),
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    })
    const version = JSON.parse(json).version
    return typeof version === "string" ? version : undefined
  } catch {
    return undefined
  }
}

/**
 * The version currently on a channel, or undefined when the channel is empty.
 * A 404 means nothing has been promoted there yet — there is no pointer to take,
 * so the guard has nothing to protect and the release proceeds.
 */
async function publishedVersion(channel) {
  const url = CHANNEL_API[channel]
  if (!url) throw new GuardError(`Unknown channel: ${channel}`)
  const response = await fetch(url, { signal: AbortSignal.timeout(15_000) })
  if (response.status === 404) return undefined
  if (!response.ok) {
    throw new GuardError(`Failed to read ${channel} channel (${response.status})`)
  }
  const payload = await response.json()
  if (!payload?.version) return undefined
  return payload.version
}

function baselineTriple(version) {
  const parsed = SEMVER_VERSION_RE.exec(version)
  if (!parsed) throw new GuardError(`Unrecognized opencode baseline: ${version}`)
  return [Number(parsed[1]), Number(parsed[2]), Number(parsed[3])]
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const incoming = parseVersion(args.version)
  const natural = channelForVersion(incoming)
  if (args.channel && args.channel !== natural) {
    throw new GuardError(
      `${incoming.raw} can only reach the ${natural} channel, but --channel ${args.channel} was given. ` +
        `dev-v* releases promote to nightly and plain semver releases to stable; the two never mix.`,
    )
  }
  const channel = natural
  const incomingBaseline = args.baseline ?? localBaseline()

  const published = args.published ?? (await publishedVersion(channel))

  if (!published) {
    const verdict = {
      channel,
      incoming: { version: incoming.raw, opencode: incomingBaseline },
      published: null,
      result: "ok",
      reason: `Channel ${channel} is empty; no pointer to regress.`,
    }
    report(
      args,
      verdict,
      [
        `channel            ${channel}`,
        `releasing          ${incoming.raw}  (opencode ${incomingBaseline})`,
        `already published  (none)`,
        "",
        `OK  ${channel} has no current version, so there is no pointer to take.`,
      ],
      0,
    )
    return
  }

  const publishedParsed = parseVersion(published)
  const publishedTag = tagForVersion(published)
  const publishedBaseline = baselineAtTag(publishedTag)

  const verdict = {
    channel,
    incoming: { version: incoming.raw, opencode: incomingBaseline },
    published: { version: published, tag: publishedTag, opencode: publishedBaseline ?? null },
  }

  const lines = [
    `channel            ${channel}`,
    `releasing          ${incoming.raw}  (opencode ${incomingBaseline})`,
    `already published  ${published}  (opencode ${publishedBaseline ?? "unresolved"})`,
  ]

  // Both sides must belong to this channel's stream. If they don't, the channel
  // is serving a version it should never hold and comparing across the two
  // streams would produce a meaningless verdict — so refuse rather than guess.
  const publishedChannel = channelForVersion(publishedParsed)
  if (publishedChannel !== channel) {
    verdict.result = "blocked"
    verdict.reason =
      `Channel ${channel} currently serves ${published}, which belongs to the ${publishedChannel} stream.`
    lines.push(
      "",
      `BLOCKED  ${verdict.reason}`,
      "",
      "dev-v* versions belong to nightly and plain semver versions to stable; the",
      "streams are independent and their version numbers are not comparable. A",
      "channel holding the other stream's version means an earlier publish went to",
      "the wrong place. Fix the channel pointer before releasing.",
    )
    report(args, verdict, lines, args.force ? 0 : 1)
    return
  }

  if (!publishedBaseline) {
    verdict.result = "skipped"
    verdict.reason = `Cannot resolve opencode baseline for ${publishedTag}; fetch tags to enable this check.`
    lines.push("", `SKIP  ${verdict.reason}`)
    report(args, verdict, lines, 0)
    return
  }

  const versionOrder = compareVersions(incoming, publishedParsed)
  const baselineOrder = compareTriple(baselineTriple(incomingBaseline), baselineTriple(publishedBaseline))
  const winsPointer = versionOrder >= 0
  const olderCode = baselineOrder < 0

  verdict.wins_channel_pointer = winsPointer
  verdict.baseline_regresses = olderCode

  if (winsPointer && olderCode) {
    verdict.result = args.force ? "forced" : "blocked"
    lines.push(
      "",
      `${args.force ? "FORCED" : "BLOCKED"}  this release would take the ${channel} pointer while moving the`,
      `         opencode baseline backwards (${publishedBaseline} -> ${incomingBaseline}).`,
      "",
      "Clients compare only the first three version segments, so every installation",
      `on ${channel} would "upgrade" onto older code. That code cannot read a database`,
      "written by the newer line: history stops loading and the workspace table is",
      "cleared, with no automatic way back.",
      "",
      "Options:",
      `  - release from the newer line instead (opencode ${publishedBaseline} or later), or`,
      `  - keep this build off ${channel} (tag it so it loses the version comparison), or`,
      "  - pass --force if this lineage switch is deliberate and users are being migrated.",
    )
    report(args, verdict, lines, args.force ? 0 : 1)
    return
  }

  verdict.result = "ok"
  lines.push(
    "",
    winsPointer
      ? `OK  takes the ${channel} pointer, opencode baseline does not regress.`
      : `OK  loses the version comparison, so the ${channel} pointer is unaffected.`,
  )
  report(args, verdict, lines, 0)
}

function report(args, verdict, lines, code) {
  if (args.json) {
    process.stdout.write(JSON.stringify(verdict, null, 2) + "\n")
  } else {
    process.stdout.write(lines.join("\n") + "\n")
  }
  process.exit(code)
}

try {
  await main()
} catch (error) {
  if (error instanceof GuardError) {
    process.stderr.write(`release lineage guard: ${error.message}\n`)
    process.exit(2)
  }
  throw error
}
