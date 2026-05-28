#!/usr/bin/env node
/**
 * Promote an existing COS release to a channel pointer.
 *
 * Usage:
 *   bun run scripts/cos-promote.mjs --channel stable --version 0.3.62
 *   bun run scripts/cos-promote.mjs --channel latest --version 0.3.62
 *
 * Env: COS_SECRET_ID, COS_SECRET_KEY, COS_BUCKET, COS_REGION
 *      COS_PATH_PREFIX (optional, default "cz-cli-releases")
 */

import { Cache, createClient, getJson, putJson, putText } from "./cos-upload.mjs"

const PATH_PREFIX = process.env.COS_PATH_PREFIX ?? "cz-cli-releases"
const VERSION_RE = /^\d+\.\d+\.\d+([-+][\w.-]+)?$/

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
  if (!args.channel || !["stable", "latest"].includes(args.channel)) {
    throw new Error("--channel must be 'stable' or 'latest'")
  }
  if (!args.version || !VERSION_RE.test(args.version)) {
    throw new Error(`Invalid --version: ${args.version}`)
  }
  return args
}

const key = (...parts) => [PATH_PREFIX, ...parts].join("/")

async function main() {
  const args = parseArgs(process.argv.slice(2))
  console.log(`Promoting ${args.version} -> /${args.channel} (dry-run=${args.dryRun})`)

  const cos = args.dryRun
    ? { client: null, Bucket: process.env.COS_BUCKET ?? "DRY", Region: process.env.COS_REGION ?? "DRY" }
    : createClient()

  const manifestKey = key(args.version, "manifest.json")

  if (!args.dryRun) {
    const manifest = await getJson({
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

  const channelKey = key(args.channel)
  if (args.dryRun) {
    console.log(`[dry-run] write ${channelKey} <- ${args.version}`)
  } else {
    await putText({
      client: cos.client,
      Bucket: cos.Bucket,
      Region: cos.Region,
      body: args.version,
      key: channelKey,
      cacheControl: Cache.short,
    })
    console.log(`  ✓ ${args.channel} -> ${args.version}`)
  }

  const versionsKey = key("versions.json")
  if (!args.dryRun) {
    const doc = await getJson({
      client: cos.client,
      Bucket: cos.Bucket,
      Region: cos.Region,
      key: versionsKey,
    })
    if (doc) {
      doc[args.channel] = args.version
      doc.updated_at = new Date().toISOString()
      for (const v of doc.versions ?? []) {
        v.channel_tags = (v.channel_tags ?? []).filter((t) => t !== args.channel)
        if (v.version === args.version) v.channel_tags.push(args.channel)
      }
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
      console.log(`  ! versions.json missing, skipped`)
    }
  } else {
    console.log(`[dry-run] would patch ${versionsKey}`)
  }

  console.log("Done.")
}

main().catch((err) => {
  console.error(err.stack ?? err.message ?? err)
  process.exit(1)
})
