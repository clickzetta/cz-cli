/**
 * `cz-cli update` — update cz-cli to the latest version via cz-cli.ai/install.sh.
 *
 * Flow:
 * 1. Fetch latest version from cz-cli.ai/api/stable (fallback: npm registry)
 * 2. Detect & clean up stale/conflicting binaries
 * 3. Perform upgrade via install script or package manager
 */

import { execFileSync, execSync } from "node:child_process"
import { unlinkSync, readSync, openSync, closeSync, readlinkSync, lstatSync, copyFileSync, chmodSync, statSync } from "node:fs"
import path from "node:path"
import type { Argv } from "yargs"
import { VERSION } from "../version.js"
import { renderOutput } from "../output/index.js"
import {
  type InstallMethod,
  installMethodFromExecPath,
  performUpgrade,
  resolveReleaseChannel,
  shouldUpgradeToVersion,
  writeInstallMetadata,
} from "../../../opencode/src/update/bootstrap"

export function shouldApplyUpdate(currentVersion: string, latestVersion: string, force: boolean) {
  return force || shouldUpgradeToVersion(currentVersion, latestVersion)
}

function readBinaryVersion(binaryPath: string) {
  try {
    return execFileSync(binaryPath, ["--version"], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim()
  } catch {
    return undefined
  }
}

export function assertUpdatedBinaryVersion(binaryPath: string | undefined, targetVersion: string) {
  if (!binaryPath) throw new Error(`Unable to locate cz-cli after update; expected ${targetVersion}`)
  const actualVersion = readBinaryVersion(binaryPath)
  if (actualVersion !== targetVersion) {
    throw new Error(`Installed cz-cli version mismatch at ${binaryPath}: expected ${targetVersion}, got ${actualVersion ?? "unavailable"}`)
  }
}

/**
 * `update` is a maintenance command whose human-facing progress goes to stderr.
 * For scripts/agents we also emit a structured terminal result to stdout — but
 * only when the output is machine-bound (explicit --format, or non-TTY stdout),
 * so an interactive user still sees only the clean stderr narrative.
 */
interface UpdateArgs {
  format?: string
  format_explicit?: boolean
  field?: string
}

function isMachineReadable(argv: UpdateArgs): boolean {
  return !!argv.format_explicit || !process.stdout.isTTY
}

function emitUpdateResult(
  rawArgv: Record<string, unknown>,
  data: Record<string, unknown>,
  aiMessage?: string,
): void {
  const argv: UpdateArgs = {
    format: typeof rawArgv.format === "string" ? rawArgv.format : undefined,
    format_explicit: rawArgv.format_explicit === true,
    field: typeof rawArgv.field === "string" ? rawArgv.field : undefined,
  }
  if (!isMachineReadable(argv)) return
  const payload: Record<string, unknown> = { data }
  if (aiMessage) payload.ai_message = aiMessage
  const output = renderOutput(payload, argv.format, argv.field)
  if (output) process.stdout.write(output + "\n")
}

export function manualInstallCommandForPlatform(platform: NodeJS.Platform = process.platform, channel = "stable") {
  if (platform === "win32") {
    const script = channel === "nightly" ? "install-nightly.ps1" : "install.ps1"
    return `powershell -NoProfile -ExecutionPolicy Bypass -Command "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; iex ((New-Object Net.WebClient).DownloadString('https://cz-cli.ai/${script}'))"`
  }
  const script = channel === "nightly" ? "install-nightly.sh" : "install.sh"
  return `curl -fsSL https://cz-cli.ai/${script} | bash`
}

type UpdateErrorContext = {
  timeoutMs?: number
  url?: string
}

type BinaryDetectionInput = {
  npmPrefix?: string
  bunBin?: string
  readlink?: (p: string) => string
  isSymlink?: (p: string) => boolean
}

export function describeUpdateError(error: unknown, context: UpdateErrorContext = {}) {
  const name = error instanceof Error ? error.name : undefined
  const message = error instanceof Error ? error.message : String(error)
  const parts = name === "AbortError" && context.timeoutMs
    ? [`request timed out after ${context.timeoutMs}ms`]
    : [name ? `${name}: ${message}` : message]
  if (context.url) parts.push(`url=${context.url}`)
  if (name === "AbortError") parts.push(`error=${name}: ${message}`)
  return parts.join("; ")
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

export function isPackageManagerBinary(p: string, input: BinaryDetectionInput = {}): boolean {
  if (p.includes("node_modules") || p.includes(".bun")) return true
  const linkTarget = (() => {
    try {
      if (!(input.isSymlink ?? ((candidate) => lstatSync(candidate).isSymbolicLink()))(p)) return undefined
      return path.resolve(path.dirname(p), (input.readlink ?? readlinkSync)(p))
    } catch {
      return undefined
    }
  })()
  if (linkTarget && (linkTarget.includes("node_modules") || linkTarget.includes(".bun"))) return true
  const npmPrefix = input.npmPrefix ?? (() => {
    try {
      return execSync("npm prefix -g", { encoding: "utf-8", stdio: "pipe" }).trim()
    } catch {
      return undefined
    }
  })()
  if (npmPrefix && p.startsWith(npmPrefix)) return true
  const bunBin = input.bunBin ?? (() => {
    try {
      return execSync("bun pm bin -g", { encoding: "utf-8", stdio: "pipe" }).trim()
    } catch {
      return undefined
    }
  })()
  if (bunBin && p.startsWith(bunBin)) return true
  if (p.includes(`${path.sep}.npm-global${path.sep}bin${path.sep}`)) return true
  return false
}

export function isCzCliInstallBinary(p: string): boolean {
  return p.includes(`${path.sep}.local${path.sep}bin${path.sep}`)
}

export function resolveUpdateInstallMethod(execPath: string, binaries: string[], input: BinaryDetectionInput = {}): InstallMethod {
  // Prioritize `which cz-cli` (binaries[0]) as it reflects what the user actually runs
  const first = binaries[0]
  if (first) {
    if (isPackageManagerBinary(first, input)) return first.includes(".bun") ? "bun" : "npm"
    if (isCzCliInstallBinary(first)) return "curl"
  }
  const method = installMethodFromExecPath(execPath)
  if (method !== "unknown") return method
  return "unknown"
}

function removeStaleBinary(p: string): boolean {
  if (isPackageManagerBinary(p)) {
    const cmd = p.includes(".bun") ? "bun remove -g @clickzetta/cz-cli" : "npm uninstall -g @clickzetta/cz-cli"
    try {
      execSync(cmd, { stdio: "pipe" })
      process.stderr.write(`  ✓ Uninstalled via: ${cmd}\n`)
      return true
    } catch {
      process.stderr.write(`  ✗ Failed (try manually: ${cmd})\n`)
      return false
    }
  }
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
  const timeoutMs = 5000
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const resp = await fetch(url, { headers: { Accept: "application/json" }, signal: controller.signal })
    clearTimeout(timeout)
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
    const data = (await resp.json()) as { version?: string }
    if (!data.version) throw new Error("version field missing in response")
    return data.version
  } catch (err) {
    clearTimeout(timeout)
    throw new Error(describeUpdateError(err, { timeoutMs, url }))
  }
}

async function fetchLatestFromNpm(): Promise<string> {
  const url = "https://registry.npmjs.org/@clickzetta/cz-cli/latest"
  const timeoutMs = 5000
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const resp = await fetch(url, {
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
    throw new Error(describeUpdateError(err, { timeoutMs, url }))
  }
}

export function registerUpdateCommand(cli: Argv) {
  cli.command(
    "update",
    "Update cz-cli to the latest version",
    (yargs) =>
      yargs
        .option("force", {
          type: "boolean",
          describe: "Force reinstall even if already up to date",
          default: false,
        })
        .option("target", {
          type: "string",
          alias: "t",
          describe: "Install a specific version (allows downgrade), e.g. 0.5.1",
        }),
    async (argv) => {
      process.stderr.write(`Current version: ${VERSION}\n`)

      if (VERSION.includes("-dev") && !argv.force) {
        process.stderr.write("Cannot update development build. Use --force to override.\n")
        emitUpdateResult(argv, {
          current_version: VERSION,
          latest_version: null,
          updated: false,
          reason: "development_build",
        }, "Cannot update development build. Use --force to override.")
        process.exitCode = 1
        return
      }

      const channel = await resolveReleaseChannel()

      // --- Step 1: Fetch latest version (cz-cli.ai → npm fallback) ---
      process.stderr.write("Checking for updates...\n")
      let latest: string | undefined
      if (argv.target) {
        latest = argv.target.replace(/^v/, "")
        process.stderr.write(`  Requested version: ${latest}\n`)
      } else {
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
      }

      if (!latest) {
        process.stderr.write("Failed to check for updates from all sources.\n")
        process.stderr.write(`Try manually: ${manualInstallCommandForPlatform(process.platform, channel)}\n`)
        emitUpdateResult(argv, {
          current_version: VERSION,
          latest_version: null,
          updated: false,
          reason: "check_failed",
        }, `Failed to check for updates. Try manually: ${manualInstallCommandForPlatform(process.platform, channel)}`)
        process.exitCode = 1
        return
      }

      if (!shouldApplyUpdate(VERSION, latest, argv.force || !!argv.target)) {
        if (latest === VERSION) {
          process.stderr.write(`Already up to date (${VERSION}).\n`)
          emitUpdateResult(argv, {
            current_version: VERSION,
            latest_version: latest,
            updated: false,
            reason: "already_latest",
          }, `Already up to date (${VERSION}).`)
          return
        }
        process.stderr.write(`Refusing to downgrade: ${VERSION} → ${latest}\n`)
        process.stderr.write("The release channel appears to be pointing to an older version.\n")
        process.stderr.write("Use --target <ver> to explicitly downgrade.\n")
        emitUpdateResult(argv, {
          current_version: VERSION,
          latest_version: latest,
          updated: false,
          reason: "refuse_downgrade",
        }, `Refusing to downgrade ${VERSION} → ${latest}. Use --target ${latest} to explicitly downgrade.`)
        process.exitCode = 1
        return
      }

      process.stderr.write(`${latest === VERSION ? "Reinstalling" : "Updating"}: ${VERSION} → ${latest}\n`)

      // --- Step 2: Detect & clean up stale/conflicting binaries ---
      const allBinaries = findStaleBinaries()
      const method = resolveUpdateInstallMethod(process.execPath, allBinaries)
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
        // Pre-upgrade: if `which cz-cli` resolves to a path outside our managed
        // install dir, remove it properly so the newly installed binary takes priority.
        const whichPath = (() => {
          try { return execSync("which cz-cli", { encoding: "utf-8", stdio: "pipe" }).trim() } catch { return undefined }
        })()
        if (whichPath && !isCzCliInstallBinary(whichPath) && whichPath !== currentExec) {
          removeStaleBinary(whichPath)
        }

        const label = ["npm", "pnpm", "yarn", "bun"].includes(method) ? method : "install script"
        process.stderr.write(`Upgrading via ${label}...\n`)
        await performUpgrade(method, latest, fetch, channel, argv.force)

        // Post-upgrade fixup: if install.sh placed the binary in a different dir
        // than where `which cz-cli` resolves, copy it to the right place.
        const postWhich = (() => {
          try { return execSync("which cz-cli", { encoding: "utf-8", stdio: "pipe" }).trim() } catch { return undefined }
        })()
        if (postWhich) {
          const postVersion = (() => {
            try { return readBinaryVersion(postWhich) } catch { return undefined }
          })()
          if (postVersion !== latest) {
            // Find the freshly installed binary
            const candidates = [
              path.join(process.env.HOME || "", ".local", "bin", "cz-cli"),
            ]
            for (const candidate of candidates) {
              try {
                if (!statSync(candidate).isFile()) continue
                const ver = readBinaryVersion(candidate)
                if (ver === latest) {
                  copyFileSync(candidate, postWhich)
                  chmodSync(postWhich, 0o755)
                  process.stderr.write(`  ✓ Synced binary at ${postWhich}\n`)
                  break
                }
              } catch {}
            }
          }
        }

        assertUpdatedBinaryVersion(postWhich ?? currentExec, latest)
        await writeInstallMetadata({ binary_version: latest, channel })
        process.stderr.write(`✓ Updated to ${latest}. Restart cz-cli to use the new version.\n`)
        emitUpdateResult(argv, {
          current_version: VERSION,
          latest_version: latest,
          updated: true,
          reason: latest === VERSION ? "reinstalled" : "updated",
        }, `Updated to ${latest}. Restart cz-cli to use the new version.`)
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err)
        process.stderr.write(`Update failed: ${detail}\n`)
        process.stderr.write(`Try manually: ${manualInstallCommandForPlatform(process.platform, channel)}\n`)
        emitUpdateResult(argv, {
          current_version: VERSION,
          latest_version: latest,
          updated: false,
          reason: "upgrade_failed",
          error: detail,
        }, `Update failed: ${detail}. Try manually: ${manualInstallCommandForPlatform(process.platform, channel)}`)
        process.exitCode = 1
      }
    },
  )
}
