import fs from "fs/promises"
import { spawnSync } from "child_process"
import { realpathSync } from "node:fs"
import os from "os"
import path from "path"
import { InstallationVersion } from "@opencode-ai/core/installation/version"
import { parseCzConfigText } from "../config/cz-config.js"
import { ConfigAutoupdate } from "../config/autoupdate.js"
import { createUpdateLogger } from "./update-log.js"
import {
  DEFAULT_RELEASE_CHANNEL,
  assertVersionInChannel,
  coerceChannel,
  channelForVersion,
  isPendingChannelSwitch,
  isLocalBuildVersion,
  isReleaseVersion,
  shouldUpgradeToVersion,
  type ReleaseChannel,
} from "./release-version.js"

export type { ReleaseChannel } from "./release-version.js"
export {
  channelForVersion,
  compareReleaseVersions,
  isLocalBuildVersion,
  isReleaseVersion,
  shouldUpgradeToVersion,
} from "./release-version.js"

export type InstallMethod = "curl" | "npm" | "yarn" | "pnpm" | "bun" | "brew" | "scoop" | "choco" | "unknown"

type BootstrapConfig = {
  autoupdate?: boolean | "notify"
}

type InstallMetadata = {
  version: 1
  method?: InstallMethod
  installed_path?: string
  package_manager?: string
  channel?: string
  binary_version?: string
  updated_at?: string
}

type UpdateState = {
  // Legacy preference, imported into czcli.json when no canonical value exists.
  autoupdate?: boolean | "notify"
  last_checked_at?: number
  last_result?: "up-to-date" | "update-available" | "upgrade-succeeded" | "upgrade-failed" | "check-failed"
  latest_version?: string
  error?: string
}

type UpdatePaths = {
  install: string
  state: string
}

type UpdateActionInput = {
  autoupdate?: boolean | "notify"
  channel: ReleaseChannel
  channelExplicit?: boolean
  currentVersion: string
  latestVersion?: string
  lastCheckedAt?: number
  now: number
  intervalMs: number
  method?: InstallMethod
}

type UpdateAction =
  | { kind: "skip"; reason: string }
  | { kind: "notify"; reason: string }
  | { kind: "upgrade"; reason: string }

const CLICKZETTA_DIR = ".clickzetta"
const INSTALL_METADATA_FILE = "install.json"
const UPDATE_STATE_FILE = "update-check.json"
const DEFAULT_UPDATE_INTERVAL_MS = 12 * 60 * 60 * 1000
const DEFAULT_REQUEST_TIMEOUT_MS = 5_000
const SUPPORTED_AUTO_UPGRADE_METHODS = new Set<InstallMethod>(["curl", "npm", "pnpm", "yarn", "bun"])
const SKIP_COMMANDS = new Set(["setup", "update", "uninstall", "autoupdate"])
const NPM_METHODS = new Set<InstallMethod>(["npm", "pnpm", "yarn", "bun"])
const INSTALL_SCRIPT_URL = {
  stable: "https://cz-cli.ai/install.sh",
  nightly: "https://cz-cli.ai/install-nightly.sh",
} as const
const WINDOWS_INSTALL_SCRIPT_URL = {
  stable: "https://cz-cli.ai/install.ps1",
  nightly: "https://cz-cli.ai/install-nightly.ps1",
} as const

function homeDirectory(home?: string, env: NodeJS.ProcessEnv = process.env) {
  return home ?? env.CLICKZETTA_TEST_HOME ?? os.homedir()
}

function xdgStateHome(home?: string, env: NodeJS.ProcessEnv = process.env) {
  return env.XDG_STATE_HOME ?? path.join(homeDirectory(home, env), ".local", "state")
}

function updatePaths(home?: string, env: NodeJS.ProcessEnv = process.env): UpdatePaths {
  return {
    install: path.join(homeDirectory(home, env), CLICKZETTA_DIR, INSTALL_METADATA_FILE),
    state: path.join(xdgStateHome(home, env), "clickzetta", UPDATE_STATE_FILE),
  }
}

// Resolve our release channel: CZ_CHANNEL env override → install.json.channel
// → "stable". Never reads opencode's InstallationChannel. Legacy/unknown values
// (e.g. "latest") coerce to the stable default.
export async function resolveReleaseChannel(input: { home?: string; env?: NodeJS.ProcessEnv } = {}): Promise<ReleaseChannel> {
  return (await resolveReleaseSelection(input)).channel
}

export async function resolveReleaseSelection(input: { home?: string; env?: NodeJS.ProcessEnv } = {}) {
  const env = input.env ?? process.env
  const override = coerceChannel(env.CZ_CHANNEL)
  if (override) return { channel: override, explicit: true, source: "CZ_CHANNEL" }
  const metadata = (await readObject(updatePaths(input.home, env).install)) as Partial<InstallMetadata>
  const stored = coerceChannel(metadata.channel)
  return { channel: stored ?? DEFAULT_RELEASE_CHANNEL, explicit: stored !== undefined, source: stored ? "install.json" : "default" }
}

async function readObject(file: string) {
  const text = await fs.readFile(file, "utf-8").catch(() => undefined)
  if (!text) return {}
  return parseCzConfigText(text)
}

async function writeJson(file: string, value: unknown) {
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, JSON.stringify(value, null, 2) + "\n")
}

async function fetchWithTimeout(
  input: string,
  init: RequestInit = {},
  fetchImpl: typeof fetch = fetch,
  timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetchImpl(input, {
      ...init,
      signal: controller.signal,
    })
  } catch (error) {
    const name = error instanceof Error ? error.name : undefined
    const message = error instanceof Error ? error.message : String(error)
    if (name === "AbortError") {
      throw new Error(`request timed out after ${timeoutMs}ms; url=${input}; error=${name}: ${message}`)
    }
    throw new Error(`${name ? `${name}: ` : ""}${message}; url=${input}`)
  } finally {
    clearTimeout(timeout)
  }
}

function resolveIntervalMs(value: string | undefined) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_UPDATE_INTERVAL_MS
}

export function installMethodFromExecPath(execPath: string, home?: string, env: NodeJS.ProcessEnv = process.env): InstallMethod {
  let scriptPath = execPath
  try { scriptPath = realpathSync(execPath) } catch {}
  const pkg = `node_modules${path.sep}@clickzetta`
  if (scriptPath.includes(pkg)) {
    return scriptPath.includes(`${path.sep}.bun${path.sep}`) ? "bun" : "npm"
  }
  const root = homeDirectory(home, env)
  const roots = [root]
  try { roots.push(realpathSync(root)) } catch {}
  const normalizedScriptPath = scriptPath.toLowerCase()
  if (roots.some((item) => normalizedScriptPath.startsWith(path.join(item, ".local", "bin").toLowerCase()))) return "curl"
  return "unknown"
}

export async function latestVersionForMethod(_method: InstallMethod, fetchImpl: typeof fetch = fetch, channel: ReleaseChannel = DEFAULT_RELEASE_CHANNEL) {
  // Version resolution is ALWAYS channel-based via cz-cli.ai — the source of
  // truth for both streams (stable → /api/stable, nightly → /api/nightly). The
  // install *method* never decides the version: it only selects the upgrade
  // command (see performUpgrade). Querying npm's `latest` dist-tag here could
  // disagree with the channel and pick the wrong version. If npm lacks the
  // resolved version, performUpgrade falls back to the install script.
  const url = `https://cz-cli.ai/api/${channel}`
  const response = await fetchWithTimeout(url, {
    headers: { Accept: "application/json" },
  }, fetchImpl)
  if (!response.ok) throw new Error(`Failed to fetch ${channel} version: ${response.status}`)
  const payload = (await response.json()) as { version?: string }
  if (!payload.version) throw new Error(`${channel} version is missing`)
  return assertVersionInChannel(payload.version, channel, url)
}

async function upgradeViaInstallScript(target: string, channel: ReleaseChannel, fetchImpl: typeof fetch = fetch, force?: boolean) {
  const isWindows = process.platform === "win32"
  const response = await fetchWithTimeout((isWindows ? WINDOWS_INSTALL_SCRIPT_URL : INSTALL_SCRIPT_URL)[channel], {}, fetchImpl)
  if (!response.ok) throw new Error(`Failed to download install script: ${response.status}`)
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "cz-cli-update-"))
  const script = path.join(temp, isWindows ? "install.ps1" : "install.sh")
  await fs.writeFile(script, await response.text(), { mode: 0o755 })
  // Resolve the directory of the currently running binary so the installer
  // places the new binary in the same location (avoids PATH shadowing).
  const currentBinDir = path.dirname(process.execPath)
  const result = spawnSync(
    isWindows ? "powershell" : "sh",
    isWindows ? ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script] : [script],
    {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        VERSION: target,
        CZ_VERSION: target,
        CZ_CHANNEL: channel,
        CZ_INSTALL_DIR: currentBinDir,
        NON_INTERACTIVE: "1",
        SKIP_PATH_PROMPT: "1",
        ...(force && { CZ_FORCE: "1" }),
      },
    },
  )
  if (result.stdout) process.stdout.write(result.stdout)
  if (result.stderr) process.stderr.write(result.stderr)
  await fs.rm(temp, { recursive: true, force: true })
  if (result.status !== 0) {
    const details = [result.error instanceof Error ? result.error.message : undefined, result.stderr, result.stdout]
      .map((item) => item?.trim())
      .filter((item): item is string => Boolean(item))
      .join("\n")
    throw new Error(`Install script failed with exit code ${result.status ?? 1}${details ? `\n${details}` : ""}`)
  }
}

async function upgradeViaPackageManager(method: InstallMethod, target: string, channel: ReleaseChannel) {
  const spec = `@clickzetta/cz-cli@${target}`
  const cmd =
    method === "npm"
      ? ["npm", "install", "-g", spec]
      : method === "pnpm"
        ? ["pnpm", "add", "-g", spec]
        : method === "bun"
          ? ["bun", "add", "-g", spec]
          : ["yarn", "global", "add", spec]
  const result = spawnSync(cmd[0], cmd.slice(1), {
    stdio: "inherit",
    env: { ...process.env, CZ_CHANNEL: channel },
  })
  if (result.status !== 0) throw new Error(`${cmd[0]} upgrade failed with exit code ${result.status ?? 1}`)
}

export async function performUpgrade(method: InstallMethod, target: string, fetchImpl: typeof fetch = fetch, channel: ReleaseChannel = DEFAULT_RELEASE_CHANNEL, force?: boolean) {
  if (NPM_METHODS.has(method)) {
    try {
      await upgradeViaPackageManager(method, target, channel)
    } catch {
      await upgradeViaInstallScript(target, channel, fetchImpl, force)
    }
    return
  }
  await upgradeViaInstallScript(target, channel, fetchImpl, force)
}

function binaryVersion(binaryPath: string, env: NodeJS.ProcessEnv = process.env) {
  const result = spawnSync(binaryPath, ["--version"], {
    encoding: "utf-8",
    env: { ...env, CLICKZETTA_SKIP_UPDATE_ONCE: "1" },
  })
  if (result.status !== 0) return undefined
  return result.stdout.trim()
}

function repairMacOSBinary(binaryPath: string) {
  if (process.platform !== "darwin") return
  spawnSync("xattr", ["-dr", "com.apple.quarantine", binaryPath], { stdio: "ignore" })
  spawnSync("codesign", ["--force", "--sign", "-", binaryPath], { stdio: "ignore" })
}

export async function ensureRestartBinaryAtPath(target: string, restartPath = process.execPath, env: NodeJS.ProcessEnv = process.env) {
  repairMacOSBinary(restartPath)
  if (binaryVersion(restartPath, env) === target) return
  // .exe on Windows: install.sh now installs Git Bash / MSYS2 / Cygwin hosts (see
  // scripts/cos-release.mjs's platform mapping), and what it puts in ~/.local/bin is
  // cz-cli.exe. Hardcoding the extensionless name meant this candidate could never
  // exist there, so every auto-update on such an install ended at the throw below.
  const candidate = path.join(
    homeDirectory(undefined, env),
    ".local",
    "bin",
    process.platform === "win32" ? "cz-cli.exe" : "cz-cli",
  )
  if (candidate === restartPath || binaryVersion(candidate, env) !== target) {
    throw new Error(`Updated cz-cli binary is not available at ${restartPath}; clean stale PATH entries and reinstall cz-cli`)
  }
  await fs.mkdir(path.dirname(restartPath), { recursive: true })
  await fs.copyFile(candidate, restartPath)
  await fs.chmod(restartPath, 0o755)
  repairMacOSBinary(restartPath)
}

export function restartCurrentProcessResult(execPath: string, args: string[], env: NodeJS.ProcessEnv = process.env) {
  const run = () => spawnSync(execPath, args, {
    stdio: "inherit",
    env: { ...env, CLICKZETTA_SKIP_UPDATE_ONCE: "1" },
  })
  const result = run()
  if (result.status === null && result.signal === "SIGKILL") {
    const retry = run()
    return retry.status ?? 1
  }
  return result.status ?? 1
}

function restartCurrentProcess(env: NodeJS.ProcessEnv = process.env) {
  // In a compiled bun binary, process.argv is ["bun", "/$bunfs/root/<name>", ...userArgs]
  // and process.execPath is the real binary path. The virtual /$bunfs/ entry at argv[1]
  // must be skipped — passing it to the re-exec'd binary causes yargs to reject it as an
  // unknown argument. In dev mode (bun run script.ts), argv[0] === execPath so slice(1)
  // is correct. We detect binary mode by checking whether execPath differs from argv[0].
  const args = restartArgs(process.execPath, process.argv)
  const result = restartCurrentProcessResult(process.execPath, args, env)
  process.exit(result)
}

export function restartArgs(_execPath: string, argv: string[]): string[] {
  // binary mode: argv = [bun, cz-cli-binary, ...userArgs] — execPath differs from argv[0]
  // dev mode:    argv = [bun, script.ts, ...userArgs] — execPath === argv[0]
  // Both cases: user args start at argv[2]
  return argv.slice(2)
}

export async function loadBootstrapConfig(input: { home?: string; env?: NodeJS.ProcessEnv } = {}): Promise<BootstrapConfig> {
  const config = await ConfigAutoupdate.read(input)
  return { autoupdate: config.value }
}

export function shouldSkipAutoUpdateCommand(input: {
  args: string[]
  env?: NodeJS.ProcessEnv
  version?: string
}) {
  return autoUpdateSkipReason(input) !== undefined
}

function autoUpdateSkipReason(input: { args: string[]; env?: NodeJS.ProcessEnv; version?: string }) {
  const env = input.env ?? process.env
  const suppression = ConfigAutoupdate.suppression(env)
  if (suppression) return suppression
  // Channel does NOT gate whether auto-update runs; it only selects the update
  // stream. Version shape does: anything that was not published can never have
  // an update target, and must never be replaced behind the developer's back.
  // `Script.version` stamps `0.0.0-<branch>-<ts>` for worktree builds and
  // version.ts falls back to `0.0.0-dev+<ts>`; both satisfy isReleaseVersion,
  // so the shape check alone used to let a local build auto-update onto stable.
  const version = input.version ?? InstallationVersion
  if (!isReleaseVersion(version) || isLocalBuildVersion(version)) return "local-build"
  const head = input.args[0]
  if (head && SKIP_COMMANDS.has(head)) return `command:${head}`
  if (input.args.includes("--help") || input.args.includes("-h")) return "help"
  if (input.args.includes("--version") || input.args.includes("-v")) return "version"
}

export function resolveUpdateAction(input: UpdateActionInput): UpdateAction {
  const autoupdate = input.autoupdate ?? true
  if (autoupdate === false) return { kind: "skip", reason: "disabled" }
  const latestVersion = input.latestVersion
  if (!isReleaseVersion(input.currentVersion) || !latestVersion || !isReleaseVersion(latestVersion)) {
    return { kind: "skip", reason: "version" }
  }
  // Unpublished (0.0.0-*) builds are never auto-updated — see
  // shouldSkipAutoUpdateCommand. Repeated here because this function is the
  // decision seam and is called directly by tests and by maybeAutoUpdate.
  if (isLocalBuildVersion(input.currentVersion)) return { kind: "skip", reason: "local-build" }
  if (input.lastCheckedAt !== undefined && input.now - input.lastCheckedAt < input.intervalMs) {
    return { kind: "skip", reason: "interval" }
  }
  const pending = isPendingChannelSwitch(input.currentVersion, { channel: input.channel, explicit: input.channelExplicit === true })
  if (channelForVersion(input.currentVersion) !== input.channel && !pending) {
    return { kind: "skip", reason: "channel-mismatch" }
  }
  if (!pending && !shouldUpgradeToVersion(input.currentVersion, latestVersion)) {
    return { kind: "skip", reason: "up-to-date" }
  }
  if (autoupdate === true && input.method && SUPPORTED_AUTO_UPGRADE_METHODS.has(input.method)) {
    return { kind: "upgrade", reason: "managed-install" }
  }
  return { kind: "notify", reason: "update-available" }
}

export async function readInstallMetadata(input: { home?: string; env?: NodeJS.ProcessEnv } = {}) {
  const file = updatePaths(input.home, input.env ?? process.env).install
  const payload = (await readObject(file)) as Partial<InstallMetadata>
  if (Object.keys(payload).length === 0) return undefined
  return payload as InstallMetadata
}

export async function writeInstallMetadata(
  value: Partial<InstallMetadata> = {},
  input: { home?: string; env?: NodeJS.ProcessEnv } = {},
) {
  const file = updatePaths(input.home, input.env ?? process.env).install
  const existing = (await readObject(file)) as Partial<InstallMetadata>
  const metadata = { ...value }
  delete metadata.method
  await writeJson(file, {
    version: 1,
    channel: coerceChannel(existing.channel) ?? DEFAULT_RELEASE_CHANNEL,
    binary_version: InstallationVersion,
    installed_path: process.execPath,
    updated_at: new Date().toISOString(),
    ...metadata,
  } satisfies Omit<InstallMetadata, "method">)
}

export async function maybeAutoUpdate(input: {
  args: string[]
  env?: NodeJS.ProcessEnv
  fetchImpl?: typeof fetch
  now?: number
  intervalMs?: number
  version: string
}) {
  const env = input.env ?? process.env
  const currentVersion = input.version
  const log = createUpdateLogger(currentVersion, env)
  const skip = autoUpdateSkipReason({ args: input.args, env, version: currentVersion })
  if (skip) {
    await log("skipped", { reason: skip })
    return
  }

  const config = await ConfigAutoupdate.read({ env }).catch(async (error) => {
    await log("config-failed", { error: error instanceof Error ? error.message : String(error) })
    return undefined
  })
  // A broken optional updater configuration must not block the user's command
  // or enable updates by falling back to a default after a failed read.
  if (!config) return
  const autoupdate = config.value
  if (autoupdate === false) {
    await log("skipped", { reason: "disabled", source: config.source })
    return
  }

  const now = input.now ?? Date.now()
  const intervalMs = input.intervalMs ?? resolveIntervalMs(env.CLICKZETTA_UPDATE_INTERVAL_MS)
  const paths = updatePaths(undefined, env)
  const state = ((await readObject(paths.state)) as UpdateState) ?? {}
  if (state.last_checked_at !== undefined && now - state.last_checked_at < intervalMs) {
    // Keep failure cooldowns visible. Healthy repeated invocations are quiet
    // unless support explicitly requests detailed interval diagnostics.
    if (env.CLICKZETTA_UPDATE_DEBUG === "1" || state.last_result === "check-failed" || state.last_result === "upgrade-failed") await log("skipped", {
      reason: "interval",
      last_checked_at: state.last_checked_at,
      last_result: state.last_result,
      retry_after_ms: intervalMs - (now - state.last_checked_at),
    })
    return
  }
  await log("config", { autoupdate, configured: config.configured, source: config.source, config_path: config.path })
  const method = installMethodFromExecPath(process.execPath, undefined, env)
  const selection = await resolveReleaseSelection({ env })
  const channel = selection.channel
  const started = Date.now()
  await log("check-started", { method, channel, channel_source: selection.source, url: `https://cz-cli.ai/api/${channel}`, timeout_ms: DEFAULT_REQUEST_TIMEOUT_MS })

  const latestVersion = await latestVersionForMethod(method, input.fetchImpl ?? fetch, channel).catch(async (error) => {
    await log("check-failed", { channel, duration_ms: Date.now() - started, error: error instanceof Error ? error.message : String(error) })
    await writeJson(paths.state, {
      ...state,
      last_checked_at: now,
      last_result: "check-failed",
      error: error instanceof Error ? error.message : String(error),
    } satisfies UpdateState)
    return undefined
  })
  if (!latestVersion) return
  const action = resolveUpdateAction({
    autoupdate,
    channel,
    channelExplicit: selection.explicit,
    currentVersion,
    latestVersion,
    lastCheckedAt: state.last_checked_at,
    now,
    intervalMs,
    method,
  })
  await log("check-completed", { channel, latest_version: latestVersion, duration_ms: Date.now() - started })
  await log("decision", {
    action: action.kind,
    reason: action.kind === "notify" ? autoupdate === "notify" ? "notify-only" : "unsupported-install-method" : action.reason,
    method,
    channel,
    latest_version: latestVersion,
  })
  if (action.kind === "skip") {
    if (action.reason === "interval") return
    await writeJson(paths.state, {
      ...state,
      last_checked_at: now,
      last_result: action.reason === "up-to-date" ? "up-to-date" : undefined,
      latest_version: latestVersion,
      error: undefined,
    } satisfies UpdateState)
    return
  }

  await writeJson(paths.state, {
    ...state,
    last_checked_at: now,
    last_result: "update-available",
    latest_version: latestVersion,
    error: undefined,
  } satisfies UpdateState)

  const pending = isPendingChannelSwitch(currentVersion, selection)
  process.stderr.write(`${pending ? "A cz-cli channel switch is pending" : "A newer cz-cli is available"}: ${currentVersion} -> ${latestVersion}\n`)
  if (action.kind === "notify" || !latestVersion) return

  const upgrading = Date.now()
  await log("upgrade-started", { method, channel, latest_version: latestVersion })
  try {
    await performUpgrade(method, latestVersion, input.fetchImpl ?? fetch, channel, pending)
    await ensureRestartBinaryAtPath(latestVersion, process.execPath, env)
    await writeInstallMetadata({ binary_version: latestVersion, channel }, { env })
    await writeJson(paths.state, {
      // Preserve legacy fields for older binaries sharing this state file.
      ...state,
      last_checked_at: now,
      last_result: "upgrade-succeeded",
      latest_version: latestVersion,
      error: undefined,
    } satisfies UpdateState)
    await log("upgrade-succeeded", { latest_version: latestVersion, duration_ms: Date.now() - upgrading })
    process.stderr.write(`Updated cz-cli to ${latestVersion}. Restarting command...\n`)
    await log("restarting", { latest_version: latestVersion })
    restartCurrentProcess(env)
  } catch (error) {
    await log("upgrade-failed", { latest_version: latestVersion, duration_ms: Date.now() - upgrading, error: error instanceof Error ? error.message : String(error) })
    await writeJson(paths.state, {
      ...state,
      last_checked_at: now,
      last_result: "upgrade-failed",
      latest_version: latestVersion,
      error: error instanceof Error ? error.message : String(error),
    } satisfies UpdateState)
    process.stderr.write(`Automatic upgrade failed: ${error instanceof Error ? error.message : String(error)}\n`)
  }
}
