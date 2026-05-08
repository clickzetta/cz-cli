import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs"
import os from "os"
import path from "path"
import type { Argv } from "yargs"
import { parse as parseToml, stringify as stringifyToml } from "smol-toml"
import { cmd } from "./cmd"

const CLICKZETTA_DIR = path.join(os.homedir(), ".clickzetta")
const PROFILES_PATH = path.join(CLICKZETTA_DIR, "profiles.toml")

const VALID_PROVIDERS = ["anthropic", "openai", "openai-compatible", "bedrock", "google", "azure"] as const
const LEGACY_FIELDS = ["llm_provider", "llm_model", "llm_api_key", "llm_base_url"] as const

type TomlRecord = Record<string, unknown>

function isRecord(value: unknown): value is TomlRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function readProfiles(): TomlRecord {
  if (!existsSync(PROFILES_PATH)) return {}
  try {
    const content = readFileSync(PROFILES_PATH, "utf-8")
    const parsed = parseToml(content)
    return isRecord(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

function writeProfiles(data: TomlRecord): void {
  mkdirSync(CLICKZETTA_DIR, { recursive: true })
  writeFileSync(PROFILES_PATH, stringifyToml(data as never) + "\n")
}

function getLlms(data: TomlRecord): TomlRecord {
  return isRecord(data.llm) ? (data.llm as TomlRecord) : {}
}

function getDefaultProfileName(data: TomlRecord): string {
  return typeof data.default_profile === "string" ? data.default_profile : "default"
}

function getProfileSection(data: TomlRecord, name: string): TomlRecord | undefined {
  const profiles = isRecord(data.profiles) ? data.profiles : undefined
  if (!profiles) return undefined
  return isRecord(profiles[name]) ? profiles[name] : undefined
}

function mask(value: string | undefined): string | null {
  if (!value) return null
  if (value.length <= 8) return value.slice(0, 2) + "..."
  return value.slice(0, 8) + "..."
}

function fail(isTTY: boolean, code: string, message: string, extra: Record<string, unknown> = {}): never {
  if (isTTY) {
    process.stderr.write(`  Error: ${message}\n`)
  } else {
    process.stdout.write(JSON.stringify({ error: { code, message, ...extra } }) + "\n")
  }
  process.exit(1)
}

function ok(isTTY: boolean, ttyMessage: string, jsonData: Record<string, unknown>): never {
  if (isTTY) {
    process.stderr.write(ttyMessage)
  } else {
    process.stdout.write(JSON.stringify({ data: jsonData }) + "\n")
  }
  process.exit(0)
}

function describeActive(data: TomlRecord): { kind: "llm" | "clickzetta" | "none"; name: string; detail: string } {
  const llms = getLlms(data)
  const defaultLlm = typeof data.default_llm === "string" ? data.default_llm : null
  if (defaultLlm && isRecord(llms[defaultLlm])) {
    const entry = llms[defaultLlm] as TomlRecord
    const provider = typeof entry.provider === "string" ? entry.provider : "?"
    const apiKey = typeof entry.api_key === "string" ? entry.api_key : null
    const model = typeof entry.model === "string" ? entry.model : null
    if (provider !== "?" && apiKey) {
      const detail = model ? `${provider}/${model} (via default_llm)` : `${provider} (via default_llm)`
      return { kind: "llm", name: defaultLlm, detail }
    }
  }
  const profileName = getDefaultProfileName(data)
  const profile = getProfileSection(data, profileName)
  if (profile && typeof profile.api_key === "string") {
    return {
      kind: "clickzetta",
      name: profileName,
      detail: `ClickZetta built-in (profile "${profileName}") — deepseek-v4-pro`,
    }
  }
  return { kind: "none", name: "", detail: "none configured" }
}

// ─── list ─────────────────────────────────────────────────────────────────────
const LlmListCommand = cmd({
  command: "list",
  aliases: ["ls"],
  describe: "list defined [llm.*] entries by name",
  async handler() {
    const isTTY = process.stderr.isTTY
    const data = readProfiles()
    const llms = getLlms(data)
    const names = Object.keys(llms).filter((n) => isRecord(llms[n]))
    const defaultLlm = typeof data.default_llm === "string" ? data.default_llm : null
    if (isTTY) {
      if (names.length === 0) {
        process.stderr.write("  (no user-defined LLMs — falling back to ClickZetta built-in)\n")
      } else {
        for (const n of names) {
          const marker = n === defaultLlm ? "* " : "  "
          process.stdout.write(`${marker}${n}\n`)
        }
      }
    } else {
      process.stdout.write(JSON.stringify({ data: { llms: names, default_llm: defaultLlm } }) + "\n")
    }
    process.exit(0)
  },
})

// ─── show ─────────────────────────────────────────────────────────────────────
const LlmShowCommand = cmd({
  command: "show",
  describe: "show the active LLM, all defined LLMs, and the ClickZetta fallback",
  async handler() {
    const isTTY = process.stderr.isTTY
    const data = readProfiles()
    const active = describeActive(data)
    const llms = getLlms(data)
    const profileName = getDefaultProfileName(data)
    const profileSection = getProfileSection(data, profileName)

    const legacyHints: string[] = []
    if (isRecord(data.profiles)) {
      for (const [pName, p] of Object.entries(data.profiles)) {
        if (!isRecord(p)) continue
        const legacy = LEGACY_FIELDS.filter((f) => f in p)
        if (legacy.length > 0) legacyHints.push(`[profiles.${pName}] has deprecated: ${legacy.join(", ")}`)
      }
    }

    const entries: Array<{
      name: string
      provider: string | null
      model: string | null
      api_key: string | null
      base_url: string | null
    }> = []
    for (const [n, raw] of Object.entries(llms)) {
      if (!isRecord(raw)) continue
      entries.push({
        name: n,
        provider: typeof raw.provider === "string" ? raw.provider : null,
        model: typeof raw.model === "string" ? raw.model : null,
        api_key: typeof raw.api_key === "string" ? mask(raw.api_key) : null,
        base_url: typeof raw.base_url === "string" ? raw.base_url : null,
      })
    }

    const clickzetta = profileSection
      ? {
          profile: profileName,
          api_key: typeof profileSection.api_key === "string" ? mask(profileSection.api_key) : null,
          aimesh_endpoint:
            typeof profileSection.aimesh_endpoint === "string" ? profileSection.aimesh_endpoint : null,
        }
      : null

    if (isTTY) {
      process.stderr.write("\n")
      if (active.kind === "llm") {
        process.stderr.write(`  Active: [llm.${active.name}]  ${active.detail}\n`)
      } else if (active.kind === "clickzetta") {
        process.stderr.write(`  Active: ${active.detail}\n`)
      } else {
        process.stderr.write("  Active: (none) — run `cz-cli setup` or `cz-cli agent llm add`\n")
      }
      process.stderr.write("\n")

      if (entries.length > 0) {
        process.stderr.write("  Defined LLMs:\n")
        for (const e of entries) {
          const mark = e.name === active.name && active.kind === "llm" ? "*" : " "
          const provModel = e.model ? `${e.provider ?? "?"}/${e.model}` : `${e.provider ?? "?"} (default model)`
          process.stderr.write(`    ${mark} [llm.${e.name}]   ${provModel}\n`)
          if (e.base_url) process.stderr.write(`        base_url: ${e.base_url}\n`)
          process.stderr.write(`        api_key:  ${e.api_key ?? "(missing)"}\n`)
        }
        process.stderr.write("\n")
      }

      if (clickzetta) {
        process.stderr.write("  ClickZetta built-in (fallback):\n")
        process.stderr.write(`    profile:         ${clickzetta.profile}\n`)
        process.stderr.write(`    api_key:         ${clickzetta.api_key ?? "(not set)"}\n`)
        process.stderr.write(`    aimesh_endpoint: ${clickzetta.aimesh_endpoint ?? "(not set)"}\n\n`)
      }

      if (entries.length === 0) {
        process.stderr.write("  Add your own LLM:\n")
        process.stderr.write(
          "    cz-cli agent llm add my-claude --provider anthropic --api-key sk-ant-... --use\n\n",
        )
      }

      if (legacyHints.length > 0) {
        process.stderr.write("  Warning: deprecated legacy fields found:\n")
        for (const h of legacyHints) process.stderr.write(`    ${h}\n`)
        process.stderr.write("  Clean up with: cz-cli agent llm purge-legacy\n\n")
      }
    } else {
      process.stdout.write(
        JSON.stringify({
          data: {
            active: { kind: active.kind, name: active.name, detail: active.detail },
            llms: entries,
            clickzetta,
            legacy_fields: legacyHints,
          },
        }) + "\n",
      )
    }
    process.exit(0)
  },
})

// ─── add ──────────────────────────────────────────────────────────────────────
const LlmAddCommand = cmd({
  command: "add <name>",
  describe: "add or update an [llm.<name>] entry",
  builder: (yargs: Argv) =>
    yargs
      .positional("name", { type: "string", describe: "entry name, e.g. my-claude", demandOption: true })
      .option("provider", {
        type: "string",
        alias: ["llm-provider"],
        describe: `provider: ${VALID_PROVIDERS.join(", ")}`,
      })
      .option("model", { type: "string", alias: ["llm-model"], describe: "model ID (e.g. claude-sonnet-4-6)" })
      .option("api-key", { type: "string", alias: ["llm-api-key"], describe: "API key for the provider" })
      .option("base-url", {
        type: "string",
        alias: ["llm-base-url"],
        describe: "base URL (for third-party relays; required for openai-compatible)",
      })
      .option("use", {
        type: "boolean",
        alias: ["set-default"],
        describe: "after writing, set default_llm to this entry",
      })
      .example(
        "$0 agent llm add my-claude --provider anthropic --api-key sk-ant-... --use",
        "add Claude and make it the default (model auto-selected)",
      )
      .example("$0 agent llm add my-openai --provider openai --api-key sk-...", "add OpenAI (not default)")
      .example("$0 agent llm add my-claude --provider anthropic --api-key sk-ant-... --model claude-opus-4-1 --use", "add Claude with specific model"),
  async handler(args) {
    const opts = args as {
      name: string
      provider?: string
      model?: string
      apiKey?: string
      baseUrl?: string
      use?: boolean
    }
    const isTTY = process.stderr.isTTY
    const name = opts.name

    if (opts.provider && !VALID_PROVIDERS.includes(opts.provider as (typeof VALID_PROVIDERS)[number])) {
      fail(
        isTTY,
        "INVALID_PROVIDER",
        `Invalid provider "${opts.provider}". Valid: ${VALID_PROVIDERS.join(", ")}`,
        { valid_providers: [...VALID_PROVIDERS] },
      )
    }

    const data = readProfiles()
    const llms = getLlms(data)
    const entry: TomlRecord = isRecord(llms[name]) ? { ...(llms[name] as TomlRecord) } : {}
    const isNew = !isRecord(llms[name])

    if (opts.provider) entry.provider = opts.provider
    if (opts.model) entry.model = opts.model
    if (opts.apiKey) entry.api_key = opts.apiKey
    if (opts.baseUrl) entry.base_url = opts.baseUrl

    // Validate that a newly-added entry has the required pair.
    if (isNew) {
      const missing = ["provider", "api_key"].filter((k) => typeof entry[k] !== "string")
      if (missing.length > 0) {
        fail(
          isTTY,
          "MISSING_FIELDS",
          `[llm.${name}] requires --provider and --api-key on first add. Missing: ${missing.join(", ")}`,
          { missing },
        )
      }
    }

    llms[name] = entry
    data.llm = llms
    if (opts.use) data.default_llm = name
    writeProfiles(data)

    const action = isNew ? "added" : "updated"
    const ttyOut = [
      `\n  [llm.${name}] ${action}`,
      opts.provider && `    provider: ${opts.provider}`,
      opts.model && `    model:    ${opts.model}`,
      opts.apiKey && `    api_key:  ${mask(opts.apiKey)}`,
      opts.baseUrl && `    base_url: ${opts.baseUrl}`,
      opts.use && `    default_llm = "${name}"`,
      "",
      "",
    ]
      .filter(Boolean)
      .join("\n")

    ok(isTTY, ttyOut, {
      message: `[llm.${name}] ${action}.`,
      name,
      provider: opts.provider,
      model: opts.model,
      base_url: opts.baseUrl,
      used: !!opts.use,
    })
  },
})

// ─── use ──────────────────────────────────────────────────────────────────────
const LlmUseCommand = cmd({
  command: "use <name>",
  describe: "select which [llm.<name>] to use (sets top-level default_llm)",
  builder: (yargs: Argv) =>
    yargs.positional("name", { type: "string", describe: "entry name", demandOption: true }),
  async handler(args) {
    const isTTY = process.stderr.isTTY
    const name = (args as { name: string }).name
    const data = readProfiles()
    const llms = getLlms(data)
    if (!isRecord(llms[name])) {
      fail(isTTY, "NOT_FOUND", `[llm.${name}] not defined. Run \`cz-cli agent llm list\` to see available entries.`)
    }
    data.default_llm = name
    writeProfiles(data)
    ok(isTTY, `\n  default_llm = "${name}"\n\n`, { message: `default_llm set to ${name}.`, default_llm: name })
  },
})

// ─── remove ───────────────────────────────────────────────────────────────────
const LlmRemoveCommand = cmd({
  command: "remove <name>",
  aliases: ["rm"],
  describe: "remove an [llm.<name>] entry",
  builder: (yargs: Argv) =>
    yargs.positional("name", { type: "string", describe: "entry name", demandOption: true }),
  async handler(args) {
    const isTTY = process.stderr.isTTY
    const name = (args as { name: string }).name
    const data = readProfiles()
    const llms = getLlms(data)
    if (!isRecord(llms[name])) {
      ok(isTTY, `  [llm.${name}] not found — nothing to remove.\n`, {
        message: `[llm.${name}] not found.`,
        removed: false,
      })
    }
    delete llms[name]
    if (Object.keys(llms).length === 0) delete data.llm
    else data.llm = llms
    const clearedDefault = data.default_llm === name
    if (clearedDefault) delete data.default_llm
    writeProfiles(data)
    const note = clearedDefault ? " (also cleared default_llm — falling back to ClickZetta)" : ""
    ok(isTTY, `\n  [llm.${name}] removed.${note}\n\n`, {
      message: `[llm.${name}] removed.`,
      removed: true,
      cleared_default: clearedDefault,
    })
  },
})

// ─── reset ────────────────────────────────────────────────────────────────────
const LlmResetCommand = cmd({
  command: "reset",
  describe: "clear default_llm so cz-cli falls back to the ClickZetta built-in LLM",
  async handler() {
    const isTTY = process.stderr.isTTY
    const data = readProfiles()
    const had = "default_llm" in data
    delete data.default_llm
    writeProfiles(data)
    const msg = had ? "default_llm cleared — using ClickZetta built-in LLM." : "default_llm was not set."
    ok(isTTY, `\n  ${msg}\n\n`, { message: msg, had_default: had })
  },
})

// ─── purge-legacy ─────────────────────────────────────────────────────────────
const LlmPurgeLegacyCommand = cmd({
  command: "purge-legacy",
  describe: "remove deprecated llm_* fields from all [profiles.*] sections (api_key/aimesh_endpoint untouched)",
  async handler() {
    const isTTY = process.stderr.isTTY
    const data = readProfiles()
    const profiles = isRecord(data.profiles) ? (data.profiles as TomlRecord) : {}
    const removed: Record<string, string[]> = {}
    for (const [pName, raw] of Object.entries(profiles)) {
      if (!isRecord(raw)) continue
      const removedHere: string[] = []
      for (const field of LEGACY_FIELDS) {
        if (field in raw) {
          delete raw[field]
          removedHere.push(field)
        }
      }
      if (removedHere.length > 0) removed[pName] = removedHere
    }
    writeProfiles(data)
    const anyRemoved = Object.keys(removed).length > 0
    if (isTTY) {
      if (!anyRemoved) {
        process.stderr.write("\n  No legacy llm_* fields found.\n\n")
      } else {
        process.stderr.write("\n  Removed legacy fields:\n")
        for (const [p, fields] of Object.entries(removed)) {
          process.stderr.write(`    [profiles.${p}]: ${fields.join(", ")}\n`)
        }
        process.stderr.write("\n")
      }
    } else {
      process.stdout.write(JSON.stringify({ data: { removed } }) + "\n")
    }
    process.exit(0)
  },
})

// ─── parent: `agent llm` (alias: `agent config`) ──────────────────────────────
export const AgentLlmCommand = cmd({
  command: "llm",
  aliases: ["config"],
  describe:
    "manage LLMs used by the agent (user-defined [llm.*] in ~/.clickzetta/profiles.toml). Falls back to the ClickZetta built-in LLM when none is selected.",
  builder: (yargs: Argv) =>
    yargs
      .command(LlmListCommand)
      .command(LlmShowCommand)
      .command(LlmAddCommand)
      .command(LlmUseCommand)
      .command(LlmRemoveCommand)
      .command(LlmResetCommand)
      .command(LlmPurgeLegacyCommand)
      .demandCommand(1, "run `cz-cli agent llm --help` to see available subcommands")
      .example("$0 agent llm show", "see which LLM is active and what is defined")
      .example(
        "$0 agent llm add my-claude --provider anthropic --api-key sk-ant-... --use",
        "add Claude and select it (model auto-selected from provider defaults)",
      )
      .example("$0 agent llm use my-openai", "switch to a different entry")
      .example("$0 agent llm reset", "fall back to the ClickZetta built-in LLM"),
  async handler() {},
})

// Back-compat export — callers that still import AgentConfigCommand get the new command.
export const AgentConfigCommand = AgentLlmCommand
