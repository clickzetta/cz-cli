/**
 * `cz-cli update` — manually update cz-cli to the latest version.
 *
 * Detects installation method (npm global, bun global, or standalone binary)
 * and uses the appropriate update mechanism. Detects conflicts when both npm
 * and bun have the package installed globally.
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
const REGISTRY = "--registry https://registry.npmjs.org"

type InstallType = "npm" | "bun" | "binary" | "dev"

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

function detectInstallType(): InstallType | "conflict" {
  const argv1 = process.argv[1] ?? ""
  if (argv1.endsWith(".ts")) return "dev"

  const exe = resolve(argv1)

  // Check if running from bun global bin
  try {
    const bunBin = execSync("bun pm bin -g", { encoding: "utf-8", stdio: "pipe" }).trim()
    if (exe.startsWith(bunBin)) {
      if (hasNpmGlobal()) return "conflict"
      return "bun"
    }
  } catch {}

  // Check if running from npm global (node_modules path)
  if (exe.includes("node_modules")) {
    if (hasBunGlobal()) return "conflict"
    return "npm"
  }

  // Check standalone binary
  const installDir = resolve(join(homedir(), ".local", "bin"))
  if (exe.startsWith(installDir)) return "binary"

  // Fallback detection
  const npm = hasNpmGlobal()
  const bun = hasBunGlobal()
  if (npm && bun) return "conflict"
  if (bun) return "bun"
  if (npm) return "npm"
  return "binary"
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
    execSync(`npm install -g ${NPM_PACKAGE}@latest --ignore-scripts=false ${REGISTRY}`, { stdio: "inherit" })
    return true
  } catch {
    try {
      execSync(`npm install -g ${NPM_PACKAGE}@latest --force ${REGISTRY}`, { stdio: "inherit" })
      return true
    } catch {
      return false
    }
  }
}

function updateViaBun(): boolean {
  try {
    process.stderr.write("Updating via bun...\n")
    execSync(`bun install -g ${NPM_PACKAGE}@latest`, { stdio: "inherit" })
    return true
  } catch {
    return false
  }
}

function updateViaBinary(version: string): boolean {
  const installUrl = `https://github.com/${REPO}/releases/latest/download/install.sh`
  const binary = join(homedir(), ".local", "bin", platform() === "win32" ? "cz-cli.exe" : "cz-cli")
  try {
    process.stderr.write("Downloading and installing update...\n")
    const tmpScript = execSync("mktemp", { encoding: "utf-8" }).trim()
    execSync(`curl -fsSL --retry 2 -o "${tmpScript}" "${installUrl}"`, {
      stdio: ["ignore", "inherit", "inherit"],
      timeout: 60_000,
    })
    execSync(`sh "${tmpScript}"`, {
      env: { ...process.env, CZ_VERSION: version, NON_INTERACTIVE: "1", SKIP_PATH_PROMPT: "1" },
      stdio: ["ignore", "inherit", "inherit"],
      timeout: 300_000,
    })
    execSync(`rm -f "${tmpScript}"`, { stdio: "ignore" })
  } catch {
    return false
  }
  try {
    const installed = execSync(`"${binary}" --version`, { encoding: "utf-8", timeout: 10_000 }).trim()
    if (installed !== version) {
      process.stderr.write(`Verification failed: expected ${version}, got ${installed}.\n`)
      return false
    }
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

      if (installType === "conflict") {
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
      if (installType === "bun") {
        ok = updateViaBun()
      } else if (installType === "npm") {
        ok = updateViaNpm()
      } else {
        ok = updateViaBinary(latest)
      }

      if (ok) {
        migrateProfilesAfterUpdate(installType)
        process.stderr.write(`✓ Updated to ${latest}. Restart cz-cli to use the new version.\n`)
      } else {
        process.stderr.write("Update failed. Try manually:\n")
        if (installType === "bun") {
          process.stderr.write(`  bun install -g ${NPM_PACKAGE}@latest\n`)
        } else if (installType === "npm") {
          process.stderr.write(`  npm install -g ${NPM_PACKAGE}@latest ${REGISTRY}\n`)
        } else {
          process.stderr.write(`  curl -fsSL https://github.com/${REPO}/releases/latest/download/install.sh | sh\n`)
        }
        process.exitCode = 1
      }
    },
  )
}
