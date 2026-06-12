#!/usr/bin/env node

import { execFileSync, spawnSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"

const assetsDir = process.argv[2]
const distDir = process.argv[3]

if (!assetsDir || !distDir) {
  throw new Error("Usage: prepare-release-assets.mjs <assets-dir> <dist-dir>")
}

if (!fs.existsSync(assetsDir)) {
  throw new Error(`assets dir not found: ${assetsDir}`)
}

fs.rmSync(distDir, { recursive: true, force: true })
fs.mkdirSync(distDir, { recursive: true })

const archives = fs
  .readdirSync(assetsDir)
  .filter((name) => name.startsWith("cz-cli-") && (name.endsWith(".zip") || name.endsWith(".tar.gz")))

if (archives.length === 0) {
  throw new Error(`no cz-cli release archives found in ${assetsDir}`)
}

for (const archive of archives) {
  const platform = archive.replace(/^cz-cli-/, "").replace(/\.tar\.gz$|\.zip$/, "")
  const binDir = path.join(distDir, `cz-cli-${platform}`, "bin")
  fs.mkdirSync(binDir, { recursive: true })

  if (archive.endsWith(".zip")) {
    const result = spawnSync("unzip", ["-q", "-o", path.join(assetsDir, archive), "-d", binDir], { stdio: "inherit" })
    if (result.status && result.status !== 1) {
      throw new Error(`failed to extract ${archive}`)
    }
    if (fs.readdirSync(binDir).length === 0) {
      throw new Error(`no files extracted from ${archive}`)
    }
    normalizeBinWrapper(binDir)
    continue
  }

  execFileSync("tar", ["-xzf", path.join(assetsDir, archive), "-C", binDir], { stdio: "inherit" })
  normalizeBinWrapper(binDir)
}

console.log(`Prepared ${archives.length} release assets in ${distDir}`)

function normalizeBinWrapper(binDir) {
  const wrappedBinDir = path.join(binDir, "bin")
  if (!fs.existsSync(wrappedBinDir) || !fs.statSync(wrappedBinDir).isDirectory()) return
  const entries = fs.readdirSync(binDir)
  if (entries.some((name) => name !== "bin")) return

  const tmpDir = path.join(path.dirname(binDir), ".bin-wrapper")
  fs.rmSync(tmpDir, { recursive: true, force: true })
  fs.renameSync(wrappedBinDir, tmpDir)
  fs.rmSync(binDir, { recursive: true, force: true })
  fs.renameSync(tmpDir, binDir)
}
