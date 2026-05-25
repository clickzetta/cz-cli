/**
 * `cz-cli update` — manually update cz-cli to the latest version.
 *
 * Detection flow:
 * 1. Check if npm global has the package
 * 2. Check if bun global has the package
 * 3. If both → error, ask user to uninstall one
 * 4. If one → use that package manager to update
 * 5. If neither → clean up stale binaries via `which`, then install via npm
 */

import { execSync } from "node:child_process"
import { existsSync, unlinkSync, readSync, openSync, closeSync, readlinkSync, lstatSync } from "node:fs"
import { homedir, platform } from "node:os"
import { join } from "node:path"
import type { Argv } from "yargs"
import { VERSION } from "../version.js"

const REPO = "clickzetta/cz-cli"
const GITHUB_API = `https://api.github.com/repos/${REPO}/releases/latest`
const NPM_PACKAGE = "@clickzetta/cz-cli"
const REGISTRY = "--registry https://registry.npmjs.org"

function confirm(prompt: string): boolean {
  process.stderr.write(`${prompt} [y/N] `)
  const buf = Buffer.alloc(64)
  const fd = openSync("/dev/tty", "r")
  try {
    const n = readSync(fd, buf, 0, 64, null)
    const answer = buf.toString("utf-8", 0, n).trim().toLowerCase()
    return answer === "y" || answer === "yes"
  } catch {
    return false
  } finally {
    closeSync(fd)
  }
}

function hasNpmGlobal(): boolean {
  try {
    execSync(`npm list -g ${NPM_PACKAGE} --depth=0`, { stdio: "pipe" })
    return true
  } catch {
    return false
  }
}

function hasBunGlobal(): boolean {
  try {
    const bunBin = execSync("bun pm bin -g", { encoding: "utf-8", stdio: "pipe" }).trim()
    return existsSync(join(bunBin, "cz-cli"))
  } catch {
    return false
  }
}

function findStaleBinaries(): string[] {
  try {
    const output = execSync("which -a cz-cli", { encoding: "utf-8", stdio: "pipe" }).trim()
    return output ? output.split("\n").filter(Boolean) : []
  } catch {
    return []
  }
}

function isPackageManagerBinary(p: string): boolean {
  if (p.includes("node_modules") || p.includes(".bun")) return true
  // Check npm global bin prefix
  try {
    const npmPrefix = execSync("npm prefix -g", { encoding: "utf-8", stdio: "pipe" }).trim()
    if (p.startsWith(npmPrefix)) return true
  } catch {}
  // Check bun global bin
  try {
    const bunBin = execSync("bun pm bin -g", { encoding: "utf-8", stdio: "pipe" }).trim()
    if (p.startsWith(bunBin)) return true
  } catch {}
  // Check if symlink pointing into node_modules
  try {
    if (lstatSync(p).isSymbolicLink()) {
      const target = readlinkSync(p)
      if (target.includes("node_modules")) return true
    }
  } catch {}
  return false
}

function removeStaleBinary(path: string): boolean {
  try {
    unlinkSync(path)
    process.stderr.write(`  Removed stale binary: ${path}\n`)
    return true
  } catch {
    process.stderr.write(`  Failed to remove: ${path} (try manually: rm ${path})\n`)
    return false
  }
}

function isDev(): boolean {
  return (process.argv[1] ?? "").endsWith(".ts")
}

async function fetchLatestVersion(): Promise<string | null> {
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 5000)
    const resp = await fetch(GITHUB_API, {
      headers: { Accept: "application/vnd.github.v3+json" },
      signal: controller.signal,
    })
    clearTimeout(timeout)
    if (!resp.ok) return null
    const data = (await resp.json()) as { tag_name?: string }
    return data.tag_name?.replace(/^v/, "") ?? null
  } catch {
    return null
  }
}

function updateViaNpm(version: string): boolean {
  try {
    process.stderr.write("Updating via npm...\n")
    execSync(`npm install -g ${NPM_PACKAGE}@${version} --ignore-scripts=false ${REGISTRY}`, { stdio: "inherit" })
    return true
  } catch {
    try {
      execSync(`npm install -g ${NPM_PACKAGE}@${version} --force ${REGISTRY}`, { stdio: "inherit" })
      return true
    } catch {
      return false
    }
  }
}

function updateViaBun(version: string): boolean {
  try {
    process.stderr.write("Updating via bun...\n")
    execSync(`bun install -g ${NPM_PACKAGE}@${version}`, { stdio: "inherit" })
    return true
  } catch {
    return false
  }
}

function migrateProfilesAfterUpdate(): void {
  const binary = join(homedir(), ".local", "bin", platform() === "win32" ? "cz-cli.exe" : "cz-cli")
  if (!existsSync(binary)) return
  try {
    execSync(`"${binary}"`, {
      env: { ...process.env, CLICKZETTA_MIGRATE_PROFILES_ONLY: "1" },
      stdio: "ignore",
    })
  } catch {}
}

export function registerUpdateCommand(cli: Argv) {
  cli.command(
    "update",
    "Update cz-cli to the latest version",
    (yargs) => yargs,
    async () => {
      process.stderr.write(`Current version: ${VERSION}\n`)

      if (isDev()) {
        process.stderr.write("Cannot update development build.\n")
        process.exitCode = 1
        return
      }

      // Step 1: Detect install sources
      const npm = hasNpmGlobal()
      const bun = hasBunGlobal()

      // Step 2: Conflict check
      if (npm && bun) {
        process.stderr.write(
          "Conflict: cz-cli is installed via both npm and bun.\n" +
          "Please uninstall one to avoid version conflicts:\n" +
          `  npm uninstall -g ${NPM_PACKAGE}\n` +
          "  or\n" +
          `  bun remove -g ${NPM_PACKAGE}\n`,
        )
        process.exitCode = 1
        return
      }

      // Step 3: Check for updates
      process.stderr.write("Checking for updates...\n")
      const latest = await fetchLatestVersion()
      if (!latest) {
        process.stderr.write("Failed to check for updates. Check your network connection.\n")
        process.exitCode = 1
        return
      }

      if (latest === VERSION) {
        process.stderr.write(`Already up to date (${VERSION}).\n`)
        return
      }

      process.stderr.write(`New version available: ${VERSION} → ${latest}\n`)

      // Step 4: If managed by npm or bun, uninstall first then reinstall
      if (npm) {
        // Clean up any stale non-npm binaries
        const stale = findStaleBinaries().filter((p) => !isPackageManagerBinary(p))
        if (stale.length > 0) {
          process.stderr.write("Found outdated cz-cli binaries not managed by npm:\n")
          stale.forEach((p) => process.stderr.write(`  ${p}\n`))
          if (confirm("Remove these outdated binaries to avoid conflicts?")) {
            stale.forEach(removeStaleBinary)
          }
        }
        if (updateViaNpm(latest)) {
          migrateProfilesAfterUpdate()
          process.stderr.write(`✓ Updated to ${latest}. Restart cz-cli to use the new version.\n`)
        } else {
          process.stderr.write(`Update failed. Try manually:\n  npm install -g ${NPM_PACKAGE}@${latest} ${REGISTRY}\n`)
          process.exitCode = 1
        }
        return
      }

      if (bun) {
        // Clean up any stale non-bun binaries
        const stale = findStaleBinaries().filter((p) => !isPackageManagerBinary(p))
        if (stale.length > 0) {
          process.stderr.write("Found outdated cz-cli binaries not managed by bun:\n")
          stale.forEach((p) => process.stderr.write(`  ${p}\n`))
          if (confirm("Remove these outdated binaries to avoid conflicts?")) {
            stale.forEach(removeStaleBinary)
          }
        }
        if (updateViaBun(latest)) {
          migrateProfilesAfterUpdate()
          process.stderr.write(`✓ Updated to ${latest}. Restart cz-cli to use the new version.\n`)
        } else {
          process.stderr.write(`Update failed. Try manually:\n  bun install -g ${NPM_PACKAGE}@${latest}\n`)
          process.exitCode = 1
        }
        return
      }

      // Step 5: Neither npm nor bun — clean up all stale binaries, then install via npm
      const allBinaries = findStaleBinaries()
      if (allBinaries.length > 0) {
        process.stderr.write("No npm/bun installation found. Found outdated cz-cli binaries:\n")
        allBinaries.forEach((p) => process.stderr.write(`  ${p}\n`))
        if (confirm("Remove these outdated binaries before reinstalling?")) {
          allBinaries.forEach(removeStaleBinary)
        } else {
          process.stderr.write("Aborted. Remove old binaries manually, then run:\n")
          process.stderr.write(`  npm install -g ${NPM_PACKAGE}@${latest} ${REGISTRY}\n`)
          process.exitCode = 1
          return
        }
      }

      // Verify cleanup
      const remaining = findStaleBinaries()
      if (remaining.length > 0) {
        process.stderr.write(`Could not remove all old binaries. Please delete manually:\n`)
        remaining.forEach((p) => process.stderr.write(`  rm ${p}\n`))
        process.stderr.write(`Then run: npm install -g ${NPM_PACKAGE}@${latest} ${REGISTRY}\n`)
        process.exitCode = 1
        return
      }

      // Fresh install via npm
      process.stderr.write("Installing via npm...\n")
      if (updateViaNpm(latest)) {
        migrateProfilesAfterUpdate()
        process.stderr.write(`✓ Installed ${latest}. Restart your shell to use cz-cli.\n`)
      } else {
        process.stderr.write(`Install failed. Try manually:\n  npm install -g ${NPM_PACKAGE}@${latest} ${REGISTRY}\n`)
        process.exitCode = 1
      }
    },
  )
}
