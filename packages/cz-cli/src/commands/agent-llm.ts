import type { Argv, CommandModule } from "yargs"
import { ModelsCommand } from "opencode/cli/cmd/models"
import { commandGroup } from "../command-group.js"
import {
  clearActiveModel,
  readLlmEntries,
  setActiveModel,
  validateModelRef,
  writeLlmEntries,
  type LlmEntryView,
} from "../llm/native-config.js"
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

// cz_change: no default_llm. `model` is opencode's active model ref (config.model,
// e.g. "clickzetta/deepseek/deepseek-v4-pro"); the active *entry* is its provider
// prefix (first "/"-segment). Absent means opencode auto-selects (recent → first).
type LlmState = {
  llm: Record<string, LlmEntryView>
  model?: string
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
  const { llm, model } = readLlmEntries()
  return {
    llm: Object.fromEntries(Object.entries(llm).map(([name, entry]) => [name, { ...entry }])),
    ...(model ? { model } : {}),
  }
}

// Persists only the provider map. The active model (config.model) is managed
// explicitly via setActiveModel/clearActiveModel, never as a side effect of
// writing entries.
function writeState(state: LlmState) {
  writeLlmEntries({ llm: state.llm })
}

function hasUsableEntry(state: LlmState) {
  return Object.values(state.llm).some((entry) => !!entry.provider && !!entry.api_key)
}

// The active entry name = provider prefix of config.model (first "/"-segment).
function activeEntryName(state: LlmState): string | undefined {
  if (typeof state.model !== "string" || !state.model.includes("/")) return undefined
  const name = state.model.split("/")[0]
  return name && state.llm[name] ? name : undefined
}

function mask(value: string | undefined): string | null {
  if (!value) return null
  if (value.length <= 8) return value.slice(0, 2) + "..."
  return value.slice(0, 8) + "..."
}

function onboarding() {
  return {
    next_steps: [
      "cz-cli agent llm add <NAME> --provider <PROVIDER> --api-key <API_KEY>",
    ],
    clickzetta_builtin: [
      "cz-cli auth login <name> --credential <base64_string>",
    ],
    external_llm: [
      "cz-cli agent llm add my-openai --provider openai --api-key <OPENAI_API_KEY>",
      "cz-cli agent llm add my-relay --provider openai-compatible --base-url https://your-gateway.example.com/v1 --api-key <API_KEY>",
    ],
    optional_checks: [
      "cz-cli agent llm show",
      "cz-cli agent llm test <NAME>",
      "cz-cli agent llm models <NAME>",
    ],
    optional_default: [
      "cz-cli agent llm use <NAME>/<MODEL_ID>",
    ],
    lakehouse_setup: [
      "cz-cli auth login <name>",
      "cz-cli auth login --help",
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
  process.stderr.write("  Optional checks after registration:\n")
  for (const step of guide.optional_checks) process.stderr.write(`    ${step}\n`)
  process.stderr.write("\n")
  process.stderr.write("  To set the default model (otherwise OpenCode selects automatically):\n")
  for (const step of guide.optional_default) process.stderr.write(`    ${step}\n`)
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

// The entry to act on when the user names none: the active entry (config.model's
// prefix), else — to keep `test` useful — the sole entry if there's exactly one.
function resolveEntryName(state: LlmState): string | undefined {
  const active = activeEntryName(state)
  if (active) return active
  const names = Object.keys(state.llm)
  return names.length === 1 ? names[0] : undefined
}

function resolveLlmTarget(state: LlmState, name?: string): LlmTarget | undefined {
  const targetName = name ?? resolveEntryName(state)
  if (!targetName) return undefined
  const entry = state.llm[targetName]
  if (!entry) return undefined
  // The selected model id for this entry, if it's the active one.
  const model =
    activeEntryName(state) === targetName && typeof state.model === "string" && state.model.includes("/")
      ? state.model.slice(state.model.indexOf("/") + 1)
      : entry.model
  return {
    name: targetName,
    provider: entry.provider,
    apiKey: entry.api_key,
    baseUrl: entry.base_url,
    model,
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

// Describes the explicit model pin. Without config.model, opencode selects one
// using its native recent-model/provider fallback.
function describeActive(state: LlmState): { kind: "llm" | "auto" | "none"; name: string; detail: string } {
  const name = activeEntryName(state)
  if (!name || typeof state.model !== "string") {
    if (!hasUsableEntry(state)) return { kind: "none", name: "", detail: "no usable LLM entry is configured" }
    return { kind: "auto", name: "", detail: "OpenCode selects at runtime" }
  }
  const entry = state.llm[name]
  if (!entry?.provider || !entry.api_key) {
    return { kind: "none", name: "", detail: "selected entry is incomplete" }
  }
  return { kind: "llm", name, detail: `${state.model} (config.model)` }
}

const LlmListCommand = cmd({
  command: "list",
  aliases: ["ls"],
  describe: "list configured agent LLM entries by name",
  async handler() {
    const isTTY = process.stderr.isTTY
    const state = readState()
    const names = Object.keys(state.llm)
    // cz_change: `*` marks the active entry (config.model's provider prefix), not
    // a cz "default_llm". JSON exposes `active` (entry name) + `model` (full ref).
    const active = activeEntryName(state) ?? null
    if (isTTY) {
      if (names.length === 0) {
        process.stderr.write("  (no agent LLM entries configured)\n")
      } else {
        for (const name of names) {
          const marker = name === active ? "* " : "  "
          process.stdout.write(`${marker}${name}\n`)
        }
      }
    } else {
      process.stdout.write(
        JSON.stringify({ data: { llms: names, active, model: state.model ?? null } }) + "\n",
      )
    }
    process.exit(0)
  },
})

const LlmShowCommand = cmd({
  command: "show",
  describe: "show LLM configuration and which model is used by default",
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
        process.stderr.write(`  Default model: ${active.name}  ${active.detail}\n`)
      } else if (active.kind === "auto") {
        process.stderr.write("  Default model: automatic (OpenCode selects at runtime)\n")
      } else {
        process.stderr.write(`  Default model: unavailable (${active.detail})\n`)
      }
      process.stderr.write("\n")

      if (entries.length > 0) {
        process.stderr.write("  Defined LLMs:\n")
        for (const entry of entries) {
          const mark = entry.name === active.name && active.kind === "llm" ? "*" : " "
          const providerModel = entry.model ? `${entry.provider ?? "?"}/${entry.model}` : (entry.provider ?? "?")
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
      .option("known-model", {
        type: "string",
        describe: "Declare a model available on this entry; does not set the default model",
      })
      .option("model", { type: "string", hidden: true })
      .option("llm-model", { type: "string", hidden: true })
      .option("api-key", { type: "string", alias: ["llm-api-key"], describe: "API key for the provider" })
      .option("base-url", {
        type: "string",
        alias: ["llm-base-url"],
        describe: "base URL (for third-party relays; required for openai-compatible)",
      })
      .option("use", {
        type: "boolean",
        alias: ["set-default"],
        hidden: true,
      })
      .example("$0 llm add my-openai --provider openai --api-key sk-...", "register OpenAI")
      .example("$0 llm test my-openai", "verify the registered API configuration")
      .example("$0 llm models my-openai", "list models available to the registered entry")
      .example("$0 llm use my-openai/gpt-4.1", "set the default model"),
  async handler(args) {
    const opts = args as {
      name: string
      knownModel?: string
      provider?: string
      model?: string
      llmModel?: string
      apiKey?: string
      baseUrl?: string
      use?: boolean
    }
    const isTTY = process.stderr.isTTY
    const name = opts.name
    const knownModel = opts.knownModel ?? opts.model ?? opts.llmModel

    if (opts.use) {
      fail(
        isTTY,
        "USE_OPTION_REMOVED",
        "`--use` no longer activates an LLM during registration. " +
          `Register it first, then run \`cz-cli agent llm models ${name}\` and \`cz-cli agent llm use ${name}/<MODEL_ID>\`. ` +
          `Use \`cz-cli agent llm test ${name}\` only when you need API diagnostics.`,
        {
          next_steps: [
            `cz-cli agent llm models ${name}`,
            `cz-cli agent llm use ${name}/<MODEL_ID>`,
          ],
          optional_checks: [`cz-cli agent llm test ${name}`],
        },
      )
    }

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
    if (knownModel) entry.model = knownModel
    if (opts.apiKey) entry.api_key = opts.apiKey
    if (opts.baseUrl) {
      const provider = typeof entry.provider === "string" ? entry.provider : ""
      entry.base_url = resolveBaseUrl(provider, opts.baseUrl) ?? opts.baseUrl
    }

    if (entry.provider === "clickzetta" && knownModel) {
      fail(
        isTTY,
        "KNOWN_MODEL_NOT_SUPPORTED",
        `ClickZetta entry '${name}' discovers models from its /models endpoint; remove --known-model and register it again, then run \`cz-cli agent llm models ${name}\`.`,
        {
          next_steps: [
            `cz-cli agent llm add ${name} --provider clickzetta --api-key <API_KEY>`,
            `cz-cli agent llm models ${name}`,
          ],
        },
      )
    }

    if (isNew) {
      const missing = [
        ...(typeof entry.provider === "string" ? [] : ["--provider"]),
        ...(typeof entry.api_key === "string" ? [] : ["--api-key"]),
      ]
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
          " --provider openai-compatible --base-url https://aitoken.clickzetta.com/apikey --api-key <API_KEY>",
        { provider: entry.provider, required: ["base_url"] },
      )
    }

    llms[name] = entry
    writeState({ llm: llms })

    const action = isNew ? "added" : "updated"
    const ttyOut = [
      `\n  Agent LLM '${name}' ${action}`,
      entry.provider && `    provider: ${entry.provider}`,
      entry.model && `    known_model: ${entry.model}  (available on this entry; default unchanged)`,
      entry.api_key && `    api_key:  ${mask(entry.api_key)}`,
      entry.base_url && `    base_url: ${entry.base_url}`,
      `    optional: cz-cli agent llm test ${name}`,
      `    optional: cz-cli agent llm models ${name}`,
      `    default:  unchanged; use cz-cli agent llm use ${name}/<MODEL_ID> to pin one`,
      "",
      "",
    ]
      .filter(Boolean)
      .join("\n")

    ok(isTTY, ttyOut, {
      message: `Agent LLM '${name}' ${action}.`,
      name,
      provider: entry.provider,
      known_model: entry.model,
      base_url: entry.base_url,
      optional_checks: [
        `cz-cli agent llm test ${name}`,
        `cz-cli agent llm models ${name}`,
      ],
      optional_default: `cz-cli agent llm use ${name}/<MODEL_ID>`,
    })
  },
})

const LlmTestCommand = cmd({
  command: "test [name]",
  describe: "probe an LLM entry's API connectivity",
  builder: (yargs: Argv) =>
    yargs.positional("name", { type: "string", describe: "entry name; defaults to the default model's entry (or the only one)" }),
  async handler(args) {
    const isTTY = process.stderr.isTTY
    const name = typeof args.name === "string" ? args.name : undefined
    const state = readState()
    const target = resolveLlmTarget(state, name)

    if (!target) {
      const names = Object.keys(state.llm)
      if (name) {
        fail(
          isTTY,
          "NOT_FOUND",
          `Agent LLM entry '${name}' is not defined. Run \`cz-cli agent llm list\` to see available entries.`,
          { available: names },
        )
      }
      if (names.length > 1) {
        fail(
          isTTY,
          "LLM_NAME_REQUIRED",
          `Multiple LLM entries are configured; specify one with \`cz-cli agent llm test <NAME>\`. Available: ${names.join(", ")}.`,
          { available: names },
        )
      }
      fail(
        isTTY,
        "NO_LLM_CONFIGURED",
        "No usable LLM API configuration was found. Register one with `cz-cli agent llm add <NAME> --provider <PROVIDER> --api-key <API_KEY>`.",
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
    const probe = buildProbe(target.apiKey)
    if (!probe) {
      const example = target.provider === "azure"
        ? "https://<resource>.openai.azure.com/openai"
        : target.provider === "clickzetta"
          ? "https://aitoken.clickzetta.com/apikey"
          : "<BASE_URL>"
      fail(
        isTTY,
        "MISSING_BASE_URL",
        `Agent LLM '${target.name}' needs a base_url before it can be tested.\n` +
          `  Update it with: cz-cli agent llm add ${target.name} --base-url ${example}`,
      )
    }

    // cz_change: one attempt. This used to be a two-pass loop so an exhausted
    // free-quota key could be rotated between passes and the probe retried with
    // the fresh key; with automatic rotation removed nothing changes between
    // attempts, so a second pass would repeat the identical request. A 429 is
    // now reported like any other HTTP failure and the user decides what to do.
    const { url, method, headers, body: probeBody } = probe
    // The probe URL is raw — for the Google provider it carries the API key in
    // the query string (?key=...), so only the masked form is ever surfaced.
    const displayUrl = url.replace(/[?&]key=[^&]+/, "?key=***")

    let response: Response
    try {
      response = await fetch(url, { method, headers, body: probeBody })
    } catch (error) {
      fail(
        isTTY,
        "LLM_TEST_REQUEST_FAILED",
        `Could not reach ${displayUrl}: ${error instanceof Error ? error.message : String(error)}`,
        { provider: target.provider, url: displayUrl },
      )
    }

    const text = await response.text()
    if (!response.ok) {
      const detail = responseDetail(text)
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
      url: displayUrl,
      model: target.model ?? null,
      probe: "chat.completions",
      sample_response: completion,
      source: target.source,
    })
  },
})

// cz_change: `use` now sets opencode's active model (config.model) directly,
// aligned with opencode's provider/model format. The argument is a full model
// reference `<entry>/<modelId>` (e.g. clickzetta/deepseek/deepseek-v4-pro or
// my-openai/gpt-4o), where <entry> is a defined LLM entry name. There is no
// separate default_llm concept anymore — config.model is the single source of
// truth, and opencode's parseModel splits it on the first "/".
const LlmUseCommand = cmd({
  command: "use <model>",
  describe: "set the default model (writes config.model), format <entry>/<modelId>",
  builder: (yargs: Argv) =>
    yargs.positional("model", {
      type: "string",
      describe: "full model ref, e.g. my-openai/gpt-4o or clickzetta/deepseek/deepseek-v4-pro",
      demandOption: true,
    }),
  async handler(args) {
    const isTTY = process.stderr.isTTY
    const model = (args as { model: string }).model
    const state = readState()
    const check = validateModelRef(model, state.llm)
    if (!check.ok) {
      if (check.code === "INVALID_MODEL_REF") {
        fail(isTTY, "INVALID_MODEL_REF", `Model must be in <entry>/<modelId> form (e.g. my-openai/gpt-4o). Got: "${model}".`)
      }
      fail(
        isTTY,
        "NOT_FOUND",
        `Agent LLM entry '${check.entry}' is not defined. Run \`cz-cli agent llm list\` to see available entries.`,
      )
    }
    setActiveModel(model)
    ok(isTTY, `\n  config.model = "${model}"\n\n`, { message: `Default model set to ${model}.`, model })
  },
})

const LlmModelsCommand = cmd({
  ...ModelsCommand,
  describe: "list models available to a configured LLM entry",
  builder: (yargs: Argv) =>
    yargs
      .positional("provider", {
        describe: "configured LLM entry name",
        type: "string",
        array: false,
      })
      .option("verbose", {
        describe: "use more verbose model output (includes metadata like costs)",
        type: "boolean",
      })
      .option("refresh", {
        describe: "refresh the models cache from models.dev",
        type: "boolean",
      }),
  async handler(args) {
    try {
      await ModelsCommand.handler(args as never)
    } catch (error) {
      const name = typeof args.provider === "string" ? args.provider : undefined
      const message = error instanceof Error ? error.message : String(error)
      if (name && readState().llm[name] && message.includes(`Provider not found: ${name}`)) {
        fail(
          process.stderr.isTTY,
          "MODEL_DISCOVERY_FAILED",
          `Model discovery failed for configured LLM entry '${name}'. Run \`cz-cli agent llm test ${name}\` to see the HTTP status and provider error body.`,
          { entry: name, next_steps: [`cz-cli agent llm test ${name}`] },
        )
      }
      throw error
    }
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
    // If the removed entry was the active one, config.model becomes stale;
    // writeState (via writeLlmEntries) drops it automatically. Report that.
    const clearedActive = activeEntryName(state) === name
    writeState({ llm })
    const note = clearedActive ? " (also cleared the default model)" : ""
    ok(isTTY, `\n  Agent LLM '${name}' removed.${note}\n\n`, {
      message: `Agent LLM '${name}' removed.`,
      removed: true,
      cleared_active: clearedActive,
    })
  },
})

// cz_change: clears opencode's active model (config.model), returning model
// selection to opencode's native recent-model/provider fallback.
const LlmResetCommand = cmd({
  command: "reset",
  describe: "clear the default model",
  async handler() {
    const isTTY = process.stderr.isTTY
    const state = readState()
    const had = typeof state.model === "string"
    clearActiveModel()
    const message = hasUsableEntry(state)
      ? had
        ? "Default model cleared; OpenCode will select automatically."
        : "No default model was set; OpenCode already selects automatically."
      : had
        ? "Default model cleared; no usable LLM entry is configured. Add one before running the agent."
        : "No default model was set, and no usable LLM entry is configured. Add one before running the agent."
    ok(isTTY, `\n  ${message}\n\n`, {
      message,
      had_active: had,
      ...(hasUsableEntry(state) ? {} : { next_steps: onboarding().next_steps }),
    })
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
        .command(LlmModelsCommand)
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
  try {
    await yargs(args)
      .scriptName("cz-cli agent")
      // cz_change: `llm` runs on its own parser (runtime.ts dispatches to it before
      // the main agent yargs is built), so the global --profile/-p must be declared
      // here too or it fails as an unknown option. It is not decorative: the
      // ClickZetta gateway/virtual-key paths resolve the active profile via
      // CZ_PROFILE, which run-cli.ts sets from this flag.
      .option("profile", {
        type: "string",
        alias: "p",
        describe: "ClickZetta connection profile to use (overrides default_profile in profiles.toml)",
      })
      .command(AgentLlmCommand)
      .demandCommand(1, "")
      .strictCommands()
      .strict(false)
      .help("help", "show help")
      .alias("help", "h")
      .parseAsync()
  } catch (error) {
    process.stderr.write(`Error: ${error instanceof Error ? error.message : String(error)}\n`)
    process.exit(1)
  }
  process.exit(0)
}
