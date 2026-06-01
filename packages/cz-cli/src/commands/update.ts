/**
 * `cz-cli update` — update cz-cli to the latest version via cz-cli.ai/install.sh.
 *
 * Flow:
 * 1. Fetch latest version from cz-cli.ai/api/stable (fallback: npm registry)
 * 2. Detect & clean up stale/conflicting binaries
 * 3. Perform upgrade via install script or package manager
 */

import { execSync } from "node:child_process"
import { unlinkSync, readSync, openSync, closeSync, readlinkSync, lstatSync } from "node:fs"
import type { Argv } from "yargs"
import { VERSION } from "../version.js"
import {
  installMethodFromExecPath,
  readInstallMetadata,
  performUpgrade,
  shouldUpgradeToVersion,
  writeInstallMetadata,
} from "../../../opencode/src/update/bootstrap"

const NPM_PACKAGE = "@clickzetta/cz-cli"

export function shouldApplyUpdate(currentVersion: string, latestVersion: string, force: boolean) {
  return force || shouldUpgradeToVersion(currentVersion, latestVersion)
}

function confirm(prompt: string): boolean {
  process.stderr.write(`${prompt} [y/N] `)
  const buf = Buffer.alloc(64)
  const fd = openSync("/dev/tty", "r")
  try {
    const n = readSync(fd, buf, 0, 64, null)
    return ["y", "yes"].includes(buf.toString("utf-8", 0, n).trim().toLowerCase())
  } catch {
    return false
  } finally {
    closeSync(fd)
  }
}

function findStaleBinaries(): string[] {
  try {
    return execSync("which -a cz-cli", { encoding: "utf-8", stdio: "pipe" }).trim().split("\n").filter(Boolean)
  } catch {
    return []
  }
}

function isPackageManagerBinary(p: string): boolean {
  if (p.includes("node_modules") || p.includes(".bun")) return true
  try {
    const npmPrefix = execSync("npm prefix -g", { encoding: "utf-8", stdio: "pipe" }).trim()
    if (p.startsWith(npmPrefix)) return true
  } catch {}
  try {
    const bunBin = execSync("bun pm bin -g", { encoding: "utf-8", stdio: "pipe" }).trim()
    if (p.startsWith(bunBin)) return true
  } catch {}
  try {
    if (lstatSync(p).isSymbolicLink() && readlinkSync(p).includes("node_modules")) return true
  } catch {}
  return false
}

function isCzCliInstallBinary(p: string): boolean {
  return p.includes(".cz-cli/bin")
}

function removeStaleBinary(p: string): boolean {
  try {
    unlinkSync(p)
    process.stderr.write(`  ✓ Removed: ${p}\n`)
    return true
  } catch {
    process.stderr.write(`  ✗ Failed to remove: ${p} (try manually: rm ${p})\n`)
    return false
  }
}

async function fetchLatestFromCzCliAi(channel: string): Promise<string> {
  const url = channel === "nightly" ? "https://cz-cli.ai/api/nightly" : "https://cz-cli.ai/api/stable"
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 5000)
  try {
    const resp = await fetch(url, { headers: { Accept: "application/json" }, signal: controller.signal })
    clearTimeout(timeout)
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
    const data = (await resp.json()) as { version?: string }
    if (!data.version) throw new Error("version field missing in response")
    return data.version
  } catch (err) {
    clearTimeout(timeout)
    throw err
  }
}

async function fetchLatestFromNpm(): Promise<string> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 5000)
  try {
    const resp = await fetch("https://registry.npmjs.org/@clickzetta/cz-cli/latest", {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    })
    clearTimeout(timeout)
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
    const data = (await resp.json()) as { version?: string }
    if (!data.version) throw new Error("version field missing in response")
    return data.version
  } catch (err) {
    clearTimeout(timeout)
    throw err
  }
}

export function registerUpdateCommand(cli: Argv) {
  cli.command(
    "update",
    "Update cz-cli to the latest version",
    (yargs) =>
      yargs.option("force", {
        type: "boolean",
        describe: "Force reinstall even if already up to date",
        default: false,
      }),
    async (argv) => {
      process.stderr.write(`Current version: ${VERSION}\n`)

      if (VERSION.includes("-dev") && !argv.force) {
        process.stderr.write("Cannot update development build. Use --force to override.\n")
        process.exitCode = 1
        return
      }

      const metadata = await readInstallMetadata()
      const method = metadata?.method ?? installMethodFromExecPath(process.execPath)
      const channel = metadata?.channel ?? "stable"

      // --- Step 1: Fetch latest version (cz-cli.ai → npm fallback) ---
      process.stderr.write("Checking for updates...\n")
      let latest: string | undefined
      try {
        latest = await fetchLatestFromCzCliAi(channel)
        process.stderr.write(`  [cz-cli.ai] Latest version: ${latest}\n`)
      } catch (err) {
        process.stderr.write(`  [cz-cli.ai] Failed: ${err instanceof Error ? err.message : String(err)}\n`)
        process.stderr.write("  Falling back to npm registry...\n")
        try {
          latest = await fetchLatestFromNpm()
          process.stderr.write(`  [npm] Latest version: ${latest}\n`)
        } catch (npmErr) {
          process.stderr.write(`  [npm] Failed: ${npmErr instanceof Error ? npmErr.message : String(npmErr)}\n`)
        }
      }

      if (!latest) {
        process.stderr.write("Failed to check for updates from all sources.\n")
        process.stderr.write("Try manually: curl -fsSL https://cz-cli.ai/install | bash\n")
        process.exitCode = 1
        return
      }

      if (!shouldApplyUpdate(VERSION, latest, argv.force)) {
        if (latest === VERSION) {
          process.stderr.write(`Already up to date (${VERSION}).\n`)
          return
        }
        process.stderr.write(`Refusing to downgrade: ${VERSION} → ${latest}\n`)
        process.stderr.write("The release channel appears to be pointing to an older version.\n")
        process.exitCode = 1
        return
      }

      process.stderr.write(`${latest === VERSION ? "Reinstalling" : "Updating"}: ${VERSION} → ${latest}\n`)

      // --- Step 2: Detect & clean up stale/conflicting binaries ---
      const allBinaries = findStaleBinaries()
      const currentExec = process.execPath
      // Filter out: current binary, anything inside node_modules (local dev deps), duplicates
      const staleBinaries = [...new Set(allBinaries)].filter((p) => {
        if (p === currentExec) return false
        if (p.includes("node_modules")) return false
        // If current method is curl (cz-cli.ai install), stale = package manager global binaries
        if (method === "curl") return isPackageManagerBinary(p)
        // If current method is npm/bun, stale = cz-cli.ai binaries or other unmanaged binaries
        return isCzCliInstallBinary(p) || (!isPackageManagerBinary(p) && p !== currentExec)
      })

      if (staleBinaries.length > 0) {
        process.stderr.write("\n⚠ Found conflicting cz-cli binaries:\n")
        staleBinaries.forEach((p) => {
          const kind = isPackageManagerBinary(p) ? "(package manager)" : isCzCliInstallBinary(p) ? "(cz-cli.ai install)" : "(unknown)"
          process.stderr.write(`  ${p} ${kind}\n`)
        })
        process.stderr.write("\nMultiple installations can cause version conflicts after update.\n")
        if (process.stderr.isTTY && confirm("Remove these conflicting binaries?")) {
          staleBinaries.forEach(removeStaleBinary)
        } else if (!process.stderr.isTTY) {
          process.stderr.write("  Non-interactive mode: skipping cleanup. Remove manually if needed.\n")
        } else {
          process.stderr.write("  Skipped cleanup. You may see version conflicts.\n")
        }
        process.stderr.write("\n")
      }

      // --- Step 3: Perform upgrade ---
      try {
        process.stderr.write(`Upgrading via install script...\n`)
        await performUpgrade(method, latest, fetch, channel)
        await writeInstallMetadata({ method, binary_version: latest })
        process.stderr.write(`✓ Updated to ${latest}. Restart cz-cli to use the new version.\n`)
      } catch (err) {
        process.stderr.write(`Update failed: ${err instanceof Error ? err.message : String(err)}\n`)
        process.stderr.write("Try manually: curl -fsSL https://cz-cli.ai/install | bash\n")
        process.exitCode = 1
      }
    },
  )
}
