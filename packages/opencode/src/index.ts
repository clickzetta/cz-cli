// Minimal static imports — only what's needed before the fast-path exits.
// Agent-specific modules are loaded dynamically below so data commands
// (sql, table, …) don't pay the cost of loading the full agent bundle.
import { hideBin } from "yargs/helpers"
import { EOL } from "os"
import os from "os"
import fs from "fs"
import path from "path"
import { Log } from "./util"
import { errorMessage } from "./util/error"

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

// --version fast path
if (["--version", "-v"].includes(rawArgs[0])) {
  const { InstallationVersion } = await import("./installation/version")
  process.stdout.write(InstallationVersion + "\n")
  process.exit(0)
}

// setup fast path — runs before any agent bootstrap.
// Also forward setup --help to cz-cli so TUI modules are never loaded.
if (rawArgs[0] === "setup") {
  if (rawArgs.includes("--help") || rawArgs.includes("-h")) {
    const { forward } = await import("./cli/cmd/forward")
    await forward(rawArgs)
  }
  const { setup } = await import("./cli/cmd/setup")
  await setup(rawArgs.slice(1))
}

const isAgentSubcommand = rawArgs[0] === "agent" || rawArgs[0] === "run"

// --help for agent/run: forward to cz-cli so TUI modules are never loaded.
if (isAgentSubcommand && (rawArgs.includes("--help") || rawArgs.includes("-h"))) {
  const { forward } = await import("./cli/cmd/forward")
  await forward(rawArgs)
}

// Prevent recursive agent invocation: if we're already inside an agent session,
// block nested `cz-cli agent` / `cz-cli run` calls.
if (isAgentSubcommand && process.env.CLICKZETTA_PID) {
  process.stderr.write("Cannot start a nested agent session (already running inside an agent).\n")
  process.exit(1)
}

// ---------------------------------------------------------------------------
// Profile check — shared by both data commands and agent commands.
// Only checks that profiles.toml exists; key validity is left to the command.
// ---------------------------------------------------------------------------
function checkProfile(): boolean {
  const profilesPath = path.join(os.homedir(), ".clickzetta", "profiles.toml")
  try {
    const content = fs.readFileSync(profilesPath, "utf-8")
    return /^\[profiles\./m.test(content)
  } catch {
    return false
  }
}

function exitNoProfile(): never {
  const isTTY = process.stderr.isTTY
  if (isTTY) {
    process.stderr.write(
      "\n  No ClickZetta profile configured.\n" +
      "  Run:\n\n" +
      "    cz-cli setup                              # interactive setup (TTY)\n" +
      "    cz-cli setup --credential <base64_string>  # from registration token\n\n" +
      "  Register at:\n" +
      "    https://accounts.clickzetta.com/register?ref=cz-cli (China)\n" +
      "    https://accounts.singdata.com/register?ref=cz-cli (International)\n\n",
    )
  } else {
    process.stdout.write(JSON.stringify({
      error: {
        code: "NO_PROFILE",
        message: "No ClickZetta profile configured.",
        next_step: "cz-cli setup --credential <base64_string>",
        register_urls: [
          "https://accounts.clickzetta.com/register?ref=cz-cli",
          "https://accounts.singdata.com/register?ref=cz-cli",
        ],
      },
    }) + "\n")
  }
  process.exit(1)
}

// ---------------------------------------------------------------------------
// Data commands (sql, table, schema, …) and --help/no-args — forward to
// cz-cli so agent modules are never loaded for these paths.
// ---------------------------------------------------------------------------
const isHelpOrEmpty = rawArgs.length === 0 || ["--help", "-h"].includes(rawArgs[0])
const isDataCommand = !isAgentSubcommand && rawArgs[0] !== "setup" && rawArgs.length > 0 && !["--help", "-h", "--version", "-v"].includes(rawArgs[0])

if (isHelpOrEmpty || isDataCommand) {
  if (isDataCommand && !checkProfile()) exitNoProfile()

  const { forward } = await import("./cli/cmd/forward")
  await forward(isHelpOrEmpty ? ["--help"] : rawArgs)
}

// ---------------------------------------------------------------------------
// Agent commands — validate profile then load all agent modules.
// ---------------------------------------------------------------------------
if (isAgentSubcommand) {
  if (!checkProfile()) exitNoProfile()
}

// Dynamic imports — only reached for `cz-cli agent …` or `cz-cli --help`
const [
  { default: yargs },
  { RunCommand },
  { GenerateCommand },
  { UI },
  { Installation },
  { InstallationVersion },
  { NamedError },
  { FormatError },
  { ConsoleCommand },
  { ProvidersCommand },
  { AgentCreateCommand, AgentListCommand },
  { UpgradeCommand },
  { UninstallCommand },
  { ModelsCommand },
  { ServeCommand },
  { Filesystem },
  { DebugCommand },
  { StatsCommand },
  { McpCommand },
  { GithubCommand },
  { ExportCommand },
  { ImportCommand },
  { AttachCommand },
  { TuiThreadCommand },
  { AcpCommand },
  { WebCommand },
  { PrCommand },
  { SessionCommand },
  { DbCommand },
  { Global },
  { JsonMigration, Database },
  { PluginCommand },
  { SetupCommand },
  { AgentLlmCommand },
  { Heap },
  { drizzle },
] = await Promise.all([
  import("yargs"),
  import("./cli/cmd/run"),
  import("./cli/cmd/generate"),
  import("./cli/ui"),
  import("./installation"),
  import("./installation/version"),
  import("@opencode-ai/shared/util/error"),
  import("./cli/error"),
  import("./cli/cmd/account"),
  import("./cli/cmd/providers"),
  import("./cli/cmd/agent"),
  import("./cli/cmd/upgrade"),
  import("./cli/cmd/uninstall"),
  import("./cli/cmd/models"),
  import("./cli/cmd/serve"),
  import("./util"),
  import("./cli/cmd/debug"),
  import("./cli/cmd/stats"),
  import("./cli/cmd/mcp"),
  import("./cli/cmd/github"),
  import("./cli/cmd/export"),
  import("./cli/cmd/import"),
  import("./cli/cmd/tui/attach"),
  import("./cli/cmd/tui/thread"),
  import("./cli/cmd/acp"),
  import("./cli/cmd/web"),
  import("./cli/cmd/pr"),
  import("./cli/cmd/session"),
  import("./cli/cmd/db"),
  import("./global"),
  import("./storage"),
  import("./cli/cmd/plug"),
  import("./cli/cmd/setup"),
  import("./cli/cmd/config-llm"),
  import("./cli/heap"),
  import("drizzle-orm/bun-sqlite"),
])

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
        process.stdout.write(JSON.stringify({ error: { code: "INVALID_ARGS", message: msg } }) + EOL)
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
