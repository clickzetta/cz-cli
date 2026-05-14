import fs from "fs/promises"
import os from "os"
import path from "path"
import semver from "semver"
import { parse as parseToml } from "smol-toml"
import { parse as parseJsonc } from "jsonc-parser"
import { spawnSync } from "child_process"
import { ConfigManaged } from "@/config/managed"
import { InstallationChannel, InstallationVersion } from "@/installation/version"

export type InstallMethod = "curl" | "npm" | "yarn" | "pnpm" | "bun" | "brew" | "scoop" | "choco" | "unknown"

type BootstrapConfig = {
  autoupdate?: boolean | "notify"
}

type InstallMetadata = {
  version: 1
  method: InstallMethod
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
  const json = parseJsonc(text)
  if (json && typeof json === "object" && !Array.isArray(json)) return json as Record<string, unknown>
  const toml = parseToml(text)
  return toml && typeof toml === "object" && !Array.isArray(toml) ? (toml as Record<string, unknown>) : {}
}

function coerceAutoupdate(value: unknown) {
  if (value === true || value === false || value === "notify") return value
  return undefined
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
  } finally {
    clearTimeout(timeout)
  }
}

function resolveIntervalMs(value: string | undefined) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_UPDATE_INTERVAL_MS
}

export function installMethodFromExecPath(execPath: string, home?: string, env: NodeJS.ProcessEnv = process.env): InstallMethod {
  const root = homeDirectory(home, env)
  if (execPath === path.join(root, ".local", "bin", "cz-cli")) return "curl"
  if (execPath.includes(`${path.sep}node_modules${path.sep}`) && execPath.includes("@clickzetta")) return "npm"
  return "unknown"
}

export async function latestVersionForMethod(method: InstallMethod, fetchImpl: typeof fetch = fetch) {
  if (NPM_METHODS.has(method)) {
    const response = await fetchWithTimeout("https://registry.npmjs.org/@clickzetta/cz-cli/latest", {
      headers: { Accept: "application/json" },
    }, fetchImpl)
    if (!response.ok) throw new Error(`Failed to fetch npm latest version: ${response.status}`)
    const payload = (await response.json()) as { version?: string }
    if (!payload.version) throw new Error("npm registry latest version is missing")
    return payload.version
  }

  const response = await fetchWithTimeout("https://api.github.com/repos/clickzetta/cz-cli/releases/latest", {
    headers: { Accept: "application/vnd.github+json" },
  }, fetchImpl)
  if (!response.ok) throw new Error(`Failed to fetch GitHub latest release: ${response.status}`)
  const payload = (await response.json()) as { tag_name?: string }
  const version = payload.tag_name?.replace(/^v/, "")
  if (!version) throw new Error("GitHub latest release tag is missing")
  return version
}

async function upgradeViaInstallScript(target: string, fetchImpl: typeof fetch = fetch) {
  const response = await fetchWithTimeout("https://github.com/clickzetta/cz-cli/releases/latest/download/install.sh", {}, fetchImpl)
  if (!response.ok) throw new Error(`Failed to download install script: ${response.status}`)
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "cz-cli-update-"))
  const script = path.join(temp, "install.sh")
  await fs.writeFile(script, await response.text(), { mode: 0o755 })
  const result = spawnSync("sh", [script], {
    stdio: "inherit",
    env: {
      ...process.env,
      CZ_VERSION: target,
      NON_INTERACTIVE: "1",
      SKIP_PATH_PROMPT: "1",
    },
  })
  await fs.rm(temp, { recursive: true, force: true })
  if (result.status !== 0) throw new Error(`Install script failed with exit code ${result.status ?? 1}`)
}

async function upgradeViaPackageManager(method: InstallMethod, target: string) {
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
    env: process.env,
  })
  if (result.status !== 0) throw new Error(`${cmd[0]} upgrade failed with exit code ${result.status ?? 1}`)
}

export async function performUpgrade(method: InstallMethod, target: string, fetchImpl: typeof fetch = fetch) {
  if (method === "curl") {
    await upgradeViaInstallScript(target, fetchImpl)
    return
  }
  if (NPM_METHODS.has(method)) {
    await upgradeViaPackageManager(method, target)
    return
  }
  throw new Error(`Automatic upgrade is not supported for ${method} installs`)
}

function restartCurrentProcess(env: NodeJS.ProcessEnv = process.env) {
  const result = spawnSync(process.execPath, process.argv.slice(1), {
    stdio: "inherit",
    env: { ...env, CLICKZETTA_SKIP_UPDATE_ONCE: "1" },
  })
  process.exit(result.status ?? 1)
}

export async function loadBootstrapConfig(input: { home?: string; env?: NodeJS.ProcessEnv } = {}): Promise<BootstrapConfig> {
  const env = input.env ?? process.env
  const merged = { autoupdate: undefined as BootstrapConfig["autoupdate"] }

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
  channel?: string
  version?: string
}) {
  const env = input.env ?? process.env
  if (
    env.CLICKZETTA_SKIP_UPDATE_ONCE === "1" ||
    env.CLICKZETTA_DISABLE_AUTOUPDATE === "1" ||
    ["1", "true", "yes"].includes((env.CZ_SKIP_UPDATE ?? "").trim().toLowerCase())
  ) return true
  if ((input.channel ?? InstallationChannel) !== "latest") return true
  if (!semver.valid(input.version ?? InstallationVersion)) return true
  const head = input.args[0]
  if (head && SKIP_COMMANDS.has(head)) return true
  return input.args.includes("--help") || input.args.includes("-h") || input.args.includes("--version") || input.args.includes("-v")
}

export function resolveUpdateAction(input: UpdateActionInput): UpdateAction {
  if (input.autoupdate === false) return { kind: "skip", reason: "disabled" }
  if (input.channel !== "latest") return { kind: "skip", reason: "channel" }
  const latestVersion = input.latestVersion
  if (!semver.valid(input.currentVersion) || !latestVersion || !semver.valid(latestVersion)) {
    return { kind: "skip", reason: "version" }
  }
  if (input.lastCheckedAt !== undefined && input.now - input.lastCheckedAt < input.intervalMs) {
    return { kind: "skip", reason: "interval" }
  }
  if (!semver.gt(latestVersion, input.currentVersion)) {
    return { kind: "skip", reason: "up-to-date" }
  }
  if (input.autoupdate === true && input.method && SUPPORTED_AUTO_UPGRADE_METHODS.has(input.method)) {
    return { kind: "upgrade", reason: "managed-install" }
  }
  return { kind: "notify", reason: "update-available" }
}

export async function readInstallMetadata(input: { home?: string; env?: NodeJS.ProcessEnv } = {}) {
  const file = updatePaths(input.home, input.env ?? process.env).install
  const payload = (await readObject(file)) as Partial<InstallMetadata>
  if (!payload.method) return undefined
  return payload as InstallMetadata
}

export async function writeInstallMetadata(
  value: Partial<InstallMetadata> & Pick<InstallMetadata, "method">,
  input: { home?: string; env?: NodeJS.ProcessEnv } = {},
) {
  const file = updatePaths(input.home, input.env ?? process.env).install
  await writeJson(file, {
    version: 1,
    channel: InstallationChannel,
    binary_version: InstallationVersion,
    installed_path: process.execPath,
    updated_at: new Date().toISOString(),
    ...value,
  } satisfies InstallMetadata)
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
  const autoupdate = config.autoupdate ?? "notify"
  if (autoupdate === false) return

  const now = input.now ?? Date.now()
  const intervalMs = input.intervalMs ?? resolveIntervalMs(env.CLICKZETTA_UPDATE_INTERVAL_MS)
  const paths = updatePaths(undefined, env)
  const state = ((await readObject(paths.state)) as UpdateState) ?? {}
  if (state.last_checked_at !== undefined && now - state.last_checked_at < intervalMs) return
  const method = (await readInstallMetadata({ env }))?.method ?? installMethodFromExecPath(process.execPath, undefined, env)

  const latestVersion = await latestVersionForMethod(method, input.fetchImpl ?? fetch).catch(async (error) => {
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
    channel: InstallationChannel,
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
    await performUpgrade(method, latestVersion, input.fetchImpl ?? fetch)
    await writeInstallMetadata({ method, binary_version: latestVersion }, { env })
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
