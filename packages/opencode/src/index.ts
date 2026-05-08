import yargs from "yargs"
import { hideBin } from "yargs/helpers"
import { RunCommand } from "./cli/cmd/run"
import { GenerateCommand } from "./cli/cmd/generate"
import { Log } from "./util"
import { ConsoleCommand } from "./cli/cmd/account"
import { ProvidersCommand } from "./cli/cmd/providers"
import { AgentCreateCommand, AgentListCommand } from "./cli/cmd/agent"
import { UpgradeCommand } from "./cli/cmd/upgrade"
import { UninstallCommand } from "./cli/cmd/uninstall"
import { ModelsCommand } from "./cli/cmd/models"
import { UI } from "./cli/ui"
import { Installation } from "./installation"
import { InstallationVersion } from "./installation/version"
import { NamedError } from "@opencode-ai/shared/util/error"
import { FormatError } from "./cli/error"
import { ServeCommand } from "./cli/cmd/serve"
import { Filesystem } from "./util"
import { DebugCommand } from "./cli/cmd/debug"
import { StatsCommand } from "./cli/cmd/stats"
import { McpCommand } from "./cli/cmd/mcp"
import { GithubCommand } from "./cli/cmd/github"
import { ExportCommand } from "./cli/cmd/export"
import { ImportCommand } from "./cli/cmd/import"
import { AttachCommand } from "./cli/cmd/tui/attach"
import { TuiThreadCommand } from "./cli/cmd/tui/thread"
import { AcpCommand } from "./cli/cmd/acp"
import { EOL } from "os"
import os from "os"
import fs from "fs"
import { forward } from "./cli/cmd/forward"
import { WebCommand } from "./cli/cmd/web"
import { PrCommand } from "./cli/cmd/pr"
import { SessionCommand } from "./cli/cmd/session"
import { DbCommand } from "./cli/cmd/db"
import path from "path"
import { Global } from "./global"
import { JsonMigration } from "./storage"
import { Database } from "./storage"
import { errorMessage } from "./util/error"
import { PluginCommand } from "./cli/cmd/plug"
import { SetupCommand } from "./cli/cmd/setup"
import { AgentLlmCommand } from "./cli/cmd/config-llm"
import { Heap } from "./cli/heap"
import { drizzle } from "drizzle-orm/bun-sqlite"

process.on("unhandledRejection", (e) => {
  Log.Default.error("rejection", {
    e: errorMessage(e),
  })
})

process.on("uncaughtException", (e) => {
  Log.Default.error("exception", {
    e: errorMessage(e),
  })
})

const rawArgs = hideBin(process.argv)

// Fast path: `cz-cli setup` runs before any agent bootstrap
// Skip fast path for --help/-h so yargs can render the help text
if (rawArgs[0] === "setup" && !rawArgs.includes("--help") && !rawArgs.includes("-h")) {
  const { setup } = await import("./cli/cmd/setup")
  await setup(rawArgs.slice(1))
}

// `agent` and `run` are handled by the yargs CLI below.
// Everything else (sql, table, profile, status, …) is forwarded to cz-tool.
const isAgentSubcommand = rawArgs[0] === "agent" || rawArgs[0] === "run"

if (rawArgs.length === 0 || ["--help", "-h"].includes(rawArgs[0])) {
  // No-args / help: fall through to yargs so it renders the full help text
}

if (["--version", "-v"].includes(rawArgs[0])) {
  process.stdout.write(InstallationVersion + "\n")
  process.exit(0)
}

// Non-agent, non-setup commands are forwarded directly to the cz-tool binary.
if (!isAgentSubcommand && rawArgs[0] !== "setup" && rawArgs.length > 0 && !["--help", "-h", "--version", "-v"].includes(rawArgs[0])) {
  await forward(rawArgs)
}

// Require profiles.toml with api_key before entering agent commands
if (isAgentSubcommand) {
  const profilesPath = path.join(os.homedir(), ".clickzetta", "profiles.toml")
  let hasApiKey = false
  let profileExists = false
  let hasLlmEntry = false
  try {
    const content = fs.readFileSync(profilesPath, "utf-8")
    profileExists = true
    const defaultMatch = content.match(/^default_profile\s*=\s*"(.+)"/m)
    const profileName = defaultMatch ? defaultMatch[1] : "default"
    const sectionHeader = `[profiles.${profileName}]`
    const sectionStart = content.indexOf(sectionHeader)
    if (sectionStart >= 0) {
      const nextSection = content.indexOf("\n[", sectionStart + sectionHeader.length)
      const section = nextSection >= 0 ? content.slice(sectionStart, nextSection) : content.slice(sectionStart)
      hasApiKey = /^api_key\s*=\s*".+"/m.test(section)
    }
    if (!hasApiKey) {
      hasApiKey = /^api_key\s*=\s*".+"/m.test(content)
    }
    hasLlmEntry = /^\[llm\./m.test(content)
  } catch {}
  if (!hasApiKey) {
    const isTTY = process.stderr.isTTY
    if (isTTY) {
      if (!profileExists) {
        process.stderr.write(
          "\n  No ClickZetta profile configured.\n" +
          "  Run:\n\n" +
          "    cz-cli setup                              # interactive setup (TTY)\n" +
          "    cz-cli setup --credential <base64_string>  # from registration token\n\n" +
          "  Register at:\n" +
          "    https://accounts.clickzetta.com/register?ref=cz-cli (China)\n" +
          "    https://accounts.singdata.com/register?ref=cz-cli (International)\n\n",
        )
      } else if (hasLlmEntry) {
        process.stderr.write(
          "\n  Profile found but no ClickZetta api_key.\n" +
          "  You have user-defined LLM entries — run:\n\n" +
          "    cz-cli agent llm show   # check which LLM is active\n\n" +
          "  Or re-run setup to add a ClickZetta api_key:\n" +
          "    cz-cli setup --credential <base64_string>\n\n",
        )
      } else {
        process.stderr.write(
          "\n  Profile found but missing api_key.\n" +
          "  Re-run setup or add an LLM key:\n\n" +
          "    cz-cli setup --credential <base64_string>\n" +
          "    cz-cli agent llm add my-claude --provider anthropic --api-key sk-ant-... --use\n\n",
        )
      }
    } else {
      const base: Record<string, unknown> = {
        ok: false,
        error: "NO_PROFILE",
        profile_exists: profileExists,
        has_llm_entry: hasLlmEntry,
      }
      if (!profileExists) {
        Object.assign(base, {
          message: "No ClickZetta profile configured. Run setup with a registration credential.",
          next_steps: [
            "cz-cli setup --credential <base64_string>",
          ],
          register_urls: [
            "https://accounts.clickzetta.com/register?ref=cz-cli",
            "https://accounts.singdata.com/register?ref=cz-cli",
          ],
        })
      } else if (hasLlmEntry) {
        Object.assign(base, {
          message: "Profile exists but no ClickZetta api_key. You have user-defined LLM entries — check which is active.",
          next_steps: [
            "cz-cli agent llm show",
            "cz-cli agent llm add <name> --provider <provider> --api-key <key> --use",
          ],
        })
      } else {
        Object.assign(base, {
          message: "Profile exists but missing api_key. Re-run setup or add an LLM key.",
          next_steps: [
            "cz-cli setup --credential <base64_string>",
            "cz-cli agent llm add my-claude --provider anthropic --api-key <key> --use",
            "cz-cli agent llm add my-openai --provider openai --api-key <key> --use",
          ],
          supported_providers: ["anthropic", "openai", "openai-compatible", "bedrock", "google", "azure"],
        })
      }
      process.stdout.write(JSON.stringify(base) + "\n")
    }
    process.exit(1)
  }
}

const args = isAgentSubcommand ? rawArgs.slice(1) : rawArgs

function show(out: string) {
  const text = out.trimStart()
  if (!text.startsWith("cz-cli agent ") && !text.startsWith("clickzetta ")) {
    process.stderr.write(EOL + "  " + UI.Style.TEXT_INFO_BOLD + "◆ cz-cli" + UI.Style.TEXT_NORMAL + EOL + EOL)
    process.stderr.write(text)
    return
  }
  process.stderr.write(out)
}

const cli = yargs(args)
  .parserConfiguration({ "populate--": true })
  .scriptName("cz-cli agent")
  .wrap(100)
  .help("help", "show help")
  .alias("help", "h")
  .version("version", "show version number", InstallationVersion)
  .alias("version", "v")
  .epilogue(
    "LLM configuration:\n" +
    "  Default: ClickZetta built-in LLM (configured by `cz-cli setup --credential <base64>`).\n" +
    "  Add Claude/OpenAI/etc: `cz-cli agent llm add my-claude --provider anthropic --api-key sk-ant-... --use`\n" +
    "           supports anthropic, openai, bedrock, google, azure, openai-compatible (third-party relays via --base-url).\n" +
    "  Inspect: `cz-cli agent llm show`\n" +
    "  Manage:  `cz-cli agent llm --help`"
  )
  .option("print-logs", {
    describe: "print logs to stderr",
    type: "boolean",
  })
  .option("log-level", {
    describe: "log level",
    type: "string",
    choices: ["DEBUG", "INFO", "WARN", "ERROR"],
  })
  .option("pure", {
    describe: "run without external plugins",
    type: "boolean",
  })
  .middleware(async (opts) => {
    if (opts.pure) {
      process.env.CLICKZETTA_PURE = "1"
    }

    await Log.init({
      print: process.argv.includes("--print-logs"),
      dev: Installation.isLocal(),
      level: (() => {
        if (opts.logLevel) return opts.logLevel as Log.Level
        if (Installation.isLocal()) return "DEBUG"
        return "INFO"
      })(),
    })

    Heap.start()

    process.env.AGENT = "1"
    process.env.CLICKZETTA = "1"
    process.env.CLICKZETTA_PID = String(process.pid)

    Log.Default.info("clickzetta", {
      version: InstallationVersion,
      args: process.argv.slice(2),
    })

    const marker = path.join(Global.Path.data, "clickzetta.db")
    if (!(await Filesystem.exists(marker))) {
      const tty = process.stderr.isTTY
      process.stderr.write("Performing one time database migration, may take a few minutes..." + EOL)
      const width = 36
      const orange = "\x1b[38;5;214m"
      const muted = "\x1b[0;2m"
      const reset = "\x1b[0m"
      let last = -1
      if (tty) process.stderr.write("\x1b[?25l")
      try {
        await JsonMigration.run(drizzle({ client: Database.Client().$client }), {
          progress: (event) => {
            const percent = Math.floor((event.current / event.total) * 100)
            if (percent === last && event.current !== event.total) return
            last = percent
            if (tty) {
              const fill = Math.round((percent / 100) * width)
              const bar = `${"■".repeat(fill)}${"･".repeat(width - fill)}`
              process.stderr.write(
                `\r${orange}${bar} ${percent.toString().padStart(3)}%${reset} ${muted}${event.label.padEnd(12)} ${event.current}/${event.total}${reset}`,
              )
              if (event.current === event.total) process.stderr.write("\n")
            } else {
              process.stderr.write(`sqlite-migration:${percent}${EOL}`)
            }
          },
        })
      } finally {
        if (tty) process.stderr.write("\x1b[?25h")
        else {
          process.stderr.write(`sqlite-migration:done${EOL}`)
        }
      }
      process.stderr.write("Database migration complete." + EOL)
    }
  })
  .usage("")
  .completion("completion", "generate shell completion script")
  .command(AcpCommand)
  .command(McpCommand)
  .command(TuiThreadCommand)
  .command(AttachCommand)
  .command(RunCommand)
  .command(GenerateCommand)
  .command(DebugCommand)
  .command(ConsoleCommand)
  .command(ProvidersCommand)
  .command(AgentCreateCommand)
  .command(AgentListCommand)
  .command(AgentLlmCommand)
  .command(UpgradeCommand)
  .command(UninstallCommand)
  .command(ServeCommand)
  .command(WebCommand)
  .command(ModelsCommand)
  .command(StatsCommand)
  .command(ExportCommand)
  .command(ImportCommand)
  .command(GithubCommand)
  .command(PrCommand)
  .command(SessionCommand)
  .command(PluginCommand)
  .command(DbCommand)
  .command(SetupCommand)
  .fail((msg, err) => {
    if (
      msg?.startsWith("Unknown argument") ||
      msg?.startsWith("Not enough non-option arguments") ||
      msg?.startsWith("Invalid values:")
    ) {
      if (err) throw err
      if (!process.stderr.isTTY) {
        process.stdout.write(JSON.stringify({ ok: false, error: "INVALID_ARGS", message: msg }) + EOL)
        process.exit(1)
      }
      cli.showHelp(show)
    }
    if (err) throw err
    process.exit(1)
  })
  .strict()

try {
  if (args.includes("-h") || args.includes("--help")) {
    await cli.parse(args, (err: Error | undefined, _argv: unknown, out: string) => {
      if (err) throw err
      if (!out) return
      show(out)
    })
  } else {
    await cli.parse()
  }
} catch (e) {
  let data: Record<string, any> = {}
  if (e instanceof NamedError) {
    const obj = e.toObject()
    Object.assign(data, {
      ...obj.data,
    })
  }

  if (e instanceof Error) {
    Object.assign(data, {
      name: e.name,
      message: e.message,
      cause: e.cause?.toString(),
      stack: e.stack,
    })
  }

  if (e instanceof ResolveMessage) {
    Object.assign(data, {
      name: e.name,
      message: e.message,
      code: e.code,
      specifier: e.specifier,
      referrer: e.referrer,
      position: e.position,
      importKind: e.importKind,
    })
  }
  Log.Default.error("fatal", data)
  const formatted = FormatError(e)
  if (formatted) UI.error(formatted)
  if (formatted === undefined) {
    UI.error("Unexpected error, check log file at " + Log.file() + " for more details" + EOL)
    process.stderr.write(errorMessage(e) + EOL)
  }
  process.exitCode = 1
} finally {
  // Some subprocesses don't react properly to SIGTERM and similar signals.
  // Most notably, some docker-container-based MCP servers don't handle such signals unless
  // run using `docker run --init`.
  // Explicitly exit to avoid any hanging subprocesses.
  process.exit()
}
