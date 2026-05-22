import { readFileSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { createTraceparent } from "@clickzetta/sdk"
import { createCli } from "./cli.js"
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
  "profile",
  "p",
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
  "output",
  "o",
  "field",
])

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
  try {
    const profilesPath = join(process.env.CLICKZETTA_TEST_HOME || homedir(), ".clickzetta", "profiles.toml")
    const content = readFileSync(profilesPath, "utf-8")
    const { hasUsableLlm } = await import("../../opencode/src/config/profiles-llm.ts")
    return hasUsableLlm(content).hasValidConfig
  } catch {
    return false
  }
}

export function emitNoProfile(runtime: CliRuntime): never {
  if (runtime.stderr.isTTY) {
    runtime.stderr.write(noProfileTtyMessage())
  } else {
    runtime.stdout.write(JSON.stringify(noProfilePayload()) + "\n")
  }
  return runtime.exit(1)
}

export function emitNoActiveLlm(runtime: CliRuntime): never {
  if (runtime.stderr.isTTY) {
    runtime.stderr.write(noActiveLlmTtyMessage())
  } else {
    runtime.stdout.write(JSON.stringify(noActiveLlmPayload()) + "\n")
  }
  return runtime.exit(1)
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
  process.env.CLICKZETTA_AGENT_RUNTIME = "1"
  process.env.CLICKZETTA_TRACEPARENT = createTraceparent(process.env.CLICKZETTA_TRACEPARENT)
  const { main } = await import("../../opencode/src/main.ts")
  const code = await main(rawArgs)
  process.exit(code)
}

async function parseRegisteredCommands(args: string[]): Promise<void> {
  await registerCommands(createCli(args)).demandCommand(1, "").help().parseAsync()
}

function agentSubcommand(args: string[]) {
  for (let index = 1; index < args.length; index++) {
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
  const args = rawArgs.length === 0 ? ["--help"] : rawArgs
  const command = args[0] ?? ""
  const isHelpRequest = args.includes("--help") || args.includes("-h")
  const subcommand = command === "agent" ? agentSubcommand(args) : undefined
  const bareAgentInvocation = command === "agent" && !subcommand
  return {
    args,
    runtimeArgs: args,
    command,
    isHelpRequest,
    subcommand,
    shouldDelegateToAgentRuntime:
      command === "run" ||
      command === "llm" ||
      command === "config" ||
      (command === "agent" &&
        !isHelpRequest &&
        (bareAgentInvocation || ["run", "llm", "config", "session", "stats", "export"].includes(subcommand ?? ""))),
  }
}

function profileOverrideFromArgs(args: string[]) {
  for (let index = 0; index < args.length; index++) {
    const value = args[index]
    if (value === "--profile") return args[index + 1]
    if (value?.startsWith("--profile=")) return value.slice("--profile=".length)
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

  if (
    isAgentSessionEntry &&
    !process.env.CLICKZETTA_PID &&
    !(await hasConfiguredLlm())
  ) {
    return emitNoActiveLlm(runtime)
  }

  if (normalized.shouldDelegateToAgentRuntime) {
    await delegateToAgentRuntime(normalized.runtimeArgs)
  }

  if (
    PROFILE_REQUIRED_COMMANDS.has(normalized.command) &&
    !normalized.isHelpRequest &&
    !hasConfiguredProfile()
  ) {
    return emitNoProfile(runtime)
  }

  await parseRegisteredCommands(normalized.args)
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
