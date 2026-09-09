/**
 * `cz-cli update` — update cz-cli to the latest version via cz-cli.ai/install.sh.
 *
 * Flow:
 * 1. Resolve the release channel (--channel overrides and re-pins the stored one)
 * 2. Fetch the latest version for THAT channel from cz-cli.ai/api/<channel>
 * 3. Detect & clean up stale/conflicting binaries
 * 4. Perform upgrade via install script or package manager
 *
 * The version source never crosses channels. npm's `latest` dist-tag is the
 * stable stream, so it is only usable as a fallback when the requested channel
 * is stable; on nightly, a failed check fails the command instead of quietly
 * substituting a stable version.
 */

import { execSync, execFileSync } from "node:child_process"
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
  writeInstallMetadata,
} from "../bootstrap/update.js"
import {
  RELEASE_CHANNELS,
  type ReleaseChannel,
  assertVersionInChannel,
  coerceChannel,
  channelForVersion,
  isLocalBuildVersion,
  shouldUpgradeToVersion,
} from "../bootstrap/release-version.js"

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

/** Post-update gate: fail loudly if the on-PATH binary does not actually report the
 *  target version, instead of reporting a false "✓ Updated". Ported from origin/main —
 *  dropped during the a2 rebase. */
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

export function manualInstallCommandForPlatform(platform: NodeJS.Platform = process.platform, channel: ReleaseChannel = "stable") {
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

async function fetchLatestFromCzCliAi(channel: ReleaseChannel): Promise<string> {
  const url = `https://cz-cli.ai/api/${channel}`
  const timeoutMs = 5000
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const resp = await fetch(url, { headers: { Accept: "application/json" }, signal: controller.signal })
    clearTimeout(timeout)
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
    const data = (await resp.json()) as { version?: string }
    if (!data.version) throw new Error("version field missing in response")
    return assertVersionInChannel(data.version, channel, url)
  } catch (err) {
    clearTimeout(timeout)
    throw new Error(describeUpdateError(err, { timeoutMs, url }))
  }
}

/**
 * npm's `latest` dist-tag mirrors the STABLE stream only, and it has been
 * observed lagging cz-cli.ai (site 2.0.4 vs npm 2.0.0). It is a same-channel
 * mirror of last resort, never a cross-channel substitute.
 */
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
    return assertVersionInChannel(data.version, "stable", url)
  } catch (err) {
    clearTimeout(timeout)
    throw new Error(describeUpdateError(err, { timeoutMs, url }))
  }
}

/**
 * Nightly can stall: if the stream stops moving, `already up to date` is the
 * only thing the user ever sees and they rot on a stale build. Whenever we
 * report nightly as current, also report where stable is so the dead end is
 * visible, along with the one command that gets out of it.
 */
export function describeStableAlternative(current: string, stableLatest: string | undefined) {
  if (!stableLatest) return undefined
  if (!shouldUpgradeToVersion(current, stableLatest)) return undefined
  return `The stable channel is at ${stableLatest}. Switch with: cz-cli update --channel stable`
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
        })
        .option("channel", {
          type: "string",
          choices: RELEASE_CHANNELS as readonly string[],
          describe: "Switch release channel and update to its latest version (persisted)",
        }),
    async (argv) => {
      process.stderr.write(`Current version: ${VERSION}\n`)

      // Unpublished builds (0.0.0-<branch>-<ts> from a worktree build, or
      // 0.0.0-dev+<ts> under `bun run`) have no update target in any channel.
      if (isLocalBuildVersion(VERSION) && !argv.force) {
        process.stderr.write("Cannot update a local development build. Use --force to override.\n")
        emitUpdateResult(argv, {
          current_version: VERSION,
          latest_version: null,
          updated: false,
          reason: "development_build",
        }, "Cannot update a local development build. Use --force to override.")
        process.exitCode = 1
        return
      }

      const storedChannel = await resolveReleaseChannel()
      const requestedChannel = coerceChannel(argv.channel)
      const channel: ReleaseChannel = requestedChannel ?? storedChannel
      const switchingChannel = requestedChannel !== undefined && requestedChannel !== storedChannel
      // The installed binary can already be from another channel than the one we
      // are pinned to — a --channel switch whose download failed, or an install
      // script that rewrote the stored channel without replacing the binary.
      // That is a pending switch, not a downgrade, so it authorizes the move;
      // otherwise a bare `update` would report a stable version as "up to date
      // on the nightly channel" and strand the user there forever.
      const pendingChannelSwitch = channelForVersion(VERSION) !== channel
      if (switchingChannel) {
        // Persist the preference before doing any work: an explicit --channel is
        // the user re-pinning the channel, and it must survive a failed download
        // instead of silently reverting on the next run.
        await writeInstallMetadata({ channel })
        process.stderr.write(`Switching channel: ${storedChannel} → ${channel}\n`)
      } else {
        process.stderr.write(`Channel: ${channel}\n`)
      }

      // --- Step 1: Fetch latest version for this channel (no cross-channel fallback) ---
      process.stderr.write("Checking for updates...\n")
      let latest: string | undefined
      if (argv.target) {
        latest = argv.target.replace(/^v/, "")
        process.stderr.write(`  Requested version: ${latest}\n`)
      } else {
        try {
          latest = await fetchLatestFromCzCliAi(channel)
          process.stderr.write(`  [cz-cli.ai] Latest ${channel} version: ${latest}\n`)
        } catch (err) {
          process.stderr.write(`  [cz-cli.ai] Failed: ${err instanceof Error ? err.message : String(err)}\n`)
          if (channel === "stable") {
            process.stderr.write("  Falling back to npm registry (stable mirror)...\n")
            try {
              latest = await fetchLatestFromNpm()
              process.stderr.write(`  [npm] Latest version: ${latest}\n`)
            } catch (npmErr) {
              process.stderr.write(`  [npm] Failed: ${npmErr instanceof Error ? npmErr.message : String(npmErr)}\n`)
            }
          } else {
            // npm's `latest` is the stable stream. Substituting it here would
            // move a nightly install onto stable on a single network blip.
            process.stderr.write(`  No same-channel fallback for ${channel}; not falling back to the stable npm registry.\n`)
          }
        }
      }

      if (!latest) {
        process.stderr.write(`Failed to check for updates on the ${channel} channel.\n`)
        process.stderr.write(`Try manually: ${manualInstallCommandForPlatform(process.platform, channel)}\n`)
        emitUpdateResult(argv, {
          current_version: VERSION,
          channel,
          latest_version: null,
          updated: false,
          reason: "check_failed",
        }, `Failed to check for updates on the ${channel} channel. Try manually: ${manualInstallCommandForPlatform(process.platform, channel)}`)
        process.exitCode = 1
        return
      }

      if (pendingChannelSwitch && !switchingChannel) {
        process.stderr.write(
          `Installed ${VERSION} is a ${channelForVersion(VERSION) ?? "unknown"}-channel build but this install is pinned to ${channel}; completing the switch.\n`,
        )
      }

      // An explicit --channel switch (or an already-crossed install) authorizes a
      // move across streams the same way --target authorizes an explicit version.
      if (!shouldApplyUpdate(VERSION, latest, argv.force || !!argv.target || switchingChannel || pendingChannelSwitch)) {
        if (latest === VERSION) {
          process.stderr.write(`Already up to date (${VERSION}) on the ${channel} channel.\n`)
          // Nightly can stall; surface where stable is so this is not a dead end.
          const stableLatest = channel === "stable"
            ? undefined
            : await fetchLatestFromCzCliAi("stable").catch(() => undefined)
          const alternative = describeStableAlternative(VERSION, stableLatest)
          if (alternative) process.stderr.write(`${alternative}\n`)
          emitUpdateResult(argv, {
            current_version: VERSION,
            channel,
            latest_version: latest,
            stable_latest: stableLatest ?? null,
            updated: false,
            reason: "already_latest",
          }, [`Already up to date (${VERSION}) on the ${channel} channel.`, alternative].filter(Boolean).join(" "))
          return
        }
        process.stderr.write(`Refusing to downgrade: ${VERSION} → ${latest}\n`)
        process.stderr.write(`The ${channel} channel appears to be pointing to an older version.\n`)
        process.stderr.write(`Use --target <ver> to explicitly downgrade, or --channel <${RELEASE_CHANNELS.join("|")}> to switch streams.\n`)
        emitUpdateResult(argv, {
          current_version: VERSION,
          channel,
          latest_version: latest,
          updated: false,
          reason: "refuse_downgrade",
        }, `Refusing to downgrade ${VERSION} → ${latest} on the ${channel} channel. Use --target ${latest} to explicitly downgrade.`)
        process.exitCode = 1
        return
      }

      if (switchingChannel && shouldUpgradeToVersion(latest, VERSION)) {
        process.stderr.write(`Note: ${latest} is older than ${VERSION}; the channel switch was explicit, proceeding.\n`)
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
            try { return execSync(`${postWhich} --version`, { encoding: "utf-8", stdio: "pipe" }).trim() } catch { return undefined }
          })()
          if (postVersion !== latest) {
            // Find the freshly installed binary
            const candidates = [
              path.join(process.env.HOME || "", ".local", "bin", "cz-cli"),
            ]
            for (const candidate of candidates) {
              try {
                if (!statSync(candidate).isFile()) continue
                const ver = execSync(`${candidate} --version`, { encoding: "utf-8", stdio: "pipe" }).trim()
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
          channel,
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
          channel,
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
