import { readFileSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { createTraceparent } from "@clickzetta/sdk"
import { createCli } from "./cli.js"
import { CLICKZETTA_PROFILE_OPTION_NAMES } from "./clickzetta-profile-option.js"
import { parseOutputArgs, renderOutput } from "./output/index.js"
import { registerCommands } from "./register-commands.js"
import { trackCommand, parseTrackingArgs } from "./telemetry.js"

interface CliRuntime {
  stdout: Pick<typeof process.stdout, "write" | "isTTY">
  stderr: Pick<typeof process.stderr, "write" | "isTTY">
  exit: (code: number) => never
}

const defaultRuntime: CliRuntime = {
  stdout: process.stdout,
  stderr: process.stderr,
  exit: (code) => process.exit(code),
}

const PROFILE_REQUIRED_COMMANDS = new Set([
  "sql",
  "schema",
  "table",
  "workspace",
  "status",
  "task",
  "runs",
  "attempts",
  "job",
  "datasource",
  "analytics-agent",
])

const LLM_ONBOARDING = {
  clickzetta_builtin: [
    "cz-cli setup --credential <base64_string>",
  ],
  external_llm: [
    "cz-cli agent llm add my-openai --provider openai --api-key <OPENAI_API_KEY> --use",
    "cz-cli agent llm add my-relay --provider openai-compatible --base-url https://your-gateway.example.com/v1 --api-key <API_KEY> --use",
  ],
  verify: [
    "cz-cli agent llm show",
    "cz-cli agent llm test",
    "cz-cli agent llm test <NAME>",
  ],
  lakehouse_setup: [
    "cz-cli setup",
    "cz-cli setup --username <username> --password <password> --account-name <account_name>",
  ],
} as const

const AGENT_FLAGS = new Set(["debug", "d", "help", "h", "version"])
const AGENT_FLAGS_WITH_VALUES = new Set([
  ...CLICKZETTA_PROFILE_OPTION_NAMES,
  "jdbc",
  "pat",
  "username",
  "password",
  "service",
  "protocol",
  "instance",
  "workspace",
  "schema",
  "s",
  "session",
  "vcluster",
  "v",
  "format",
  "field",
])
const GLOBAL_FLAGS = new Set(["debug", "d", "help", "h", "version"])
const GLOBAL_FLAGS_WITH_VALUES = new Set([
  ...CLICKZETTA_PROFILE_OPTION_NAMES,
  "jdbc",
  "pat",
  "username",
  "password",
  "service",
  "protocol",
  "instance",
  "workspace",
  "schema",
  "s",
  "vcluster",
  "v",
  "format",
  "field",
])

const RUNTIME_COMMANDS = new Set(["run", "llm", "serve"])
const AGENT_RUNTIME_SUBCOMMANDS = new Set(["run", "llm", "session", "stats", "export"])

function usageErrorPayload(message: string) {
  return {
    error: { code: "USAGE_ERROR", message },
    ai_message: "Run the command with --help to see available options and usage.",
  }
}

function stripLegacyOutputFlag(args: string[]): { found: boolean; remaining: string[] } {
  let found = false
  const remaining: string[] = []
  for (let index = 0; index < args.length; index++) {
    const value = args[index]
    if (value === "-o" || value === "--output") {
      found = true
      index++ // skip the value
      continue
    }
    if (value?.startsWith("-o=") || value?.startsWith("--output=")) {
      found = true
      continue
    }
    remaining.push(value!)
  }
  return { found, remaining }
}

function runtimeOutputFlagMessage(command: string) {
  return `-o/--output is no longer supported. Use --format instead: cz-cli ${command} --format <value>`
}

function extractGlobalFormatArgs(args: string[]) {
  const formatArgs: string[] = []
  const remaining: string[] = []

  for (let index = 0; index < args.length; index++) {
    const value = args[index]
    if (value === "--format") {
      formatArgs.push(value)
      const next = args[index + 1]
      if (next !== undefined) {
        formatArgs.push(next)
        index++
      }
      continue
    }
    if (value?.startsWith("--format=")) {
      formatArgs.push(value)
      continue
    }
    remaining.push(value)
  }

  return { formatArgs, remaining }
}

function noProfilePayload() {
  return {
    error: {
      code: "NO_PROFILE",
      message: "No ClickZetta profile configured.",
      next_step: "cz-cli setup",
      next_steps: [
        "cz-cli setup --credential <base64_string>",
        "cz-cli setup --username <username> --password <password> --account-name <account_name>",
      ],
      register_urls: [
        "https://accounts.clickzetta.com/register?ref=cz-cli",
        "https://accounts.singdata.com/register?ref=cz-cli",
      ],
      llm_help: "cz-cli agent llm --help",
    },
  }
}

function noActiveLlmPayload() {
  return {
    error: {
      code: "NO_ACTIVE_LLM",
      message: "No active LLM is configured. Run `cz-cli agent llm show` for setup paths.",
      ...LLM_ONBOARDING,
    },
  }
}

function noProfileTtyMessage() {
  return (
    "\n  No ClickZetta profile configured.\n" +
    "  Run one of the following:\n\n" +
    "    cz-cli setup\n" +
    "      Interactive setup. Choose either:\n" +
    "      - New user: paste the registration credential\n" +
    "      - Already have ClickZetta account: enter username/password/account name,\n" +
    "        then choose service -> instance -> workspace -> schema -> vcluster\n\n" +
    "    cz-cli setup --credential <base64_string>\n" +
    "      New-user fast path from registration token\n\n" +
    "    cz-cli setup --username <username> --password <password> --account-name <account_name>\n" +
    "      Existing-account non-TTY flow; cz-cli will tell you the next required step\n\n" +
    "  Register at:\n" +
    "    https://accounts.clickzetta.com/register?ref=cz-cli (China)\n" +
    "    https://accounts.singdata.com/register?ref=cz-cli (International)\n\n" +
    "  LLM configuration is separate:\n" +
    "    cz-cli agent llm --help\n\n"
  )
}

function noActiveLlmTtyMessage() {
  return (
    "\n  No active LLM is configured.\n" +
    "  Run `cz-cli agent llm show` to inspect the current state, or set one up with:\n\n" +
    "  ClickZetta built-in LLM:\n" +
    "    cz-cli setup --credential <base64_string>\n\n" +
    "  External LLMs:\n" +
    "    cz-cli agent llm add my-openai --provider openai --api-key <OPENAI_API_KEY> --use\n" +
    "    cz-cli agent llm add my-relay --provider openai-compatible --base-url https://your-gateway.example.com/v1 --api-key <API_KEY> --use\n\n" +
    "  Verify after adding one:\n" +
    "    cz-cli agent llm show\n" +
    "    cz-cli agent llm test\n" +
    "    cz-cli agent llm test <NAME>\n\n" +
    "  Lakehouse connection setup is separate:\n" +
    "    cz-cli setup\n" +
    "    cz-cli setup --username <username> --password <password> --account-name <account_name>\n\n"
  )
}

function hasConfiguredProfile() {
  try {
    return /^\[profiles\./m.test(readFileSync(join(process.env.CLICKZETTA_TEST_HOME || homedir(), ".clickzetta", "profiles.toml"), "utf-8"))
  } catch {
    return false
  }
}

async function hasConfiguredLlm() {
  // Check profiles.toml first (legacy [llm.*] + inline clickzetta fields).
  try {
    const profilesPath = join(process.env.CLICKZETTA_TEST_HOME || homedir(), ".clickzetta", "profiles.toml")
    const content = readFileSync(profilesPath, "utf-8")
    const { hasUsableLlm } = await import("../../opencode/src/config/profiles-llm.ts")
    if (hasUsableLlm(content).hasValidConfig) return true
  } catch {
    // profiles.toml missing/unreadable — fall through to llm.json.
  }
  // Then check the native llm.json store. migrateProfilesLlmToNative() moves
  // [llm.*] out of profiles.toml into llm.json, so after the first agent run the
  // usable config lives here — the gate must recognize it or it blocks every
  // subsequent run.
  try {
    const { readLlmEntries } = await import("../../opencode/src/clickzetta/native-config.ts")
    const { llm } = readLlmEntries()
    return Object.values(llm).some((e) => e.provider && e.api_key)
  } catch {
    return false
  }
}

export function emitNoProfile(runtime: CliRuntime, rawArgs?: string[]): never {
  if (runtime.stderr.isTTY) {
    runtime.stderr.write(noProfileTtyMessage())
  } else {
    const outputArgs = parseOutputArgs(rawArgs ?? [])
    runtime.stdout.write(renderOutput(noProfilePayload(), outputArgs.format, outputArgs.field) + "\n")
  }
  return runtime.exit(1)
}

export function emitNoActiveLlm(runtime: CliRuntime, rawArgs?: string[]): never {
  if (runtime.stderr.isTTY) {
    runtime.stderr.write(noActiveLlmTtyMessage())
  } else {
    const outputArgs = parseOutputArgs(rawArgs ?? [])
    runtime.stdout.write(renderOutput(noActiveLlmPayload(), outputArgs.format, outputArgs.field) + "\n")
  }
  return runtime.exit(1)
}

export function emitUsageError(runtime: CliRuntime, message: string): never {
  runtime.stdout.write(JSON.stringify(usageErrorPayload(message)) + "\n")
  return runtime.exit(2)
}

async function migrateProfilesOnlyAndExit(): Promise<never> {
  const profilesPath = join(process.env.CLICKZETTA_TEST_HOME || homedir(), ".clickzetta", "profiles.toml")
  try {
    const [{ parse, stringify }, { migrateLegacyClickzettaConfig }] = await Promise.all([
      import("smol-toml"),
      import("../../opencode/src/config/profiles-llm.ts"),
    ])
    const parsed = parse(readFileSync(profilesPath, "utf-8"))
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      !Array.isArray(parsed) &&
      migrateLegacyClickzettaConfig(parsed as Record<string, unknown>)
    ) {
      writeFileSync(profilesPath, stringify(parsed) + "\n")
    }
  } catch {}
  process.exit(0)
}

async function delegateToAgentRuntime(rawArgs: string[]): Promise<never> {
  // The agent-runtime phase is in-process state. Pass it as an argument rather
  // than via process.env, which would be inherited by child processes (e.g. the
  // bash tool's subprocesses) and make a nested cz-cli re-enter the agent runtime.
  process.env.CLICKZETTA_TRACEPARENT = createTraceparent(process.env.CLICKZETTA_TRACEPARENT)
  const { main } = await import("../../clickzetta-entry/src/main.ts")
  const code = await main(rawArgs, true)
  process.exit(code)
}

async function parseRegisteredCommands(args: string[], onValidated?: () => void): Promise<void> {
  const cli = registerCommands(createCli(args)).demandCommand(1, "").help()
  // Run the profile gate as middleware (applyBeforeValidation=false) so it fires
  // AFTER yargs validates command/option syntax but BEFORE the handler runs.
  // This way a mistyped command or unknown option surfaces a USAGE_ERROR instead
  // of being masked by NO_PROFILE on a machine without a configured profile.
  if (onValidated) cli.middleware(() => onValidated(), false)
  await cli.parseAsync()
}

function agentSubcommand(args: string[], commandIndex: number) {
  for (let index = commandIndex + 1; index < args.length; index++) {
    const value = args[index]
    if (!value) continue
    if (value === "--") return
    if (!value.startsWith("-")) return value
    const flag = value.replace(/^-+/, "").split("=")[0]
    if (!flag || AGENT_FLAGS.has(flag) || value.includes("=")) continue
    if (AGENT_FLAGS_WITH_VALUES.has(flag)) index++
  }
}

function normalizeCliArgs(rawArgs: string[]) {
  const initialArgs = rawArgs.length === 0 ? ["--help"] : rawArgs
  const { formatArgs, remaining } = extractGlobalFormatArgs(initialArgs)
  const commandArgs = remaining
  let command = ""
  let commandIndex = -1
  for (let index = 0; index < commandArgs.length; index++) {
    const value = commandArgs[index]
    if (!value) continue
    if (value === "--") break
    if (!value.startsWith("-")) {
      command = value
      commandIndex = index
      break
    }
    const flag = value.replace(/^-+/, "").split("=")[0]
    if (!flag || GLOBAL_FLAGS.has(flag) || value.includes("=")) continue
    if (GLOBAL_FLAGS_WITH_VALUES.has(flag)) index++
  }
  const isHelpRequest = initialArgs.includes("--help") || initialArgs.includes("-h")
  const subcommand = command === "agent" ? agentSubcommand(commandArgs, commandIndex) : undefined
  const bareAgentInvocation = command === "agent" && !subcommand
  const runtimeArgs = formatArgs.length === 0 || commandIndex < 0
    ? commandArgs
    : [
        ...commandArgs.slice(0, commandIndex),
        commandArgs[commandIndex],
        ...formatArgs,
        ...commandArgs.slice(commandIndex + 1),
      ]
  return {
    args: initialArgs,
    runtimeArgs,
    command,
    isHelpRequest,
    subcommand,
    shouldDelegateToAgentRuntime:
      RUNTIME_COMMANDS.has(command) ||
      (command === "agent" &&
        !isHelpRequest &&
        (bareAgentInvocation || AGENT_RUNTIME_SUBCOMMANDS.has(subcommand ?? ""))),
  }
}

function profileOverrideFromArgs(args: string[]) {
  for (let index = 0; index < args.length; index++) {
    const value = args[index]
    if (value === "--profile" || value === "-p") return args[index + 1]
    if (value?.startsWith("--profile=")) return value.slice("--profile=".length)
    if (value?.startsWith("-p=")) return value.slice(3)
  }
}

export function classifyCliArgs(rawArgs: string[]) {
  const normalized = normalizeCliArgs(rawArgs)
  return {
    ...normalized,
    requiresProfile:
      PROFILE_REQUIRED_COMMANDS.has(normalized.command) &&
      !normalized.isHelpRequest &&
      !hasConfiguredProfile(),
  }
}

export async function runCli(rawArgs: string[], runtime: CliRuntime = defaultRuntime): Promise<void> {
  const normalized = normalizeCliArgs(rawArgs)
  const profileOverride = profileOverrideFromArgs(normalized.args)
  if (profileOverride) process.env.CZ_PROFILE = profileOverride
  const isAgentSessionEntry =
    !normalized.isHelpRequest &&
    (
      normalized.command === "run" ||
      (normalized.command === "agent" && (!normalized.subcommand || normalized.subcommand === "run"))
    )

  if (process.env.CLICKZETTA_MIGRATE_PROFILES_ONLY === "1") {
    await migrateProfilesOnlyAndExit()
  }

  const legacy = stripLegacyOutputFlag(normalized.args)
  if (legacy.found) {
    const stripped = normalizeCliArgs(legacy.remaining)
    const label = stripped.command === "agent" ? `agent ${stripped.subcommand ?? ""}`.trim() : stripped.command || "cz-cli"
    const message = runtimeOutputFlagMessage(label)
    const aiMessage = `-o/--output was removed. Replace with --format. Valid choices: ${label.startsWith("agent") ? "default, json" : "json, pretty, table, csv, text, jsonl, toon"}.`
    runtime.stdout.write(JSON.stringify({ error: { code: "USAGE_ERROR", message }, ai_message: aiMessage }) + "\n")
    return runtime.exit(2)
  }

  if (
    isAgentSessionEntry &&
    !process.env.CLICKZETTA_PID &&
    !(await hasConfiguredLlm())
  ) {
    return emitNoActiveLlm(runtime, rawArgs)
  }

  if (normalized.shouldDelegateToAgentRuntime) {
    await delegateToAgentRuntime(normalized.runtimeArgs)
  }

  const requiresProfile =
    PROFILE_REQUIRED_COMMANDS.has(normalized.command) &&
    !normalized.isHelpRequest

  // Gate runs as post-validation middleware inside parseRegisteredCommands, so
  // yargs reports syntax errors (unknown command/option, missing positional)
  // before NO_PROFILE. hasConfiguredProfile() is re-checked here (not above) so
  // it only fires once the command syntax is known to be valid.
  await parseRegisteredCommands(
    normalized.args,
    requiresProfile
      ? () => {
          if (!hasConfiguredProfile()) emitNoProfile(runtime, rawArgs)
        }
      : undefined,
  )
}

/**
 * Binary entry point wrapper: runs the CLI and emits a command telemetry event on completion.
 *
 * Use this instead of runCli() when the caller is the compiled binary entry point
 * (opencode/src/index.ts). Do NOT use inside execute.ts or other programmatic callers —
 * those paths have their own trackCommand calls and would double-track.
 *
 * Expects rawArgs = hideBin(process.argv) (i.e. process.argv.slice(2)).
 *
 * Note: agent/run commands call delegateToAgentRuntime() → process.exit() inside runCli(),
 * so they never reach the track() call here. That is intentional — agent commands are
 * tracked separately by the opencode session telemetry pipeline.
 */
export async function runCliWithTracking(rawArgs: string[]): Promise<void> {
  const startMs = Date.now()
  const { positional, args } = parseTrackingArgs(rawArgs)

  const track = (success: boolean, error?: string) =>
    trackCommand({
      command: positional[0] ?? "unknown",
      subcommand: positional[1],
      args: Object.keys(args).length > 0 ? args : undefined,
      duration_ms: Date.now() - startMs,
      success,
      error,
      response_bytes: (process as unknown as Record<string, unknown>).responseBytes as number | undefined,
    })

  try {
    await runCli(rawArgs)
    const lastError = (process as unknown as Record<string, unknown>).lastError as string | undefined
    if (positional[0] !== "setup") {
      await track(!process.exitCode, process.exitCode ? lastError ?? `exit_code=${process.exitCode}` : undefined)
    }
  } catch (error) {
    if (positional[0] !== "setup") {
      await track(false, error instanceof Error ? error.message : `exit_code=${process.exitCode ?? 1}`)
    }
    if (!process.exitCode) throw error
  }
}
