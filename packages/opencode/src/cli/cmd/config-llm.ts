import { readFileSync, writeFileSync, mkdirSync } from "fs"
import os from "os"
import path from "path"
import type { Argv } from "yargs"
import { cmd } from "./cmd"

const CLICKZETTA_DIR = path.join(os.homedir(), ".clickzetta")
const PROFILES_PATH = path.join(CLICKZETTA_DIR, "profiles.toml")

const VALID_PROVIDERS = ["anthropic", "openai", "openai-compatible", "bedrock", "google", "azure"] as const

function getDefaultProfile(): { profileName: string; sectionStart: number; sectionEnd: number; content: string } {
  let content: string
  try {
    content = readFileSync(PROFILES_PATH, "utf-8")
  } catch {
    content = ""
  }
  const defaultMatch = content.match(/^default_profile\s*=\s*"([^"]+)"/m)
  const profileName = defaultMatch ? defaultMatch[1] : "default"
  const sectionHeader = `[profiles.${profileName}]`
  const sectionStart = content.indexOf(sectionHeader)
  const nextSection = sectionStart >= 0 ? content.indexOf("\n[", sectionStart + sectionHeader.length) : -1
  const sectionEnd = nextSection >= 0 ? nextSection : content.length
  return { profileName, sectionStart, sectionEnd, content }
}

function upsertProfileField(content: string, sectionStart: number, sectionEnd: number, key: string, value: string): string {
  const section = content.slice(sectionStart, sectionEnd)
  const regex = new RegExp(`^${key}\\s*=\\s*"[^"]*"`, "m")
  const newLine = `${key} = "${value}"`
  if (regex.test(section)) {
    const updated = section.replace(regex, newLine)
    return content.slice(0, sectionStart) + updated + content.slice(sectionEnd)
  }
  const insertPos = sectionEnd
  return content.slice(0, insertPos) + "\n" + newLine + content.slice(insertPos)
}

function removeProfileField(content: string, sectionStart: number, sectionEnd: number, key: string): string {
  const section = content.slice(sectionStart, sectionEnd)
  const regex = new RegExp(`\\n?${key}\\s*=\\s*"[^"]*"`, "m")
  const updated = section.replace(regex, "")
  return content.slice(0, sectionStart) + updated + content.slice(sectionEnd)
}

export const AgentConfigCommand = cmd({
  command: "config",
  describe: "use your own LLM (Claude/OpenAI/etc.) instead of the default ClickZetta AI. Supports third-party relays via --llm-base-url.",
  builder: (yargs: Argv) =>
    yargs
      .option("llm-provider", {
        type: "string",
        describe: `LLM provider: ${VALID_PROVIDERS.join(", ")}`,
      })
      .option("llm-model", {
        type: "string",
        describe: "model ID (e.g. claude-sonnet-4-6, gpt-4o, deepseek-v4-pro)",
      })
      .option("llm-api-key", {
        type: "string",
        describe: "your own API key for the chosen provider (e.g. sk-ant-... for anthropic)",
      })
      .option("llm-base-url", {
        type: "string",
        describe: "base URL override. Use this to point at third-party relays (e.g. https://qtok.cc for Anthropic-compatible gateways). Required for openai-compatible.",
      })
      .option("show", {
        type: "boolean",
        describe: "show current LLM configuration",
      })
      .option("reset", {
        type: "boolean",
        describe: "remove custom LLM config, revert to ClickZetta AI default",
      })
      .example("$0 agent config --llm-provider anthropic --llm-model claude-sonnet-4-6 --llm-api-key sk-ant-...", "use Claude directly")
      .example("$0 agent config --llm-provider anthropic --llm-model claude-sonnet-4-6 --llm-api-key $ANTHROPIC_AUTH_TOKEN --llm-base-url $ANTHROPIC_BASE_URL", "reuse Claude Code env vars (works with relays like qtok.cc)")
      .example("$0 agent config --llm-provider openai --llm-model gpt-4o --llm-api-key sk-...", "use OpenAI directly")
      .example("$0 agent config --show", "show current config")
      .example("$0 agent config --reset", "revert to ClickZetta AI default")
      .epilogue("Alternatively, edit ~/.clickzetta/profiles.toml directly and add:\n  llm_provider = \"anthropic\"\n  llm_model = \"claude-sonnet-4-6\"\n  llm_api_key = \"sk-ant-...\"\n  llm_base_url = \"https://api.anthropic.com\"  # optional"),
  async handler(args) {
    const opts = args as {
      llmProvider?: string
      llmModel?: string
      llmApiKey?: string
      llmBaseUrl?: string
      show?: boolean
      reset?: boolean
    }

    const isTTY = process.stderr.isTTY

    if (opts.show) {
      return showConfig(isTTY)
    }

    if (opts.reset) {
      return resetConfig(isTTY)
    }

    if (!opts.llmProvider && !opts.llmModel && !opts.llmApiKey && !opts.llmBaseUrl) {
      return showConfig(isTTY)
    }

    if (opts.llmProvider && !VALID_PROVIDERS.includes(opts.llmProvider as any)) {
      const msg = `Invalid provider "${opts.llmProvider}". Valid: ${VALID_PROVIDERS.join(", ")}`
      if (isTTY) {
        process.stderr.write(`  Error: ${msg}\n`)
      } else {
        process.stdout.write(JSON.stringify({ error: { code: "INVALID_PROVIDER", message: msg, valid_providers: [...VALID_PROVIDERS] } }) + "\n")
      }
      process.exit(1)
    }

    const { profileName, sectionStart, sectionEnd, content } = getDefaultProfile()

    if (sectionStart < 0) {
      const msg = `Profile '${profileName}' not found. Run 'cz-cli setup --credential <base64_string>' first.`
      if (isTTY) {
        process.stderr.write(`  Error: ${msg}\n`)
      } else {
        process.stdout.write(JSON.stringify({ error: { code: "NO_PROFILE", message: msg, next_step: "cz-cli setup --credential <base64_string>" } }) + "\n")
      }
      process.exit(1)
    }

    let updated = content
    let currentEnd = sectionEnd
    if (opts.llmProvider) {
      updated = upsertProfileField(updated, sectionStart, currentEnd, "llm_provider", opts.llmProvider)
      currentEnd = updated.length - (content.length - sectionEnd)
    }
    if (opts.llmModel) {
      updated = upsertProfileField(updated, sectionStart, currentEnd, "llm_model", opts.llmModel)
      currentEnd = updated.length - (content.length - sectionEnd)
    }
    if (opts.llmApiKey) {
      updated = upsertProfileField(updated, sectionStart, currentEnd, "llm_api_key", opts.llmApiKey)
      currentEnd = updated.length - (content.length - sectionEnd)
    }
    if (opts.llmBaseUrl) {
      updated = upsertProfileField(updated, sectionStart, currentEnd, "llm_base_url", opts.llmBaseUrl)
    }

    mkdirSync(CLICKZETTA_DIR, { recursive: true })
    writeFileSync(PROFILES_PATH, updated)

    if (isTTY) {
      process.stderr.write("\n  LLM configuration updated:\n")
      if (opts.llmProvider) process.stderr.write(`    provider:  ${opts.llmProvider}\n`)
      if (opts.llmModel) process.stderr.write(`    model:     ${opts.llmModel}\n`)
      if (opts.llmApiKey) process.stderr.write(`    api_key:   ${opts.llmApiKey.slice(0, 8)}...\n`)
      if (opts.llmBaseUrl) process.stderr.write(`    base_url:  ${opts.llmBaseUrl}\n`)
      process.stderr.write("\n")
    } else {
      process.stdout.write(JSON.stringify({
        data: {
          message: "LLM configuration updated.",
          profile: profileName,
          llm_provider: opts.llmProvider,
          llm_model: opts.llmModel,
          llm_base_url: opts.llmBaseUrl,
        },
      }) + "\n")
    }
    process.exit(0)
  },
})

function showConfig(isTTY: boolean) {
  const { profileName, sectionStart, sectionEnd, content } = getDefaultProfile()
  if (sectionStart < 0) {
    const msg = "No profile configured."
    if (isTTY) {
      process.stderr.write(`  ${msg} Run 'cz-cli setup --credential <base64_string>' first.\n`)
    } else {
      process.stdout.write(JSON.stringify({ error: { code: "NO_PROFILE", message: msg, next_step: "cz-cli setup --credential <base64_string>" } }) + "\n")
    }
    process.exit(1)
  }
  const section = content.slice(sectionStart, sectionEnd)
  const get = (key: string) => section.match(new RegExp(`^${key}\\s*=\\s*"([^"]+)"`, "m"))?.[1]

  const config = {
    profile: profileName,
    llm_provider: get("llm_provider") ?? null,
    llm_model: get("llm_model") ?? null,
    llm_api_key: get("llm_api_key") ? get("llm_api_key")!.slice(0, 8) + "..." : null,
    llm_base_url: get("llm_base_url") ?? null,
    aimesh_endpoint: get("aimesh_endpoint") ?? null,
  }

  if (isTTY) {
    process.stderr.write("\n  Current LLM configuration:\n")
    process.stderr.write(`    profile:         ${config.profile}\n`)
    process.stderr.write(`    llm_provider:    ${config.llm_provider ?? "(default: openai-compatible)"}\n`)
    process.stderr.write(`    llm_model:       ${config.llm_model ?? "(default: deepseek-v4-pro)"}\n`)
    process.stderr.write(`    llm_api_key:     ${config.llm_api_key ?? "(using platform api_key)"}\n`)
    process.stderr.write(`    llm_base_url:    ${config.llm_base_url ?? config.aimesh_endpoint ?? "(none)"}\n`)
    process.stderr.write("\n  To use your own provider:\n")
    process.stderr.write("    cz-cli agent config --llm-provider anthropic --llm-model claude-sonnet-4-6 --llm-api-key sk-ant-...\n")
    process.stderr.write("\n  Or edit directly: ~/.clickzetta/profiles.toml\n")
    process.stderr.write("    llm_provider = \"anthropic\"\n")
    process.stderr.write("    llm_model = \"claude-sonnet-4-6\"\n")
    process.stderr.write("    llm_api_key = \"sk-ant-...\"\n\n")
  } else {
    process.stdout.write(JSON.stringify({ data: config }) + "\n")
  }
  process.exit(0)
}

function resetConfig(isTTY: boolean) {
  const { profileName, sectionStart, sectionEnd, content } = getDefaultProfile()
  if (sectionStart < 0) {
    process.exit(0)
  }
  let updated = content
  let currentEnd = sectionEnd
  for (const key of ["llm_provider", "llm_model", "llm_api_key", "llm_base_url"]) {
    const before = updated.length
    updated = removeProfileField(updated, sectionStart, currentEnd, key)
    currentEnd -= (before - updated.length)
  }
  writeFileSync(PROFILES_PATH, updated)

  if (isTTY) {
    process.stderr.write("\n  Custom LLM config removed. Using ClickZetta AI default.\n\n")
  } else {
    process.stdout.write(JSON.stringify({ data: { message: "Custom LLM config removed.", profile: profileName } }) + "\n")
  }
  process.exit(0)
}
