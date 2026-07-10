import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { readLlmConfig } from "../llm/native-config.js"
import { CLICKZETTA_PROVIDER_NPM, isClickzettaGatewayUrl } from "../llm/clickzetta-provider.js"
import {
  resolveClickzettaPluginSpecifier,
  resolveClickzettaProviderSpecifier,
  resolveClickzettaTuiPluginSpecifier,
} from "./runtime-assets.js"

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function parseConfigContent() {
  if (!process.env.OPENCODE_CONFIG_CONTENT) return {}
  try {
    const parsed = JSON.parse(process.env.OPENCODE_CONFIG_CONTENT)
    return isRecord(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

function mergePluginSpecs(...groups: Array<unknown>) {
  const merged: unknown[] = []

  for (const group of groups) {
    if (!Array.isArray(group)) continue
    for (const entry of group) {
      const duplicate =
        typeof entry === "string"
          ? merged.some((item) => item === entry || (isRecord(item) && item.spec === entry))
          : merged.includes(entry)
      if (!duplicate) merged.push(entry)
    }
  }

  return merged.length ? merged : undefined
}

function shouldRewriteProvider(provider: unknown) {
  if (!isRecord(provider)) return false
  const npm = typeof provider.npm === "string" ? provider.npm : undefined
  const options = isRecord(provider.options) ? provider.options : undefined
  const baseURL = typeof options?.baseURL === "string" ? options.baseURL : undefined
  return npm === CLICKZETTA_PROVIDER_NPM || (npm === "@ai-sdk/openai-compatible" && isClickzettaGatewayUrl(baseURL))
}

function rewriteProviders(value: unknown, providerSpecifier: string) {
  if (!isRecord(value)) return undefined

  const entries = Object.entries(value).map(([name, provider]) => [
    name,
    shouldRewriteProvider(provider)
      ? { ...(provider as Record<string, unknown>), npm: providerSpecifier }
      : provider,
  ])
  const changed = entries.some(([, provider]) => isRecord(provider) && provider.npm === providerSpecifier)
  if (!changed) return undefined
  return Object.fromEntries(entries)
}

// Nearest ancestor holding `.git` (dir or file — covers worktrees/submodules),
// i.e. opencode's git worktree root. Returns undefined when cwd is not in a repo,
// mirroring origin where ctx.worktree is then undefined.
function gitWorktreeRoot(start: string): string | undefined {
  let dir = start
  while (true) {
    if (existsSync(path.join(dir, ".git"))) return dir
    const parent = path.dirname(dir)
    if (parent === dir) return undefined
    dir = parent
  }
}

// cz_change: a2 keeps opencode pristine, so opencode's skill loader scans
// `.opencode` config dirs (not `~/.clickzetta`) and without dot:true — it never
// discovers the ClickZetta builtin/home/project skill layers that origin/main
// found by patching opencode's config/paths.ts + skill loader. Re-home that
// discovery here (cz layer, opencode untouched) by injecting each ClickZetta
// skill LEAF dir (the dir directly holding a SKILL.md) into cfg.skills.paths.
// We inject leaves rather than the `.clickzetta/skills` root because the loader
// globs each path with dot:false and would not descend the hidden `.builtin`
// layer; a leaf dir has no hidden segment left to descend past (see the per-leaf
// enumeration in clickzettaSkillPaths). Non-existent roots are filtered so we
// never emit the loader's "skill path not found" warning (origin's glob is
// silent on missing dirs) —
// which also makes this inert until the release pipeline writes the builtin layer.
// The `.clickzetta` config roots opencode-origin scanned: project layer walking cwd →
// git worktree root inclusive (origin Filesystem.up start=cwd stop=worktree, paths.ts:20-27),
// then home layer (~/.clickzetta). Bounded at the worktree so we never scan above-repo
// .clickzetta dirs origin wouldn't; unbounded to fs root only when cwd isn't in a repo.
function clickzettaConfigRoots(): string[] {
  const home = process.env.CLICKZETTA_TEST_HOME || os.homedir()
  const roots: string[] = []
  const worktree = gitWorktreeRoot(process.cwd())
  let dir = process.cwd()
  while (true) {
    roots.push(path.join(dir, ".clickzetta"))
    if (dir === worktree) break
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  roots.push(path.join(home, ".clickzetta"))
  return roots
}

/** Parse `name:` from a SKILL.md YAML frontmatter. undefined if absent/unparseable —
 *  callers must NOT treat undefined as "cz-cli" (origin skips only on an exact match). */
function skillFrontmatterName(skillMd: string): string | undefined {
  const fence = skillMd.match(/^---\n([\s\S]*?)\n---/)
  const m = fence?.[1].match(/^name:[ \t]*(.+)$/m)
  return m ? m[1].trim().replace(/^["']|["']$/g, "") : undefined
}

function clickzettaSkillPaths(existing: string[]): string[] {
  const roots = clickzettaConfigRoots()

  const out: string[] = [...existing]
  const seen = new Set<string>(existing)
  for (const root of roots) {
    // origin globs `{skill,skills}/**/SKILL.md` with dot:true from each .clickzetta root
    // (skill/index.ts CLICKZETTA_SKILL_PATTERN, dot:true descends the hidden .builtin dir).
    // The loader has no per-skill exclude, so to replicate origin's cz-cli self-skip guard
    // (skill/index.ts:93-95 — loading a skill named "cz-cli" makes the agent recurse into
    // `cz-cli agent run`) we enumerate each SKILL.md leaf ourselves (recursive readdir also
    // descends .builtin) and inject each leaf dir EXCEPT the one whose frontmatter name is
    // "cz-cli". The loader then globs `**/SKILL.md` from each injected leaf.
    for (const sub of ["skills", "skill"]) {
      const base = path.join(root, sub)
      if (!existsSync(base)) continue
      let rels: string[]
      try {
        rels = readdirSync(base, { recursive: true }).map(String).filter((f) => path.basename(f) === "SKILL.md")
      } catch {
        continue
      }
      for (const rel of rels) {
        const skillMd = path.join(base, rel)
        const leaf = path.dirname(skillMd)
        if (seen.has(leaf)) continue
        seen.add(leaf)
        let name: string | undefined
        try {
          name = skillFrontmatterName(readFileSync(skillMd, "utf-8"))
        } catch {
          continue
        }
        if (name === "cz-cli") continue // self-recursion guard (origin skill/index.ts:95)
        out.push(leaf)
      }
    }
  }
  return out
}

// Discover ClickZetta plugin files under `.clickzetta/plugin{,s}/*.{ts,js}` across the
// same config roots, mirroring opencode-origin's plugin auto-discovery (config/plugin.ts:29
// Glob.scan("{plugin,plugins}/*.{ts,js}", {dot:true, symlink:true}) — single-level, dot ok).
// Returns file:// specifiers to merge into cfg.plugin. a2's pristine loader only scanned
// .opencode dirs, so .clickzetta plugins were dropped; this re-homes them (opencode untouched).
function clickzettaPluginSpecs(): string[] {
  const specs: string[] = []
  const seen = new Set<string>()
  for (const root of clickzettaConfigRoots()) {
    for (const sub of ["plugin", "plugins"]) {
      const base = path.join(root, sub)
      if (!existsSync(base)) continue
      let names: string[]
      try {
        names = readdirSync(base)
      } catch {
        continue
      }
      for (const name of names) {
        if (!/\.(ts|js)$/.test(name)) continue
        const p = path.join(base, name)
        if (seen.has(p)) continue
        seen.add(p)
        try {
          if (!statSync(p).isFile()) continue
        } catch {
          continue
        }
        specs.push(pathToFileURL(p).href)
      }
    }
  }
  return specs
}

/**
 * Extract `--timeout <seconds>` (or `--timeout=<seconds>`) from an argv array, honoring
 * the `--` passthrough boundary, and convert to milliseconds. Re-homes the validation
 * origin did in opencode/cli/cmd/run.ts (positive, finite seconds). Returns a positive
 * integer (ms) for a valid value, `null` when `--timeout` is present but invalid (caller
 * errors), and `undefined` when the flag is absent.
 */
export function parseAgentTimeoutMs(argv: string[]): number | null | undefined {
  let raw: string | undefined
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === "--") break
    if (a === "--timeout") {
      raw = argv[i + 1]
      break
    }
    if (a?.startsWith("--timeout=")) {
      raw = a.slice("--timeout=".length)
      break
    }
  }
  if (raw === undefined) return undefined
  const seconds = Number(raw)
  if (!Number.isFinite(seconds) || seconds <= 0) return null
  return Math.round(seconds * 1000)
}

export function injectClickzettaAgentConfig(agentTimeoutMs?: number) {
  const providerSpecifier = resolveClickzettaProviderSpecifier()
  const pluginSpecifier = resolveClickzettaPluginSpecifier()
  const llmConfig = readLlmConfig()
  const existing = parseConfigContent()
  const provider = {
    ...(rewriteProviders(llmConfig.provider, providerSpecifier) ?? {}),
    ...(rewriteProviders(existing.provider, providerSpecifier) ?? {}),
  }

  // cz_change: re-home origin's `agent run --timeout <seconds>` first-byte timeout.
  // origin set CLICKZETTA_AGENT_PROVIDER_TIMEOUT_MS and provider.ts applied it to every
  // provider's options.timeout; a2 dropped both and RENAMED first-byte timeout to
  // options.headerTimeout (provider.ts fetch wrapper clears headerTimeout once response
  // headers arrive — plain options.timeout is now a never-cleared whole-request deadline).
  // So the faithful mapping is headerTimeout. rewriteProviders returns the full provider
  // map, so this covers every configured provider — matching origin's Object.values loop.
  // Skip any provider already pinning either field (origin: `if options.timeout !== undefined continue`).
  if (agentTimeoutMs !== undefined) {
    for (const entry of Object.values(provider)) {
      if (!isRecord(entry)) continue
      const opts = isRecord(entry.options) ? entry.options : {}
      if (opts.headerTimeout === undefined && opts.timeout === undefined) {
        ;(entry as Record<string, unknown>).options = { ...opts, headerTimeout: agentTimeoutMs }
      }
    }
  }
  // Re-home ClickZetta `.clickzetta/plugin{,s}/*.{ts,js}` discovery (see
  // clickzettaPluginSpecs) alongside the always-on cz provider plugin. a2's
  // pristine loader only scans `.opencode`, so these were dropped.
  const plugin = mergePluginSpecs(llmConfig.plugin, existing.plugin, clickzettaPluginSpecs(), [pluginSpecifier])

  // Re-home ClickZetta skill discovery (see clickzettaSkillPaths). Preserve any
  // existing skills.urls and merge our .clickzetta roots into skills.paths.
  const existingSkills = isRecord(existing.skills) ? existing.skills : undefined
  const existingSkillPaths =
    existingSkills && Array.isArray(existingSkills.paths)
      ? (existingSkills.paths as unknown[]).filter((p): p is string => typeof p === "string")
      : []
  const skillPaths = clickzettaSkillPaths(existingSkillPaths)
  const skills = skillPaths.length > 0 ? { ...(existingSkills ?? {}), paths: skillPaths } : undefined

  // cz_change: hide the built-in opencode "OpenCode Zen" provider. Its custom loader
  // (opencode provider.ts) keeps free models even when unauthenticated, so it autoloads
  // and surfaces as the default provider name in the TUI footer/model picker for every
  // ClickZetta install. opencode's config supports `disabled_providers` (config.ts) which
  // both the footer (config.providers→provider.list()) and /connect (provider.list handler)
  // honor — so this removes OpenCode Zen with zero edits to opencode/tui. Dedup-merge with
  // any existing list so we never drop a user's own entry.
  const existingDisabled = Array.isArray(existing.disabled_providers)
    ? (existing.disabled_providers as unknown[]).filter((p): p is string => typeof p === "string")
    : []
  const disabledProviders = existingDisabled.includes("opencode")
    ? existingDisabled
    : [...existingDisabled, "opencode"]

  process.env.OPENCODE_CONFIG_CONTENT = JSON.stringify({
    ...existing,
    ...(Object.keys(provider).length > 0 ? { provider } : {}),
    ...(plugin ? { plugin } : {}),
    ...(skills ? { skills } : {}),
    disabled_providers: disabledProviders,
  })
}

// cz_change: restore the ClickZetta home logo in the TUI without touching
// packages/tui or packages/opencode. TUI plugins load from tui.json's `plugin`
// array, and opencode exposes OPENCODE_TUI_CONFIG as an explicit override file
// (config/tui.ts) that MERGES (deduped, user config still wins) rather than
// replaces. So we generate a tiny tui.json pointing at the bundled cz TUI brand
// plugin and set OPENCODE_TUI_CONFIG at it — mirroring how runtime.ts sets
// OPENCODE_CONFIG for llm.json. Best-effort: if the plugin asset is missing or
// the user already set OPENCODE_TUI_CONFIG, we skip and leave the upstream logo.
export function injectClickzettaTuiConfig() {
  if (process.env.OPENCODE_TUI_CONFIG) return // respect a user-provided override
  const spec = resolveClickzettaTuiPluginSpecifier()
  if (!spec) return // asset not bundled in this build — degrade to upstream logo

  const home = process.env.CLICKZETTA_TEST_HOME || os.homedir()
  const dir = path.join(home, ".clickzetta", "tui")
  const file = path.join(dir, "tui.json")
  try {
    mkdirSync(dir, { recursive: true })
    // A file:// spec so opencode resolves it directly (no npm install path).
    writeFileSync(file, JSON.stringify({ plugin: [spec] }, null, 2))
    process.env.OPENCODE_TUI_CONFIG = file
  } catch {
    // Non-fatal: leave OPENCODE_TUI_CONFIG unset → upstream logo, TUI still works.
  }
}

// cz_change: bridge our runtime env injection into the TUI's server Worker.
// The bare `agent` TUI runs its server in a Worker thread (opencode cli/cmd/tui.ts
// `new Worker(file)`), and Worker config (OPENCODE_CONFIG=llm.json,
// OPENCODE_CONFIG_CONTENT=provider/disabled_providers/plugins/skills) is read INSIDE
// that Worker via Flag/process.env. But Bun (unlike Node) snapshots a Worker's env at
// PROCESS START, not at `new Worker()` time — so our runtime `process.env.X = …`
// mutations (injectClickzettaAgentConfig / OPENCODE_CONFIG) never reach the Worker, and
// the TUI silently falls back to the public opencode "Zen" provider with none of the
// ClickZetta config. Bun DOES honor an explicit `{ env }` Worker option, so we wrap the
// global Worker (which opencode calls unqualified) to default `env` to the CURRENT
// process.env. Zero edits to opencode/tui; only fills env when the caller didn't pin one.
// Must run in the main process before the TUI handler constructs its Worker.
export function installClickzettaWorkerEnvShim() {
  const g = globalThis as unknown as { Worker?: typeof Worker; __czWorkerEnvShim?: boolean }
  if (g.__czWorkerEnvShim || typeof g.Worker !== "function") return
  const RealWorker = g.Worker
  class ClickzettaWorker extends RealWorker {
    constructor(scriptURL: string | URL, options?: WorkerOptions) {
      const opts = (options ?? {}) as WorkerOptions & { env?: unknown }
      super(scriptURL, (opts.env === undefined ? { ...opts, env: { ...process.env } } : opts) as WorkerOptions)
    }
  }
  g.Worker = ClickzettaWorker as unknown as typeof Worker
  g.__czWorkerEnvShim = true
}
