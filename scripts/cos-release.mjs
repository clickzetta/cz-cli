#!/usr/bin/env node
/**
 * Bundle dist artifacts and publish a release to Tencent COS.
 *
 * Usage:
 *   bun run scripts/cos-release.mjs \
 *     --version 0.3.62 \
 *     --dist packages/opencode/dist \
 *     --git-sha $GITHUB_SHA \
 *     --build-date 2026-05-27T10:00:00Z \
 *     [--no-promote-latest] [--promote-stable] [--retain 10] [--dry-run]
 *
 * Env: COS_SECRET_ID, COS_SECRET_KEY, COS_BUCKET, COS_REGION
 *      COS_PATH_PREFIX (optional, default "cz-cli-releases")
 */

import { execFileSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"
import {
  Cache,
  createClient,
  formatBytes,
  deleteObjects,
  getJson,
  listPrefix,
  putJson,
  putText,
  statFileWithSha256,
  uploadFile,
} from "./cos-upload.mjs"

const PATH_PREFIX = process.env.COS_PATH_PREFIX ?? "cz-cli-releases"

const VERSION_RE = /^\d+\.\d+\.\d+([-+][\w.-]+)?$/
const VERSION_DIR_RE = /^\d+\.\d+\.\d+([-+][\w.-]+)?\/$/

const DIST_PREFIX = "cz-cli-"

// dist subdir name → COS platform name
function distToPlatform(distName) {
  if (!distName.startsWith(DIST_PREFIX)) return null
  return distName.slice(DIST_PREFIX.length).replace(/^windows-/, "win32-")
}

function platformBinary(platform) {
  return platform.startsWith("win32") ? "cz-cli.exe" : "cz-cli"
}

function platformArchiveExt(platform) {
  if (platform.startsWith("linux")) return "tar.gz"
  return "zip"
}

function archiveName(version, platform) {
  return `cz-cli-${version}-${platform}.${platformArchiveExt(platform)}`
}

function parseArgs(argv) {
  const args = {
    version: undefined,
    dist: undefined,
    gitSha: undefined,
    buildDate: undefined,
    promoteLatest: true,
    promoteStable: false,
    retain: 10,
    dryRun: false,
  }
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i]
    const next = () => argv[++i]
    switch (flag) {
      case "--version":
        args.version = next()
        break
      case "--dist":
        args.dist = next()
        break
      case "--git-sha":
        args.gitSha = next()
        break
      case "--build-date":
        args.buildDate = next()
        break
      case "--retain":
        args.retain = Number(next())
        break
      case "--promote-latest":
        args.promoteLatest = true
        break
      case "--no-promote-latest":
        args.promoteLatest = false
        break
      case "--promote-stable":
        args.promoteStable = true
        break
      case "--dry-run":
        args.dryRun = true
        break
      default:
        throw new Error(`Unknown flag: ${flag}`)
    }
  }
  return args
}

function validateArgs(args) {
  if (!args.version) throw new Error("--version is required")
  if (!VERSION_RE.test(args.version)) {
    throw new Error(`Invalid version: ${args.version}`)
  }
  if (!args.dist) throw new Error("--dist is required")
  if (!fs.existsSync(args.dist)) throw new Error(`dist not found: ${args.dist}`)
  if (!args.gitSha) args.gitSha = "unknown"
  if (!args.buildDate) args.buildDate = new Date().toISOString()
  if (!Number.isInteger(args.retain) || args.retain < 1) {
    throw new Error("--retain must be a positive integer")
  }
}

function detectPlatforms(distDir) {
  const subdirs = fs
    .readdirSync(distDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name.startsWith(DIST_PREFIX))
    .map((d) => d.name)
  return subdirs
    .map((name) => {
      const platform = distToPlatform(name)
      if (!platform) return null
      return { distName: name, platform, distPath: path.join(distDir, name) }
    })
    .filter(Boolean)
}

function ensureBinary(distPath, platform) {
  const binary = platformBinary(platform)
  const binaryPath = path.join(distPath, "bin", binary)
  if (!fs.existsSync(binaryPath)) {
    throw new Error(`Missing binary: ${binaryPath}`)
  }
  return binaryPath
}

async function archivePlatform({ distPath, platform, version, archivesDir }) {
  const ext = platformArchiveExt(platform)
  const name = archiveName(version, platform)
  const archivePath = path.join(archivesDir, name)
  const binDir = path.join(distPath, "bin")

  ensureBinary(distPath, platform)
  fs.mkdirSync(archivesDir, { recursive: true })

  if (ext === "tar.gz") {
    execFileSync("tar", ["-czf", path.resolve(archivePath), "."], {
      cwd: binDir,
      stdio: "inherit",
    })
  } else {
    if (fs.existsSync(archivePath)) fs.rmSync(archivePath)
    execFileSync("zip", ["-rq", path.resolve(archivePath), "."], {
      cwd: binDir,
      stdio: "inherit",
    })
  }

  return { archivePath, archiveName: name, format: ext, ...(await statFileWithSha256(archivePath)) }
}

function key(...parts) {
  return [PATH_PREFIX, ...parts].join("/")
}

export async function uploadAllArchives(ctx, builds, options = {}) {
  const log = options.log ?? console.log
  const now = options.now ?? (() => new Date())
  const uploadFn = options.uploadFn ?? uploadFile
  const platforms = {}
  if (ctx.dryRun) {
    for (const b of builds) {
      log(`[dry-run] upload ${b.archivePath} -> ${b.targetKey}`)
      platforms[b.platform] = {
        archive: b.archiveName,
        format: b.format,
        binary: platformBinary(b.platform),
        checksum: b.sha256,
        size: b.size,
      }
    }
    return platforms
  }

  const results = await Promise.all(
    builds.map(async (b) => {
      log(`[${now().toISOString()}] uploading ${b.platform}: ${b.archiveName} -> ${b.targetKey}`)
      const result = await uploadFn({
        client: ctx.client,
        Bucket: ctx.Bucket,
        Region: ctx.Region,
        filePath: b.archivePath,
        key: b.targetKey,
        contentType: "application/octet-stream",
        cacheControl: Cache.immutable,
        size: b.size,
        sha256: b.sha256,
        log: (msg) => log(`[${now().toISOString()}] [${b.platform}] ${msg}`),
      })
      return { platform: b.platform, archiveName: b.archiveName, result }
    }),
  )

  for (const r of results) {
    log(`  ✓ ${r.platform} (${(r.result.size / 1024 / 1024).toFixed(1)} MB)`)
    platforms[r.platform] = {
      archive: r.archiveName,
      format: r.result.format ?? platformArchiveExt(r.platform),
      binary: platformBinary(r.platform),
      checksum: r.result.sha256,
      size: r.result.size,
    }
  }
  return platforms
}

function logPreparedArchives(builds) {
  console.log("Prepared archives:")
  for (const build of builds) {
    console.log(
      `  - platform=${build.platform} archive=${build.archiveName} size=${formatBytes(build.size)} sha256=${build.sha256.slice(0, 12)} path=${build.archivePath} target=${build.targetKey}`,
    )
  }
}

async function writeManifest(ctx, platforms) {
  const manifest = {
    version: ctx.version,
    commit: ctx.gitSha,
    buildDate: ctx.buildDate,
    platforms,
  }
  const target = key(ctx.version, "manifest.json")
  if (ctx.dryRun) {
    console.log(`[dry-run] write manifest -> ${target}`)
    console.log(JSON.stringify(manifest, null, 2))
    return manifest
  }
  await putJson({
    client: ctx.client,
    Bucket: ctx.Bucket,
    Region: ctx.Region,
    body: manifest,
    key: target,
    cacheControl: Cache.immutable,
  })
  console.log(`  ✓ manifest -> ${target}`)
  return manifest
}

async function writeChannel(ctx, channel) {
  const target = key(channel)
  if (ctx.dryRun) {
    console.log(`[dry-run] write channel ${channel} -> ${ctx.version}`)
    return
  }
  await putText({
    client: ctx.client,
    Bucket: ctx.Bucket,
    Region: ctx.Region,
    body: ctx.version,
    key: target,
    cacheControl: Cache.short,
  })
  console.log(`  ✓ ${channel} -> ${ctx.version}`)
}

async function updateVersions(ctx) {
  const target = key("versions.json")
  const existing = ctx.dryRun
    ? null
    : await getJson({
        client: ctx.client,
        Bucket: ctx.Bucket,
        Region: ctx.Region,
        key: target,
      })
  const prior = (existing?.versions ?? []).filter((v) => v.version !== ctx.version)
  const channelTags = []
  if (ctx.promoteLatest) channelTags.push("latest")
  if (ctx.promoteStable) channelTags.push("stable")
  const next = [
    {
      version: ctx.version,
      released_at: ctx.buildDate,
      channel_tags: channelTags,
    },
    ...prior,
  ].slice(0, ctx.retain)

  // Re-tag prior entries based on what we know
  for (const entry of next) {
    if (entry.version === ctx.version) continue
    entry.channel_tags = entry.channel_tags?.filter((t) => {
      if (t === "latest" && ctx.promoteLatest) return false
      if (t === "stable" && ctx.promoteStable) return false
      return true
    }) ?? []
  }

  const doc = {
    updated_at: ctx.buildDate,
    stable: existing?.stable,
    latest: existing?.latest,
    versions: next,
  }
  if (ctx.promoteLatest) doc.latest = ctx.version
  if (ctx.promoteStable) doc.stable = ctx.version

  if (ctx.dryRun) {
    console.log(`[dry-run] write ${target}`)
    console.log(JSON.stringify(doc, null, 2))
    return doc
  }
  await putJson({
    client: ctx.client,
    Bucket: ctx.Bucket,
    Region: ctx.Region,
    body: doc,
    key: target,
    cacheControl: Cache.short,
  })
  console.log(`  ✓ versions.json (kept ${next.length})`)
  return doc
}

async function retentionCleanup(ctx, versionsDoc) {
  const keep = new Set(versionsDoc.versions.map((v) => v.version))
  if (versionsDoc.stable) keep.add(versionsDoc.stable)
  if (versionsDoc.latest) keep.add(versionsDoc.latest)
  keep.add(ctx.version)

  if (ctx.dryRun) {
    console.log(`[dry-run] retention keep set: ${[...keep].join(", ")}`)
    return
  }

  const allKeys = await listPrefix({
    client: ctx.client,
    Bucket: ctx.Bucket,
    Region: ctx.Region,
    prefix: `${PATH_PREFIX}/`,
  })

  const versionDirs = new Map()
  for (const k of allKeys) {
    const rel = k.slice(PATH_PREFIX.length + 1)
    const m = rel.match(/^(\d+\.\d+\.\d+(?:[-+][\w.-]+)?)\//)
    if (!m) continue
    const ver = m[1]
    if (!versionDirs.has(ver)) versionDirs.set(ver, [])
    versionDirs.get(ver).push(k)
  }

  const toDelete = []
  for (const [ver, keys] of versionDirs) {
    if (!keep.has(ver)) toDelete.push(...keys)
  }

  if (toDelete.length === 0) {
    console.log(`  ✓ retention: nothing to delete (${versionDirs.size} versions on COS)`)
    return
  }

  await deleteObjects({
    client: ctx.client,
    Bucket: ctx.Bucket,
    Region: ctx.Region,
    keys: toDelete,
  })
  const evicted = [...versionDirs.keys()].filter((v) => !keep.has(v))
  console.log(
    `  ✓ retention: deleted ${toDelete.length} keys across ${evicted.length} version(s): ${evicted.join(", ")}`,
  )
}

function writeJobSummary(builds, manifest, versionsDoc) {
  const summaryPath = process.env.GITHUB_STEP_SUMMARY
  if (!summaryPath) return
  const lines = []
  lines.push(`## cz-cli release ${manifest.version}`)
  lines.push("")
  lines.push(`- commit: \`${manifest.commit}\``)
  lines.push(`- buildDate: \`${manifest.buildDate}\``)
  lines.push(`- versions kept: ${versionsDoc.versions.length}`)
  lines.push(`- channel pointers: stable=\`${versionsDoc.stable ?? "-"}\` latest=\`${versionsDoc.latest ?? "-"}\``)
  lines.push("")
  lines.push("| Platform | Archive | Size | SHA256 |")
  lines.push("|---|---|---:|---|")
  for (const [platform, p] of Object.entries(manifest.platforms)) {
    const sizeMb = p.size === 0 ? "-" : `${(p.size / 1024 / 1024).toFixed(1)} MB`
    lines.push(`| \`${platform}\` | \`${p.archive}\` | ${sizeMb} | \`${p.checksum.slice(0, 12)}…\` |`)
  }
  fs.appendFileSync(summaryPath, lines.join("\n") + "\n")
}

async function main() {
  const _log = console.log
  console.log = (...args) => _log(`[${new Date().toISOString()}]`, ...args)

  const args = parseArgs(process.argv.slice(2))
  validateArgs(args)

  console.log(`cz-cli COS release ${args.version} (dry-run=${args.dryRun})`)
  const platforms = detectPlatforms(args.dist)
  if (platforms.length === 0) {
    throw new Error(`No dist platforms found under ${args.dist}`)
  }
  console.log(`Detected ${platforms.length} platform(s): ${platforms.map((p) => p.platform).join(", ")}`)

  const archivesDir = path.join(args.dist, "archives")
  const builds = []
  for (const p of platforms) {
    const t0 = Date.now()
    const built = await archivePlatform({
      distPath: p.distPath,
      platform: p.platform,
      version: args.version,
      archivesDir,
    })
    console.log(`  ✓ Archived ${p.platform} (${formatBytes(built.size)}, ${((Date.now() - t0) / 1000).toFixed(1)}s)`)
    builds.push({ platform: p.platform, targetKey: key(args.version, p.platform, built.archiveName), ...built })
  }
  logPreparedArchives(builds)

  const cos = args.dryRun
    ? { client: null, Bucket: process.env.COS_BUCKET ?? "DRY", Region: process.env.COS_REGION ?? "DRY" }
    : createClient()
  const ctx = { ...args, ...cos }

  console.log("Uploading archives...")
  const manifestPlatforms = await uploadAllArchives(ctx, builds)

  console.log("Writing manifest...")
  const manifest = await writeManifest(ctx, manifestPlatforms)

  if (args.promoteLatest) {
    console.log("Updating /latest...")
    await writeChannel(ctx, "latest")
  }
  if (args.promoteStable) {
    console.log("Updating /stable...")
    await writeChannel(ctx, "stable")
  }

  console.log("Updating versions.json...")
  const versionsDoc = await updateVersions(ctx)

  console.log("Retention cleanup...")
  await retentionCleanup(ctx, versionsDoc)

  writeJobSummary(builds, manifest, versionsDoc)
  console.log("Done.")
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err.stack ?? err.message ?? err)
    process.exit(1)
  })
}
