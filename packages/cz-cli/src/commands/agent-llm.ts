import type { Argv, CommandModule } from "yargs"
import { commandGroup } from "../command-group.js"
import { maybeRotateExhaustedClickzettaLlm } from "../llm/clickzetta-rotation.js"
import { readLlmEntries, writeLlmEntries, type LlmEntryView } from "../llm/native-config.js"
import { buildLlmProbeRequest, normalizeLlmBaseUrl } from "../llm/probe.js"

const VALID_PROVIDERS = [
  "clickzetta",
  "anthropic",
  "openai",
  "openai-compatible",
  "bedrock",
  "google",
  "azure",
  "openrouter",
] as const
const TESTABLE_PROVIDERS = ["clickzetta", "anthropic", "openai", "openai-compatible", "openrouter", "google", "azure"] as const
const DEFAULT_BASE_URLS = {
  openai: "https://api.openai.com",
  openrouter: "https://openrouter.ai/api",
} as const

type LlmState = {
  llm: Record<string, LlmEntryView>
  default_llm?: string
}

type LlmTarget = {
  name: string
  provider?: string
  apiKey?: string
  baseUrl?: string
  model?: string
  source: "llm"
}

function cmd<T, U>(input: CommandModule<T, U>) {
  return input
}

function readState(): LlmState {
  const { llm, default_llm } = readLlmEntries()
  return {
    llm: Object.fromEntries(Object.entries(llm).map(([name, entry]) => [name, { ...entry }])),
    ...(default_llm ? { default_llm } : {}),
  }
}

function writeState(state: LlmState) {
  writeLlmEntries({
    llm: state.llm,
    ...(state.default_llm ? { default_llm: state.default_llm } : {}),
  })
}

function mask(value: string | undefined): string | null {
  if (!value) return null
  if (value.length <= 8) return value.slice(0, 2) + "..."
  return value.slice(0, 8) + "..."
}

function onboarding() {
  return {
    clickzetta_builtin: [
      "cz-cli setup --credential <base64_string>",
    ],
    external_llm: [
      "cz-cli agent llm add my-openai --provider openai --api-key <OPENAI_API_KEY> --use",
      "cz-cli agent llm add my-relay --provider openai-compatible --base-url https://aitoken.clickzetta.com/apikey --api-key <API_KEY> --use",
    ],
    verify: [
      "cz-cli agent llm test",
      "cz-cli agent llm test <NAME>",
    ],
    lakehouse_setup: [
      "cz-cli setup",
      "cz-cli setup --username <username> --password <password> --account-name <account_name>",
    ],
  }
}

function writeOnboarding() {
  const guide = onboarding()
  process.stderr.write("  No LLM configured yet.\n")
  process.stderr.write("  ClickZetta built-in LLM:\n")
  for (const step of guide.clickzetta_builtin) process.stderr.write(`    ${step}\n`)
  process.stderr.write("\n")
  process.stderr.write("  External LLMs:\n")
  for (const step of guide.external_llm) process.stderr.write(`    ${step}\n`)
  process.stderr.write("\n")
  process.stderr.write("  Verify after adding one:\n")
  for (const step of guide.verify) process.stderr.write(`    ${step}\n`)
  process.stderr.write("\n")
  process.stderr.write("  Note: Lakehouse connection setup is separate:\n")
  for (const step of guide.lakehouse_setup) process.stderr.write(`    ${step}\n`)
  process.stderr.write("\n")
}

function getOnboardingData() {
  return {
    onboarding: onboarding(),
  }
}

function truncate(value: string): string {
  if (value.length <= 240) return value
  return value.slice(0, 237) + "..."
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

function responseDetail(text: string): string | null {
  const parsed = safeJson(text)
  if (parsed !== undefined) return truncate(JSON.stringify(parsed))
  const trimmed = text.trim()
  if (!trimmed) return null
  return truncate(trimmed)
}

function completionSummary(body: unknown): string | null {
  if (typeof body !== "object" || body === null || !("choices" in body) || !Array.isArray(body.choices)) return null
  const first = body.choices[0]
  if (typeof first !== "object" || first === null || !("message" in first) || typeof first.message !== "object" || first.message === null) return null
  return typeof first.message.content === "string" ? truncate(first.message.content) : null
}

function anthropicSummary(body: unknown): string | null {
  if (typeof body !== "object" || body === null || !("content" in body) || !Array.isArray(body.content)) return null
  const first = body.content[0]
  if (typeof first !== "object" || first === null || first.type !== "text") return null
  return typeof first.text === "string" ? truncate(first.text) : null
}

function googleSummary(body: unknown): string | null {
  if (typeof body !== "object" || body === null || !("candidates" in body) || !Array.isArray(body.candidates)) return null
  const first = body.candidates[0]
  if (typeof first !== "object" || first === null || !("content" in first) || typeof first.content !== "object" || first.content === null) return null
  const parts = first.content.parts
  if (!Array.isArray(parts)) return null
  const part = parts[0]
  if (typeof part !== "object" || part === null) return null
  return typeof part.text === "string" ? truncate(part.text) : null
}

function resolveBaseUrl(provider: string, baseUrl: string | undefined): string | undefined {
  if (provider === "openai") {
    return normalizeLlmBaseUrl(provider, baseUrl ?? DEFAULT_BASE_URLS.openai)
  }
  if (provider === "openrouter") {
    return normalizeLlmBaseUrl("openai-compatible", baseUrl ?? DEFAULT_BASE_URLS.openrouter)
  }
  return normalizeLlmBaseUrl(provider, baseUrl)
}

function resolveEntryName(state: LlmState): string | undefined {
  return typeof state.default_llm === "string" ? state.default_llm : undefined
}

function resolveLlmTarget(state: LlmState, name?: string): LlmTarget | undefined {
  const targetName = name ?? resolveEntryName(state)
  if (!targetName) return undefined
  const entry = state.llm[targetName]
  if (!entry) return undefined
  return {
    name: targetName,
    provider: entry.provider,
    apiKey: entry.api_key,
    baseUrl: entry.base_url,
    model: entry.model,
    source: "llm",
  }
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

function describeActive(state: LlmState): { kind: "llm" | "none"; name: string; detail: string } {
  const name = resolveEntryName(state)
  if (!name) return { kind: "none", name: "", detail: "none configured" }
  const entry = state.llm[name]
  if (!entry?.provider || !entry.api_key) return { kind: "none", name: "", detail: "none configured" }
  const detail = entry.model ? `${entry.provider}/${entry.model} (via default_llm)` : `${entry.provider} (via default_llm)`
  return { kind: "llm", name, detail }
}

const LlmListCommand = cmd({
  command: "list",
  aliases: ["ls"],
  describe: "list configured agent LLM entries by name",
  async handler() {
    const isTTY = process.stderr.isTTY
    const state = readState()
    const names = Object.keys(state.llm)
    const defaultLlm = resolveEntryName(state) ?? null
    if (isTTY) {
      if (names.length === 0) {
        process.stderr.write("  (no agent LLM entries configured)\n")
      } else {
        for (const name of names) {
          const marker = name === defaultLlm ? "* " : "  "
          process.stdout.write(`${marker}${name}\n`)
        }
      }
    } else {
      process.stdout.write(JSON.stringify({ data: { llms: names, default_llm: defaultLlm } }) + "\n")
    }
    process.exit(0)
  },
})

const LlmShowCommand = cmd({
  command: "show",
  describe: "show the active LLM, all defined LLMs, and setup guidance",
  async handler() {
    const isTTY = process.stderr.isTTY
    const state = readState()
    const active = describeActive(state)
    const entries = Object.entries(state.llm).map(([name, entry]) => ({
      name,
      provider: entry.provider ?? null,
      model: entry.model ?? null,
      api_key: mask(entry.api_key),
      base_url: entry.base_url ?? null,
    }))

    if (isTTY) {
      process.stderr.write("\n")
      if (active.kind === "llm") {
        process.stderr.write(`  Active agent LLM: ${active.name}  ${active.detail}\n`)
      } else {
        process.stderr.write("  Active: (none)\n")
      }
      process.stderr.write("\n")

      if (entries.length > 0) {
        process.stderr.write("  Defined LLMs:\n")
        for (const entry of entries) {
          const mark = entry.name === active.name && active.kind === "llm" ? "*" : " "
          const providerModel = entry.model ? `${entry.provider ?? "?"}/${entry.model}` : `${entry.provider ?? "?"} (default model)`
          process.stderr.write(`    ${mark} ${entry.name}   ${providerModel}\n`)
          if (entry.base_url) process.stderr.write(`        base_url: ${entry.base_url}\n`)
          process.stderr.write(`        api_key:  ${entry.api_key ?? "(missing)"}\n`)
        }
        process.stderr.write("\n")
      }

      if (entries.length === 0) writeOnboarding()
    } else {
      process.stdout.write(
        JSON.stringify({
          data: {
            active: { kind: active.kind, name: active.name, detail: active.detail },
            llms: entries,
            ...getOnboardingData(),
          },
        }) + "\n",
      )
    }
    process.exit(0)
  },
})

const LlmAddCommand = cmd({
  command: "add <name>",
  describe: "add or update an agent LLM entry",
  builder: (yargs: Argv) =>
    yargs
      .positional("name", { type: "string", describe: "entry name, e.g. my-claude", demandOption: true })
      .option("provider", {
        type: "string",
        alias: ["llm-provider"],
        describe: `provider: ${VALID_PROVIDERS.join(", ")}`,
      })
      .option("model", {
        type: "string",
        alias: ["llm-model"],
        describe: "model ID to use by default when this entry is selected via default_llm and config.model is unset",
      })
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
        "$0 llm add my-claude --provider anthropic --api-key sk-ant-... --use",
        "add Claude and make it the default (model auto-selected)",
      )
      .example("$0 llm add my-openai --provider openai --api-key sk-...", "add OpenAI (not default)")
      .example("$0 llm add my-claude --provider anthropic --api-key sk-ant-... --model claude-opus-4-1 --use", "add Claude with specific model"),
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

    const state = readState()
    const llms = { ...state.llm }
    const entry = { ...(llms[name] ?? {}) }
    const isNew = !(name in llms)

    if (opts.provider) entry.provider = opts.provider
    if (opts.model) entry.model = opts.model
    if (opts.apiKey) entry.api_key = opts.apiKey
    if (opts.baseUrl) {
      const provider = typeof entry.provider === "string" ? entry.provider : ""
      entry.base_url = resolveBaseUrl(provider, opts.baseUrl) ?? opts.baseUrl
    }

    if (isNew) {
      const missing = ["provider", "api_key"].filter((field) => typeof entry[field as keyof LlmEntryView] !== "string")
      if (missing.length > 0) {
        fail(
          isTTY,
          "MISSING_FIELDS",
          `LLM entry '${name}' requires --provider and --api-key on first add. Missing: ${missing.join(", ")}`,
          { missing },
        )
      }
    }
    if (entry.provider === "openai-compatible" && typeof entry.base_url !== "string") {
      fail(
        isTTY,
        "PROVIDER_REQUIRES_BASE_URL",
        "LLM entry '" + name + "' uses provider \"openai-compatible\" and requires --base-url.\n" +
          "  Example: cz-cli agent llm add " + name +
          " --provider openai-compatible --base-url https://aitoken.clickzetta.com/apikey --api-key <API_KEY> --use",
        { provider: entry.provider, required: ["base_url"] },
      )
    }

    llms[name] = entry
    writeState({
      llm: llms,
      ...(opts.use ? { default_llm: name } : state.default_llm ? { default_llm: state.default_llm } : {}),
    })

    const action = isNew ? "added" : "updated"
    const ttyOut = [
      `\n  Agent LLM '${name}' ${action}`,
      entry.provider && `    provider: ${entry.provider}`,
      entry.model && `    model:    ${entry.model}`,
      entry.api_key && `    api_key:  ${mask(entry.api_key)}`,
      entry.base_url && `    base_url: ${entry.base_url}`,
      opts.use && `    default_llm = "${name}"`,
      "",
      "",
    ]
      .filter(Boolean)
      .join("\n")

    ok(isTTY, ttyOut, {
      message: `Agent LLM '${name}' ${action}.`,
      name,
      provider: entry.provider,
      model: entry.model,
      base_url: entry.base_url,
      used: !!opts.use,
    })
  },
})

const LlmTestCommand = cmd({
  command: "test [name]",
  describe: "test the active or named LLM entry with a lightweight connectivity probe",
  builder: (yargs: Argv) =>
    yargs.positional("name", { type: "string", describe: "entry name; defaults to default_llm" }),
  async handler(args) {
    const isTTY = process.stderr.isTTY
    const name = typeof args.name === "string" ? args.name : undefined
    const target = resolveLlmTarget(readState(), name)

    if (!target) {
      fail(
        isTTY,
        "NO_ACTIVE_LLM",
        "No active LLM is configured. Run `cz-cli agent llm show` for setup paths.",
        onboarding(),
      )
    }

    if (!target.provider || !TESTABLE_PROVIDERS.includes(target.provider as (typeof TESTABLE_PROVIDERS)[number])) {
      fail(
        isTTY,
        "UNSUPPORTED_PROVIDER_TEST",
        `Agent LLM '${target.name}' uses provider "${target.provider ?? "unknown"}". ` +
          `Testing is currently supported for: ${TESTABLE_PROVIDERS.join(", ")}. Bedrock requires AWS SigV4 and cannot be probed this way.`,
        {
          provider: target.provider ?? null,
          supported_providers: [...TESTABLE_PROVIDERS],
        },
      )
    }

    if (!target.apiKey) {
      fail(
        isTTY,
        "MISSING_API_KEY",
        `Agent LLM '${target.name}' is missing api_key. Update it with \`cz-cli agent llm add ${target.name} --api-key <API_KEY>\`.`,
      )
    }

    const buildProbe = (value: string) => buildLlmProbeRequest(target.provider!, target.baseUrl, value, target.model)
    let probe = buildProbe(target.apiKey)
    if (!probe) {
      fail(
        isTTY,
        "MISSING_BASE_URL",
        `Agent LLM '${target.name}' needs a base_url before it can be tested.\n` +
          `  Update it with: cz-cli agent llm add ${target.name} --base-url https://aitoken.clickzetta.com/apikey`,
      )
    }

    let response: Response
    let text = ""
    let resultUrl = ""
    let displayUrl = ""
    for (const attempt of [0, 1]) {
      const { url, method, headers, body } = probe
      resultUrl = url
      displayUrl = url.replace(/[?&]key=[^&]+/, "?key=***")
      try {
        response = await fetch(url, {
          method,
          headers,
          body,
        })
      } catch (error) {
        fail(
          isTTY,
          "LLM_TEST_REQUEST_FAILED",
          `Could not reach ${displayUrl}: ${error instanceof Error ? error.message : String(error)}`,
          { provider: target.provider, url: displayUrl },
        )
      }

      text = await response.text()
      if (response.ok) break
      const detail = responseDetail(text)
      if (attempt === 0) {
        const rotated = await maybeRotateExhaustedClickzettaLlm({
          provider: target.provider,
          status: response.status,
          detail,
          approval: isTTY ? "prompt" : "auto",
        })
        if (rotated && "rotated" in rotated) {
          probe = buildProbe(rotated.apiKey)
          if (probe) continue
        }
      }
      fail(
        isTTY,
        "LLM_TEST_HTTP_ERROR",
        `LLM test failed with HTTP ${response.status} for ${displayUrl}${detail ? `: ${detail}` : ""}`,
        {
          provider: target.provider,
          url: displayUrl,
          status: response.status,
          detail,
        },
      )
    }

    const body = safeJson(text)
    const completion = completionSummary(body) ?? anthropicSummary(body) ?? googleSummary(body)
    const ttyOut = [
      `\n  Agent LLM '${target.name}' test passed`,
      `    provider: ${target.provider}`,
      `    url:      ${displayUrl}`,
      `    response: ${completion ?? "(endpoint reachable; completion returned)"}`,
      "",
      "",
    ].join("\n")

    ok(isTTY, ttyOut, {
      message: `Agent LLM '${target.name}' test passed.`,
      name: target.name,
      provider: target.provider,
      // Use the redacted URL: for the Google provider the probe carries the API
      // key in the query string (?key=...). resultUrl is raw; displayUrl masks it.
      url: displayUrl,
      model: target.model ?? null,
      probe: "chat.completions",
      sample_response: completion,
      source: target.source,
    })
  },
})

const LlmUseCommand = cmd({
  command: "use <name>",
  describe: "select which agent LLM entry to use (sets top-level default_llm)",
  builder: (yargs: Argv) =>
    yargs.positional("name", { type: "string", describe: "entry name", demandOption: true }),
  async handler(args) {
    const isTTY = process.stderr.isTTY
    const name = (args as { name: string }).name
    const state = readState()
    if (!state.llm[name]) {
      fail(isTTY, "NOT_FOUND", `Agent LLM '${name}' is not defined. Run \`cz-cli agent llm list\` to see available entries.`)
    }
    writeState({ llm: state.llm, default_llm: name })
    ok(isTTY, `\n  default_llm = "${name}"\n\n`, { message: `default_llm set to ${name}.`, default_llm: name })
  },
})

const LlmRemoveCommand = cmd({
  command: "remove <name>",
  aliases: ["rm"],
  describe: "remove an agent LLM entry",
  builder: (yargs: Argv) =>
    yargs.positional("name", { type: "string", describe: "entry name", demandOption: true }),
  async handler(args) {
    const isTTY = process.stderr.isTTY
    const name = (args as { name: string }).name
    const state = readState()
    if (!state.llm[name]) {
      ok(isTTY, `  Agent LLM '${name}' not found — nothing to remove.\n`, {
        message: `Agent LLM '${name}' not found.`,
        removed: false,
      })
    }
    const llm = { ...state.llm }
    delete llm[name]
    const clearedDefault = state.default_llm === name
    writeState({
      llm,
      ...(!clearedDefault && state.default_llm ? { default_llm: state.default_llm } : {}),
    })
    const note = clearedDefault ? " (also cleared default_llm)" : ""
    ok(isTTY, `\n  Agent LLM '${name}' removed.${note}\n\n`, {
      message: `Agent LLM '${name}' removed.`,
      removed: true,
      cleared_default: clearedDefault,
    })
  },
})

const LlmResetCommand = cmd({
  command: "reset",
  describe: "clear top-level default_llm",
  async handler() {
    const isTTY = process.stderr.isTTY
    const state = readState()
    const had = typeof state.default_llm === "string"
    writeState({ llm: state.llm })
    const message = had ? "default_llm cleared." : "default_llm was not set."
    ok(isTTY, `\n  ${message}\n\n`, { message, had_default: had })
  },
})

export const AgentLlmCommand = cmd({
  command: "llm",
  describe: "manage LLMs used by the agent (~/.clickzetta/llm.json).",
  builder: (yargs: Argv) =>
    commandGroup(
      yargs
        .command(LlmListCommand)
        .command(LlmShowCommand)
        .command(LlmAddCommand)
        .command(LlmTestCommand)
        .command(LlmUseCommand)
        .command(LlmRemoveCommand)
        .command(LlmResetCommand),
      "agent llm",
    ),
  async handler() {},
})

export async function runLlm(args: readonly string[]): Promise<never> {
  const { default: yargs } = await import("yargs")
  await yargs(args)
    .scriptName("cz-cli agent")
    .command(AgentLlmCommand)
    .demandCommand(1, "")
    .strictCommands()
    .strict(false)
    .help("help", "show help")
    .alias("help", "h")
    .parseAsync()
  process.exit(0)
}
