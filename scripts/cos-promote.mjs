#!/usr/bin/env node
/**
 * Promote an existing COS release to a channel pointer.
 *
 * Usage:
 *   bun run scripts/cos-promote.mjs --channel stable --version 0.3.62
 *   bun run scripts/cos-promote.mjs --channel nightly --version 0.3.62
 *
 * Env: COS_SECRET_ID, COS_SECRET_KEY, COS_BUCKET, COS_REGION
 *      COS_PATH_PREFIX (optional, default "cz-cli-releases")
 */

import { pathToFileURL } from "node:url"
import { Cache, createClient, getJson, putJson, putText, getText } from "./cos-upload.mjs"

const PATH_PREFIX = process.env.COS_PATH_PREFIX ?? "cz-cli-releases"
const META_INF_PREFIX = "META-INF"
const VERSION_RE = /^(?:\d+\.\d+\.\d+([-+][\w.-]+)?|dev-v\d+\.\d+\.\d+\.[\w.-]+)$/

/** Compare release versions. Returns <0 if a<b, 0 if equal, >0 if a>b. */
export function compareReleaseVersions(a, b) {
  const pa = a.replace(/^dev-v/, "").replace(/[-+].*$/, "").split(".")
  const pb = b.replace(/^dev-v/, "").replace(/[-+].*$/, "").split(".")
  for (let i = 0; i < 3; i++) {
    const left = Number(pa[i] ?? 0)
    const right = Number(pb[i] ?? 0)
    if (left !== right) return left - right
  }
  if (a.startsWith("dev-v") && b.startsWith("dev-v")) return pa.slice(3).join(".").localeCompare(pb.slice(3).join("."))
  return 0
}

function parseArgs(argv) {
  const args = { channel: undefined, version: undefined, dryRun: false }
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i]
    const next = () => argv[++i]
    switch (flag) {
      case "--channel":
        args.channel = next()
        break
      case "--version":
        args.version = next()
        break
      case "--dry-run":
        args.dryRun = true
        break
      default:
        throw new Error(`Unknown flag: ${flag}`)
    }
  }
  if (!args.channel || !["stable", "nightly"].includes(args.channel)) {
    throw new Error("--channel must be 'stable' or 'nightly'")
  }
  if (!args.version || !VERSION_RE.test(args.version)) {
    throw new Error(`Invalid --version: ${args.version}`)
  }
  return args
}

const key = (...parts) => [PATH_PREFIX, ...parts].join("/")
const metaRootKey = (...parts) => key(META_INF_PREFIX, ...parts)
const releaseMetaKey = (version, ...parts) => metaRootKey("releases", version, ...parts)
const channelMetaKey = (channel, ...parts) => metaRootKey("channels", channel, ...parts)

async function loadReleaseAsset(cos, version, name) {
  const source = releaseMetaKey(version, name)
  if (name.endsWith(".json")) {
    const body = await getJson({
      client: cos.client,
      Bucket: cos.Bucket,
      Region: cos.Region,
      key: source,
    })
    if (!body) throw new Error(`Release asset not found at ${source}`)
    return { source, body }
  }
  const body = await getText({
    client: cos.client,
    Bucket: cos.Bucket,
    Region: cos.Region,
    key: source,
  })
  if (body == null) throw new Error(`Release asset not found at ${source}`)
  return { source, body }
}

async function syncChannelAssets(cos, args) {
  const assets = [
    { name: "manifest.json", kind: "json" },
    { name: "bootstrap.sh", kind: "text", contentType: "text/x-shellscript; charset=utf-8" },
    { name: "bootstrap.ps1", kind: "text", contentType: "text/plain; charset=utf-8" },
  ]

  if (args.dryRun) {
    for (const asset of assets) {
      console.log(`[dry-run] copy ${releaseMetaKey(args.version, asset.name)} -> ${channelMetaKey(args.channel, asset.name)}`)
    }
    return
  }

  for (const asset of assets) {
    const releaseAsset = await loadReleaseAsset(cos, args.version, asset.name)
    const target = channelMetaKey(args.channel, asset.name)
    if (asset.kind === "json") {
      await putJson({
        client: cos.client,
        Bucket: cos.Bucket,
        Region: cos.Region,
        body: releaseAsset.body,
        key: target,
        cacheControl: Cache.bootstrap,
      })
    } else {
      await putText({
        client: cos.client,
        Bucket: cos.Bucket,
        Region: cos.Region,
        body: releaseAsset.body,
        key: target,
        contentType: asset.contentType,
        cacheControl: Cache.bootstrap,
      })
    }
    console.log(`  ✓ ${releaseAsset.source} -> ${target}`)
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  console.log(`Promoting ${args.version} -> /${args.channel} (dry-run=${args.dryRun})`)

  const cos = args.dryRun
    ? { client: null, Bucket: process.env.COS_BUCKET ?? "DRY", Region: process.env.COS_REGION ?? "DRY" }
    : createClient()

  const manifestKey = releaseMetaKey(args.version, "manifest.json")
  const versionsKey = metaRootKey("versions.json")
  let manifest

  if (!args.dryRun) {
    manifest = await getJson({
      client: cos.client,
      Bucket: cos.Bucket,
      Region: cos.Region,
      key: manifestKey,
    })
    if (!manifest) {
      throw new Error(`Manifest not found at ${manifestKey} — version ${args.version} is not on COS`)
    }
    if (manifest.version !== args.version) {
      throw new Error(`Manifest version mismatch: file=${manifest.version} arg=${args.version}`)
    }
  } else {
    console.log(`[dry-run] would verify ${manifestKey}`)
  }

  const versionsDoc = args.dryRun
    ? undefined
    : await getJson({
        client: cos.client,
        Bucket: cos.Bucket,
        Region: cos.Region,
        key: versionsKey,
      })
  if (!args.dryRun) {
    const current = typeof versionsDoc?.[args.channel] === "string" ? versionsDoc[args.channel].trim() : undefined
    if (current && compareReleaseVersions(args.version, current.trim()) < 0) {
      throw new Error(`Refusing to downgrade ${args.channel} from ${current.trim()} to ${args.version}. Use a higher version.`)
    }
  }

  await syncChannelAssets(cos, args)

  if (!args.dryRun) {
    const prior = (versionsDoc?.versions ?? []).filter((entry) => entry.version !== args.version)
    const existingEntry = versionsDoc?.versions?.find((entry) => entry.version === args.version)
    const doc = {
      updated_at: new Date().toISOString(),
      stable: versionsDoc?.stable,
      nightly: versionsDoc?.nightly,
      versions: [
        {
          version: args.version,
          released_at: existingEntry?.released_at ?? manifest?.buildDate ?? versionsDoc?.updated_at ?? new Date().toISOString(),
          channel_tags: Array.from(new Set([...(existingEntry?.channel_tags ?? []).filter((tag) => tag !== args.channel), args.channel])),
        },
        ...prior.map((entry) => ({
          ...entry,
          channel_tags: (entry.channel_tags ?? []).filter((tag) => tag !== args.channel),
        })),
      ],
    }
    doc[args.channel] = args.version
    await putJson({
      client: cos.client,
      Bucket: cos.Bucket,
      Region: cos.Region,
      body: doc,
      key: versionsKey,
      cacheControl: Cache.short,
    })
    console.log(`  ✓ versions.json updated`)
  } else {
    console.log(`[dry-run] would patch ${versionsKey}`)
  }

  console.log("Done.")
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err.stack ?? err.message ?? err)
    process.exit(1)
  })
}
