import { readFileSync, writeFileSync } from "node:fs"
import { spawn } from "node:child_process"
import { homedir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { createCli } from "./cli.js"
import { registerCommands } from "./register-commands.js"

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

function hasConfiguredProfile() {
  try {
    return /^\[profiles\./m.test(readFileSync(join(process.env.CLICKZETTA_TEST_HOME || homedir(), ".clickzetta", "profiles.toml"), "utf-8"))
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

function agentRuntimeCommand(rawArgs: string[]) {
  const entry = process.argv[1] ?? ""
  const preloadArgs = process.execArgv.flatMap((arg, index, list) => {
    if (arg === "--preload") return index + 1 < list.length ? [arg, list[index + 1]!] : []
    if (arg.startsWith("--preload=")) return [arg]
    return []
  })
  if (entry.endsWith(".ts")) {
    const current = fileURLToPath(new URL(import.meta.url))
    const opencodeEntry = resolve(dirname(current), "../../opencode/src/index.ts")
    return {
      command: process.execPath,
      args: [...preloadArgs, opencodeEntry, ...rawArgs],
    }
  }
  return {
    command: process.execPath,
    args: [...preloadArgs, ...rawArgs],
  }
}

async function delegateToAgentRuntime(rawArgs: string[]): Promise<never> {
  const runtime = agentRuntimeCommand(rawArgs)
  const child = spawn(runtime.command, runtime.args, {
    stdio: "inherit",
    env: {
      ...process.env,
      CLICKZETTA_AGENT_RUNTIME: "1",
    },
  })
  const exitCode = await new Promise<number>((resolve, reject) => {
    child.once("error", reject)
    child.once("exit", (code, signal) => {
      if (signal) resolve(1)
      else resolve(code ?? 0)
    })
  })
  process.exit(exitCode)
}

async function parseRegisteredCommands(args: string[]): Promise<void> {
  await registerCommands(createCli(args)).demandCommand(1, "").help().parseAsync()
}

function normalizeCliArgs(rawArgs: string[]) {
  const args = rawArgs.length === 0 ? ["--help"] : rawArgs
  const command = args[0] ?? ""
  const isHelpRequest = args.includes("--help") || args.includes("-h")
  return {
    args,
    command,
    isHelpRequest,
    shouldDelegateToAgentRuntime:
      command === "run" ||
      command === "llm" ||
      command === "config" ||
      (command === "agent" && !isHelpRequest && ["run", "llm", "config"].includes(args[1] ?? "")),
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

  if (process.env.CLICKZETTA_MIGRATE_PROFILES_ONLY === "1") {
    await migrateProfilesOnlyAndExit()
  }

  if (normalized.shouldDelegateToAgentRuntime) {
    await delegateToAgentRuntime(normalized.args)
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
