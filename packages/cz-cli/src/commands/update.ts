/**
 * `cz-cli update` — manually update cz-cli to the latest version.
 *
 * Detects installation method (npm global vs standalone binary) and uses
 * the appropriate update mechanism.
 */

import { execSync } from "node:child_process"
import { existsSync } from "node:fs"
import { homedir, platform } from "node:os"
import { resolve, join } from "node:path"
import type { Argv } from "yargs"
import { VERSION } from "../version.js"

const REPO = "clickzetta/cz-cli"
const GITHUB_API = `https://api.github.com/repos/${REPO}/releases/latest`
const NPM_PACKAGE = "@clickzetta/cz-cli"

type InstallType = "npm-global" | "binary" | "dev"

function detectInstallType(): InstallType {
  const argv1 = process.argv[1] ?? ""
  if (argv1.endsWith(".ts")) return "dev"

  // Check if running from a node_modules path (npm global install)
  const exe = resolve(argv1)
  if (exe.includes("node_modules")) return "npm-global"

  // Check if the binary is in ~/.local/bin (standalone install)
  const installDir = resolve(join(homedir(), ".local", "bin"))
  if (exe.startsWith(installDir)) return "binary"

  // Fallback: check if npm knows about the package
  try {
    execSync(`npm list -g ${NPM_PACKAGE} --depth=0`, { stdio: "pipe" })
    return "npm-global"
  } catch {
    return "binary"
  }
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

function updateViaNpm(): boolean {
  try {
    process.stderr.write("Updating via npm...\n")
    execSync(`npm install -g ${NPM_PACKAGE}@latest --ignore-scripts=false`, { stdio: "inherit" })
    return true
  } catch {
    // Retry without strict dependency resolution (works around unrelated broken global packages)
    try {
      execSync(`npm install -g ${NPM_PACKAGE}@latest --force`, { stdio: "inherit" })
      return true
    } catch {
      return false
    }
  }
}

function updateViaBinary(version: string): boolean {
  const installUrl = `https://github.com/${REPO}/releases/latest/download/install.sh`
  try {
    process.stderr.write("Downloading and installing update...\n")
    execSync(`curl -fsSL "${installUrl}" | sh`, {
      env: { ...process.env, CZ_VERSION: version, NON_INTERACTIVE: "1", SKIP_PATH_PROMPT: "1" },
      stdio: ["ignore", "inherit", "inherit"],
      timeout: 300_000,
    })
    return true
  } catch {
    return false
  }
}

function migrateProfilesAfterUpdate(installType: InstallType): void {
  if (installType !== "binary") return
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

      const installType = detectInstallType()
      if (installType === "dev") {
        process.stderr.write("Cannot update development build.\n")
        process.exitCode = 1
        return
      }

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

      let ok: boolean
      if (installType === "npm-global") {
        ok = updateViaNpm()
      } else {
        ok = updateViaBinary(latest)
      }

      if (ok) {
        migrateProfilesAfterUpdate(installType)
        process.stderr.write(`✓ Updated to ${latest}. Restart cz-cli to use the new version.\n`)
      } else {
        process.stderr.write("Update failed. Try manually:\n")
        if (installType === "npm-global") {
          process.stderr.write(`  npm install -g ${NPM_PACKAGE}@latest\n`)
        } else {
          process.stderr.write(`  curl -fsSL https://github.com/${REPO}/releases/latest/download/install.sh | sh\n`)
        }
        process.exitCode = 1
      }
    },
  )
}
