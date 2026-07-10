import fs from "fs/promises"
import { spawnSync } from "child_process"
import { realpathSync } from "node:fs"
import os from "os"
import path from "path"
import { InstallationVersion } from "@opencode-ai/core/installation/version"
import { ConfigManaged } from "opencode/config/managed"
import { jsonc } from "opencode/config/parse"
import { parse as parseToml } from "smol-toml"

// Our own release channel, intentionally isolated from opencode's
// `InstallationChannel` (the build-time CLICKZETTA_CHANNEL constant, which also
// drives per-channel DB isolation, telemetry env, and dev-mode detection).
// This channel only selects the install/update version stream and is persisted
// in ~/.clickzetta/install.json by every install/update entry point.
export type ReleaseChannel = "stable" | "nightly"
const DEFAULT_RELEASE_CHANNEL: ReleaseChannel = "stable"

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
  channel: string
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
const SKIP_COMMANDS = new Set(["setup", "update", "uninstall"])
const NPM_METHODS = new Set<InstallMethod>(["npm", "pnpm", "yarn", "bun"])
const DEV_RELEASE_VERSION_RE = /^dev-v\d+\.\d+\.\d+\.[\w.-]+$/
const SEMVER_RELEASE_VERSION_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/
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

function configCandidates(home?: string, env: NodeJS.ProcessEnv = process.env) {
  const root = homeDirectory(home, env)
  return [
    path.join(root, CLICKZETTA_DIR, "czcli.json"),
    path.join(root, CLICKZETTA_DIR, "czcli.jsonc"),
    path.join(env.XDG_CONFIG_HOME ?? path.join(root, ".config"), "clickzetta", "opencode.jsonc"),
    path.join(env.XDG_CONFIG_HOME ?? path.join(root, ".config"), "clickzetta", "opencode.json"),
    path.join(env.XDG_CONFIG_HOME ?? path.join(root, ".config"), "clickzetta", "config.json"),
  ]
}

function managedCandidates(env: NodeJS.ProcessEnv = process.env) {
  const root = env.CLICKZETTA_TEST_MANAGED_CONFIG_DIR ?? ConfigManaged.managedConfigDir()
  return [path.join(root, "opencode.json"), path.join(root, "opencode.jsonc")]
}

function updatePaths(home?: string, env: NodeJS.ProcessEnv = process.env): UpdatePaths {
  return {
    install: path.join(homeDirectory(home, env), CLICKZETTA_DIR, INSTALL_METADATA_FILE),
    state: path.join(xdgStateHome(home, env), "clickzetta", UPDATE_STATE_FILE),
  }
}

function parseConfig(text: string) {
  const json = readJsonConfig(text)
  if (json && typeof json === "object" && !Array.isArray(json)) return json as Record<string, unknown>
  const toml = parseToml(text)
  return toml && typeof toml === "object" && !Array.isArray(toml) ? (toml as Record<string, unknown>) : {}
}

function readJsonConfig(text: string) {
  try {
    return jsonc(text, "clickzetta config")
  } catch {
    return undefined
  }
}

function coerceAutoupdate(value: unknown) {
  if (value === true || value === false || value === "notify") return value
  return undefined
}

function coerceChannel(value: unknown): ReleaseChannel | undefined {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : undefined
  return normalized === "stable" || normalized === "nightly" ? normalized : undefined
}

// Resolve our release channel: CZ_CHANNEL env override → install.json.channel
// → "stable". Never reads opencode's InstallationChannel. Legacy/unknown values
// (e.g. "latest") coerce to the stable default.
export async function resolveReleaseChannel(input: { home?: string; env?: NodeJS.ProcessEnv } = {}): Promise<ReleaseChannel> {
  const env = input.env ?? process.env
  const override = coerceChannel(env.CZ_CHANNEL)
  if (override) return override
  const metadata = (await readObject(updatePaths(input.home, env).install)) as Partial<InstallMetadata>
  return coerceChannel(metadata.channel) ?? DEFAULT_RELEASE_CHANNEL
}

async function readObject(file: string) {
  const text = await fs.readFile(file, "utf-8").catch(() => undefined)
  if (!text) return {}
  return parseConfig(text)
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

export async function latestVersionForMethod(_method: InstallMethod, fetchImpl: typeof fetch = fetch, channel?: string) {
  // Version resolution is ALWAYS channel-based via cz-cli.ai — the source of
  // truth for both streams (stable → /api/stable, nightly → /api/nightly). The
  // install *method* never decides the version: it only selects the upgrade
  // command (see performUpgrade). Querying npm's `latest` dist-tag here could
  // disagree with the channel and pick the wrong version. If npm lacks the
  // resolved version, performUpgrade falls back to the install script.
  const stream = channel === "nightly" ? "nightly" : "stable"
  const response = await fetchWithTimeout(`https://cz-cli.ai/api/${stream}`, {
    headers: { Accept: "application/json" },
  }, fetchImpl)
  if (!response.ok) throw new Error(`Failed to fetch ${stream} version: ${response.status}`)
  const payload = (await response.json()) as { version?: string }
  if (!payload.version) throw new Error(`${stream} version is missing`)
  return payload.version
}

function isReleaseVersion(version: string) {
  return SEMVER_RELEASE_VERSION_RE.test(version) || DEV_RELEASE_VERSION_RE.test(version)
}

function compareReleaseVersions(left: string, right: string) {
  const leftParts = left.replace(/^dev-v/, "").replace(/[-+].*$/, "").split(".")
  const rightParts = right.replace(/^dev-v/, "").replace(/[-+].*$/, "").split(".")
  for (let i = 0; i < 3; i++) {
    const leftNum = Number(leftParts[i] ?? 0)
    const rightNum = Number(rightParts[i] ?? 0)
    if (leftNum !== rightNum) return leftNum - rightNum
  }
  if (left.startsWith("dev-v") && right.startsWith("dev-v")) {
    return leftParts.slice(3).join(".").localeCompare(rightParts.slice(3).join("."))
  }
  return 0
}

export function shouldUpgradeToVersion(currentVersion: string, latestVersion: string) {
  if (!isReleaseVersion(currentVersion) || !isReleaseVersion(latestVersion)) return currentVersion !== latestVersion
  const order = compareReleaseVersions(latestVersion, currentVersion)
  return order > 0 || (order === 0 && latestVersion !== currentVersion)
}

async function upgradeViaInstallScript(target: string, channel?: string, fetchImpl: typeof fetch = fetch, force?: boolean) {
  const ch = channel === "nightly" ? "nightly" : "stable"
  const isWindows = process.platform === "win32"
  const response = await fetchWithTimeout((isWindows ? WINDOWS_INSTALL_SCRIPT_URL : INSTALL_SCRIPT_URL)[ch], {}, fetchImpl)
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
        CZ_CHANNEL: ch,
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

async function upgradeViaPackageManager(method: InstallMethod, target: string, channel?: string) {
  const ch = channel === "nightly" ? "nightly" : "stable"
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
    env: { ...process.env, CZ_CHANNEL: ch },
  })
  if (result.status !== 0) throw new Error(`${cmd[0]} upgrade failed with exit code ${result.status ?? 1}`)
}

export async function performUpgrade(method: InstallMethod, target: string, fetchImpl: typeof fetch = fetch, channel?: string, force?: boolean) {
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
  const candidate = path.join(homeDirectory(undefined, env), ".local", "bin", "cz-cli")
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
  const env = input.env ?? process.env
  const merged = { autoupdate: undefined as BootstrapConfig["autoupdate"] }

  // Back-compat: the removed `cz-cli autoupdate on/off` command persisted the
  // preference into update-check.json (`autoupdate` field). loadBootstrapConfig
  // no longer reads that file, so without this a pre-migration user who ran
  // `autoupdate false` would silently have auto-upgrade re-enabled. Read it at
  // the LOWEST precedence so newer czcli.json / managed prefs / env still win.
  {
    const legacy = coerceAutoupdate((await readObject(updatePaths(input.home, env).state)).autoupdate)
    if (legacy !== undefined) merged.autoupdate = legacy
  }

  for (const file of configCandidates(input.home, env)) {
    const value = coerceAutoupdate((await readObject(file)).autoupdate)
    if (value !== undefined) merged.autoupdate = value
  }

  for (const file of managedCandidates(env)) {
    const value = coerceAutoupdate((await readObject(file)).autoupdate)
    if (value !== undefined) merged.autoupdate = value
  }

  const mobileConfig = await ConfigManaged.readManagedPreferences().catch(() => undefined)
  if (mobileConfig) {
    const value = coerceAutoupdate(parseConfig(mobileConfig.text).autoupdate)
    if (value !== undefined) merged.autoupdate = value
  }

  const override = env.CLICKZETTA_AUTOUPDATE
  if (override === "true") merged.autoupdate = true
  if (override === "false") merged.autoupdate = false
  if (override === "notify") merged.autoupdate = "notify"
  return merged
}

export function shouldSkipAutoUpdateCommand(input: {
  args: string[]
  env?: NodeJS.ProcessEnv
  version?: string
}) {
  const env = input.env ?? process.env
  if (
    env.CLICKZETTA_SKIP_UPDATE_ONCE === "1" ||
    env.CLICKZETTA_DISABLE_AUTOUPDATE === "1" ||
    ["1", "true", "yes"].includes((env.CZ_SKIP_UPDATE ?? "").trim().toLowerCase())
  ) return true
  // Channel does NOT gate whether auto-update runs; it only selects the update
  // stream. Local builds are guarded by the release-version check below
  // (InstallationVersion === "local" is not a release version).
  if (!isReleaseVersion(input.version ?? InstallationVersion)) return true
  const head = input.args[0]
  if (head && SKIP_COMMANDS.has(head)) return true
  return input.args.includes("--help") || input.args.includes("-h") || input.args.includes("--version") || input.args.includes("-v")
}

export function resolveUpdateAction(input: UpdateActionInput): UpdateAction {
  const autoupdate = input.autoupdate ?? true
  if (autoupdate === false) return { kind: "skip", reason: "disabled" }
  const latestVersion = input.latestVersion
  if (!isReleaseVersion(input.currentVersion) || !latestVersion || !isReleaseVersion(latestVersion)) {
    return { kind: "skip", reason: "version" }
  }
  if (input.lastCheckedAt !== undefined && input.now - input.lastCheckedAt < input.intervalMs) {
    return { kind: "skip", reason: "interval" }
  }
  if (!shouldUpgradeToVersion(input.currentVersion, latestVersion)) {
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
}) {
  const env = input.env ?? process.env
  if (shouldSkipAutoUpdateCommand({ args: input.args, env })) return

  const config = await loadBootstrapConfig({ env })
  const autoupdate = config.autoupdate ?? true
  if (autoupdate === false) return

  const now = input.now ?? Date.now()
  const intervalMs = input.intervalMs ?? resolveIntervalMs(env.CLICKZETTA_UPDATE_INTERVAL_MS)
  const paths = updatePaths(undefined, env)
  const state = ((await readObject(paths.state)) as UpdateState) ?? {}
  if (state.last_checked_at !== undefined && now - state.last_checked_at < intervalMs) return
  const method = installMethodFromExecPath(process.execPath, undefined, env)
  const channel = await resolveReleaseChannel({ env })

  const latestVersion = await latestVersionForMethod(method, input.fetchImpl ?? fetch, channel).catch(async (error) => {
    await writeJson(paths.state, {
      ...state,
      last_checked_at: now,
      last_result: "check-failed",
      error: error instanceof Error ? error.message : String(error),
    } satisfies UpdateState)
    return undefined
  })
  const action = resolveUpdateAction({
    autoupdate,
    channel,
    currentVersion: InstallationVersion,
    latestVersion,
    lastCheckedAt: state.last_checked_at,
    now,
    intervalMs,
    method,
  })
  if (action.kind === "skip") {
    if (action.reason === "interval") return
    await writeJson(paths.state, {
      ...state,
      last_checked_at: now,
      last_result: action.reason === "up-to-date" ? "up-to-date" : state.last_result,
      latest_version: latestVersion,
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

  process.stderr.write(`A newer cz-cli is available: ${InstallationVersion} -> ${latestVersion}\n`)
  if (action.kind === "notify" || !latestVersion) return

  try {
    await performUpgrade(method, latestVersion, input.fetchImpl ?? fetch, channel)
    await ensureRestartBinaryAtPath(latestVersion, process.execPath, env)
    await writeInstallMetadata({ binary_version: latestVersion, channel }, { env })
    await writeJson(paths.state, {
      last_checked_at: now,
      last_result: "upgrade-succeeded",
      latest_version: latestVersion,
    } satisfies UpdateState)
    process.stderr.write(`Updated cz-cli to ${latestVersion}. Restarting command...\n`)
    restartCurrentProcess(env)
  } catch (error) {
    await writeJson(paths.state, {
      last_checked_at: now,
      last_result: "upgrade-failed",
      latest_version: latestVersion,
      error: error instanceof Error ? error.message : String(error),
    } satisfies UpdateState)
    process.stderr.write(`Automatic upgrade failed: ${error instanceof Error ? error.message : String(error)}\n`)
  }
}
