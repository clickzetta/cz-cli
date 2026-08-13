import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { readLlmConfig } from "../llm/native-config.js"
import { CLICKZETTA_AGENT_IDENTITY_PROMPT } from "../agent-identity-prompt.js"
import {
  CLICKZETTA_PROVIDER_NPM,
  isClickzettaGatewayUrl,
  normalizeClickzettaGatewayUrl,
} from "../llm/clickzetta-provider.js"
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

  const entries = Object.entries(value).map(([name, provider]) => {
    if (!shouldRewriteProvider(provider)) return [name, provider]
    const current = provider as Record<string, unknown>
    const options = isRecord(current.options) ? current.options : undefined
    const baseURL = typeof options?.baseURL === "string" ? options.baseURL : undefined
    return [
      name,
      {
        ...current,
        npm: providerSpecifier,
        ...(baseURL ? { options: { ...options, baseURL: normalizeClickzettaGatewayUrl(baseURL) } } : {}),
      },
    ]
  })
  const changed = entries.some(([, provider]) => isRecord(provider) && provider.npm === providerSpecifier)
  if (!changed) return undefined
  return Object.fromEntries(entries)
}

/**
 * cz_change: what OPENCODE_CONFIG_CONTENT may say about a provider that llm.json
 * already defines — the npm specifier, and NOTHING else.
 *
 * Both sources reach opencode: OPENCODE_CONFIG points at llm.json (merged in
 * config/config.ts) and this env var is merged AFTER it, so the env wins on any
 * field both carry. But the env var is a SNAPSHOT taken at process start, and the
 * TUI server reads it inside a Worker whose env is copied by value
 * (installClickzettaWorkerEnvShim) — no later write can reach it. Anything mutable
 * placed here therefore goes stale and then overwrites the live file with the stale
 * value.
 *
 * That is exactly how a rotated api_key stopped taking effect: the new key was
 * written to llm.json, the instance was rebuilt and re-read the file, and the frozen
 * snapshot put the spent key back. So only process-fixed facts belong here. The npm
 * specifier qualifies: it names an asset shipped beside the binary and cannot change
 * while the process lives — and it must be injected, because llm.json stores the bare
 * package name, which a compiled binary cannot resolve.
 *
 * `options.baseURL` qualifies too, for a different reason: it is process-fixed in
 * practice. Nothing rewrites a live entry's base_url — the quota/rotation path
 * touches api_key only and says so (llm/key-provision.ts leaves base_url and the
 * rest of the entry alone), and every writer that does set it (`ai-gateway
 * --add-to-llm`, `auth login`) runs in a separate CLI process. The one stale window
 * left is a `cz-cli auth login` that repoints the gateway host while a TUI is open;
 * that session keeps the old host until restart. Accepted deliberately, because the
 * alternative is worse:
 *
 * llm.json legitimately holds THREE base_url shapes — a bare host (what
 * `ai-gateway --add-to-llm` writes), `.../v1`, and `.../gateway/v1` — and
 * rewriteProviders above already normalizes all three. Dropping the result here sent
 * opencode the raw value, and while the provider package normalizes its own
 * options.baseURL before talking to the gateway (so inference worked), opencode's
 * model discovery reads options.baseURL directly and appends `/models`. A bare host
 * therefore requested `{host}/models`, which the gateway answers with 400 `40101
 * Invalid API key` — blaming the credential for a path bug — leaving the entry with
 * zero discovered models and a single phantom fallback. Carrying the normalized value
 * is what makes every reader on the opencode side agree on the base. Verified end to
 * end: bare host, `/v1` and `/gateway/v1` entries now all request
 * `{host}/gateway/v1/models` and resolve the gateway's full catalog.
 *
 * Everything else is dropped on purpose, verified against the real loader
 * (`opencode debug config` with these env vars resolves all three of the author's
 * providers, npm rewritten, apiKey supplied by the file):
 *   - `options.apiKey` is mutable (key rotation) and must come from the file.
 *   - `name` / `api` / `env` / `models` are read straight from the file by opencode.
 */
function providerNpmStubs(value: unknown, providerSpecifier: string) {
  const rewritten = rewriteProviders(value, providerSpecifier)
  if (!rewritten) return undefined
  const stubs = Object.entries(rewritten).flatMap(([name, provider]) => {
    if (!isRecord(provider) || provider.npm !== providerSpecifier) return []
    // The normalized base rewriteProviders just computed — see the doc above for why
    // this one derived field is carried while apiKey is not.
    const options = isRecord(provider.options) ? provider.options : undefined
    const baseURL = typeof options?.baseURL === "string" ? options.baseURL : undefined
    return [[name, { npm: providerSpecifier, ...(baseURL ? { options: { baseURL } } : {}) }] as const]
  })
  return stubs.length > 0 ? Object.fromEntries(stubs) : undefined
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

// cz_change: restore origin/main's cz-cli identity. On main, agent.ts:152 defined a
// native `data_engineer` primary agent and made it the default (agent.ts:311 fallback),
// and it inherited the cz-branded system prompt from session/prompt/default.txt. The
// a2 re-baseline keeps opencode pristine (upstream `build`/`plan`/`general` agents,
// upstream "You are opencode..." default.txt), so none of that identity survives.
//
// We re-home it here without touching opencode: opencode merges OPENCODE_CONFIG_CONTENT's
// `agent` map + `default_agent` field into its config (config.ts:467 → ConfigV1.Info
// supports both, core/v1/config/config.ts:80,93). Registering `data_engineer` with the
// branded prompt makes opencode's request builder use it verbatim as the system prompt
// (session/llm/request.ts:60 — `agent.prompt` replaces the pristine provider base prompt),
// which is exactly what main's promptless data_engineer achieved via the branded
// default.txt. Setting `default_agent` reproduces main's default-agent selection.
//
// User overrides win: we only set our agent/default_agent when the user hasn't already
// configured them (existing config is merged in first, and a user default_agent is kept).
// The operational cz-cli command reference is layered separately via
// CLICKZETTA_AGENT_SYSTEM_PROMPT (runtime.ts → opencode-plugin/system-prompt.ts), so it
// still appends on top of this identity for every agent.
function clickzettaDefaultAgent(existing: Record<string, unknown>): {
  agent?: Record<string, unknown>
  default_agent?: string
} {
  const existingAgent = isRecord(existing.agent) ? existing.agent : {}
  const userDataEngineer = isRecord(existingAgent.data_engineer) ? existingAgent.data_engineer : undefined

  // Register data_engineer only when the user hasn't defined it. Merge our defaults under
  // any user-provided fields so an explicit prompt/model/permission override still wins.
  const dataEngineer = {
    name: "data_engineer",
    description: "Data Engineer mode. Full tool access for ClickZetta Lakehouse data engineering tasks.",
    mode: "primary" as const,
    prompt: CLICKZETTA_AGENT_IDENTITY_PROMPT,
    ...(userDataEngineer ?? {}),
  }

  const agent = { ...existingAgent, data_engineer: dataEngineer }
  const existingDefault = typeof existing.default_agent === "string" ? existing.default_agent : undefined

  return {
    agent,
    default_agent: existingDefault ?? "data_engineer",
  }
}

export function injectClickzettaAgentConfig(agentTimeoutMs?: number) {
  const providerSpecifier = resolveClickzettaProviderSpecifier()
  const pluginSpecifier = resolveClickzettaPluginSpecifier()
  const llmConfig = readLlmConfig()
  const existing = parseConfigContent()
  const provider = {
    // opencode already merges llm.json itself (OPENCODE_CONFIG points at it), so only
    // the npm specifier is contributed here — see providerNpmStubs for why carrying
    // anything mutable is a bug rather than mere redundancy.
    ...(providerNpmStubs(llmConfig.provider, providerSpecifier) ?? {}),
    // Providers the user declared in their OWN OPENCODE_CONFIG_CONTENT have no file
    // behind them, so they keep every field — stubbing these would delete the only
    // copy of their apiKey.
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
    // llm.json-derived entries are npm-only stubs here (providerNpmStubs), so their
    // `options` are not visible on `entry` — the "already pinned" check has to consult
    // the file directly, or a user who set `options.timeout` in llm.json would silently
    // get a headerTimeout alongside it.
    const fileProviders = isRecord(llmConfig.provider) ? llmConfig.provider : {}
    const pinnedInFile = (name: string) => {
      const fromFile = fileProviders[name]
      if (!isRecord(fromFile)) return false
      const opts = isRecord(fromFile.options) ? fromFile.options : {}
      return opts.headerTimeout !== undefined || opts.timeout !== undefined
    }
    for (const [name, entry] of Object.entries(provider)) {
      if (!isRecord(entry)) continue
      const opts = isRecord(entry.options) ? entry.options : {}
      if (opts.headerTimeout === undefined && opts.timeout === undefined && !pinnedInFile(name)) {
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

  // cz_change: register the data_engineer default agent + its cz identity prompt.
  const { agent, default_agent } = clickzettaDefaultAgent(existing)

  // cz_change: carry llm.json's active model (config.model, format
  // `<entry>/<modelId>`, e.g. "claude-code/claude-sonnet-5") into
  // OPENCODE_CONFIG_CONTENT as the top-level `model`. When config.model is set
  // (user pinned it via `agent llm use`), this makes opencode honor that exact
  // selection. When it's unset, we inject nothing and opencode auto-selects
  // (recent → first available) — the intended behavior now that there's no
  // default_llm. A user/upstream-set model in `existing` still wins.
  const existingModel = typeof existing.model === "string" ? existing.model : undefined
  const defaultModel = existingModel ?? (typeof llmConfig.model === "string" ? llmConfig.model : undefined)

  process.env.OPENCODE_CONFIG_CONTENT = JSON.stringify({
    ...existing,
    ...(Object.keys(provider).length > 0 ? { provider } : {}),
    ...(plugin ? { plugin } : {}),
    ...(skills ? { skills } : {}),
    ...(agent ? { agent } : {}),
    ...(default_agent ? { default_agent } : {}),
    ...(defaultModel ? { model: defaultModel } : {}),
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
//
// cz_change: the same file also turns OFF upstream's built-in home tips plugin.
// `plugin_enabled` is a public TUI config field (packages/plugin/src/tui.ts) that
// opencode applies to INTERNAL builtins too, before activation
// (plugin/tui/runtime.ts applyInitialPluginEnabledState). Verified against the
// shipped binary: the tip that renders for cz users is
// "Use /connect with OpenCode Zen for curated, tested models" — upstream brand plus
// a pitch for a service cz users cannot use. Its sibling tips also name `opencode`
// subcommands that do not exist in cz-cli. Disabling is a config-only fix; the
// home_bottom slot could not do it (that slot is additive, not mode:replace).
// A user who toggles tips back on wins: the runtime layers kv OVER config.
const CZ_TUI_PLUGIN_ENABLED: Record<string, boolean> = {
  "internal:home-tips": false,
}

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
    writeFileSync(file, JSON.stringify({ plugin: [spec], plugin_enabled: CZ_TUI_PLUGIN_ENABLED }, null, 2))
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
