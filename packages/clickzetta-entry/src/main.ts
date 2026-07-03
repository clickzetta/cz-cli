import { EOL } from "os"
import os from "os"
import fs from "fs"
import path from "path"
import { Log } from "opencode/clickzetta/log"
import { errorMessage } from "opencode/util/error"
import { flushOtel } from "opencode/plugin/otel/index"
import { flush as flushLangfuse } from "opencode/plugin/langfuse"

let globalHandlersRegistered = false

export async function main(args: string[], agentRuntime = false): Promise<number> {
  if (!globalHandlersRegistered) {
    globalHandlersRegistered = true
    process.on("unhandledRejection", (e) => {
      Log.Default.error("rejection", {
        e: errorMessage(e),
      })
    })
    process.on("uncaughtException", (e) => {
      Log.Default.error("exception", {
        e: errorMessage(e),
        stack: e instanceof Error ? e.stack : undefined,
      })
    })
  }

  const clickzettaHome = process.env.CLICKZETTA_TEST_HOME || os.homedir()

  if (!agentRuntime) {
    const { createTraceparent } = await import("@clickzetta/sdk")
    if (!process.env.CLICKZETTA_TRACEPARENT) {
      process.env.CLICKZETTA_TRACEPARENT = createTraceparent()
    }
    const { runCliWithTracking } = await import("@clickzetta/cli")
    await runCliWithTracking(args)
    return (process.exitCode as number) ?? 0
  }

  if (process.env.CLICKZETTA_MIGRATE_PROFILES_ONLY === "1") {
    const profilesPath = path.join(clickzettaHome, ".clickzetta", "profiles.toml")
    try {
      if (fs.existsSync(profilesPath)) {
        const [{ parse, stringify }, { migrateLegacyClickzettaConfig }] = await Promise.all([
          import("smol-toml"),
          import("opencode/config/profiles-llm"),
        ])
        const parsed = parse(fs.readFileSync(profilesPath, "utf-8"))
        if (
          typeof parsed === "object" &&
          parsed !== null &&
          !Array.isArray(parsed) &&
          migrateLegacyClickzettaConfig(parsed as Record<string, unknown>)
        ) {
          fs.writeFileSync(profilesPath, stringify(parsed) + "\n")
        }
      }
    } catch {}
    return 0
  }

  // cz_change: ClickZetta LLM config lives in ~/.clickzetta/llm.json (opencode
  // native format). Migrate legacy profiles.toml [llm.*] into it once (idempotent
  // — no-op after the first run), then point OPENCODE_CONFIG at it so opencode
  // loads providers/model through its built-in mechanism — no seam in config.ts.
  try {
    const { llmConfigPath, migrateProfilesLlmToNative } = await import("opencode/clickzetta/native-config")
    migrateProfilesLlmToNative()
    const llmPath = llmConfigPath()
    if (fs.existsSync(llmPath) && !process.env.OPENCODE_CONFIG) {
      process.env.OPENCODE_CONFIG = llmPath
    }
  } catch {}

  // --version fast path
  if (["--version", "-v"].includes(args[0])) {
    const { InstallationVersion } = await import("@opencode-ai/core/installation/version")
    process.stdout.write(InstallationVersion + "\n")
    return 0
  }

  // setup fast path — runs before any agent bootstrap.
  // Also forward setup --help to cz-cli so TUI modules are never loaded.
  if (args[0] === "setup") {
    if (args.includes("--help") || args.includes("-h")) {
      const { forward } = await import("opencode/cli/cmd/forward")
      await forward(args)
    }
    const { setup } = await import("opencode/cli/cmd/setup")
    await setup(args.slice(1))
  }

  const isAgentSubcommand = args[0] === "agent" || args[0] === "run"
  const isHelpRequest = args.includes("--help") || args.includes("-h")

  // --help for agent/run: forward to cz-cli so TUI modules are never loaded.
  if (isAgentSubcommand && isHelpRequest) {
    const { forward } = await import("opencode/cli/cmd/forward")
    await forward(args)
  }

  if (args[0] === "agent" && args[1] === "llm") {
    const { runLlm } = await import("opencode/cli/cmd/config-llm")
    await runLlm(args.slice(1))
  }

  if (args[0] === "llm") {
    const { runLlm } = await import("opencode/cli/cmd/config-llm")
    await runLlm(["llm", ...args.slice(1)])
  }

  if (args[0] === "serve") {
    const [{ default: yargs }, { ServeCommand }, { InstallationVersion }] = await Promise.all([
      import("yargs"),
      import("opencode/cli/cmd/serve"),
      import("@opencode-ai/core/installation/version"),
    ])
    await yargs(args)
      .scriptName("cz-cli")
      .help("help", "show help")
      .alias("help", "h")
      .version("version", "show version number", InstallationVersion)
      .alias("version", "v")
      .command(ServeCommand)
      .demandCommand(1, "")
      .parseAsync()
    return (process.exitCode as number) ?? 0
  }

  // Prevent recursive agent invocation
  if (isAgentSubcommand && process.env.CLICKZETTA_PID) {
    process.stderr.write("Cannot start a nested agent session (already running inside an agent).\n")
    return 1
  }

  // Profile check
  function checkProfile(): boolean {
    const profilesPath = path.join(clickzettaHome, ".clickzetta", "profiles.toml")
    try {
      const content = fs.readFileSync(profilesPath, "utf-8")
      return /^\[profiles\./m.test(content)
    } catch {
      return false
    }
  }

  function exitNoProfile(): number {
    const isTTY = process.stderr.isTTY
    if (isTTY) {
      process.stderr.write(
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
        "    cz-cli agent llm --help\n\n",
      )
    } else {
      process.stdout.write(JSON.stringify({
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
      }) + "\n")
    }
    return 1
  }
  const FORWARDED_CLI_COMMANDS = new Set([
    "sql",
    "schema",
    "table",
    "workspace",
    "status",
    "profile",
    "task",
    "runs",
    "attempts",
    "job",
    "update",
    "datasource",
    "analytics-agent",
  ])
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
  const isHelpOrEmpty = args.length === 0 || (args.length === 1 && ["--help", "-h"].includes(args[0]))
  const isForwardedCliCommand =
    !isAgentSubcommand &&
    args.length > 0 &&
    FORWARDED_CLI_COMMANDS.has(args[0] ?? "")

  if (isHelpOrEmpty || isForwardedCliCommand) {
    if (isForwardedCliCommand && PROFILE_REQUIRED_COMMANDS.has(args[0] ?? "") && !isHelpRequest && !checkProfile()) {
      return exitNoProfile()
    }

    const { forward } = await import("opencode/cli/cmd/forward")
    await forward(isHelpOrEmpty ? ["--help"] : args)
  }
  // Dynamic imports — only reached for `cz-cli agent …`
  const { default: yargs } = await import("yargs")
  const { UI } = await import("opencode/cli/ui")
  const { Installation } = await import("opencode/installation/index")
  const { InstallationVersion } = await import("@opencode-ai/core/installation/version")
  const { NamedError } = await import("@opencode-ai/core/util/error")
  const { FormatError } = await import("opencode/cli/error")
  const { Heap } = await import("opencode/cli/heap")
  const { RunCommand } = await import("opencode/cli/cmd/run")
  const { GenerateCommand } = await import("opencode/cli/cmd/generate")
  const { ConsoleCommand } = await import("opencode/cli/cmd/account")
  const { ProvidersCommand } = await import("opencode/cli/cmd/providers")
  const { AgentCommand } = await import("opencode/cli/cmd/agent")
  const { UpgradeCommand } = await import("opencode/cli/cmd/upgrade")
  const { UninstallCommand } = await import("opencode/cli/cmd/uninstall")
  const { ModelsCommand } = await import("opencode/cli/cmd/models")
  const { ServeCommand } = await import("opencode/cli/cmd/serve")
  const { DebugCommand } = await import("opencode/cli/cmd/debug/index")
  const { StatsCommand } = await import("opencode/cli/cmd/stats")
  const { McpCommand } = await import("opencode/cli/cmd/mcp")
  const { GithubCommand } = await import("opencode/cli/cmd/github")
  const { ExportCommand } = await import("opencode/cli/cmd/export")
  const { ImportCommand } = await import("opencode/cli/cmd/import")
  const { AttachCommand } = await import("opencode/cli/cmd/attach")
  const { TuiThreadCommand } = await import("opencode/cli/cmd/tui")
  const { AcpCommand } = await import("opencode/cli/cmd/acp")
  const { WebCommand } = await import("opencode/cli/cmd/web")
  const { PrCommand } = await import("opencode/cli/cmd/pr")
  const { SessionCommand } = await import("opencode/cli/cmd/session")
  const { DbCommand } = await import("opencode/cli/cmd/db")
  const { PluginCommand } = await import("opencode/cli/cmd/plug")
  const { SetupCommand } = await import("opencode/cli/cmd/setup")
  const { AgentLlmCommand } = await import("opencode/cli/cmd/config-llm")
  const { commandGroup } = await import("@clickzetta/cli/command-group")
  // cz_change: mark the ClickZetta runtime before any session runs. This gates
  // the always-registered internal cz plugins (system-prompt / profile-reminder
  // / skill-filter / outbound-headers) so they only mutate LLM requests when the
  // cz agent actually runs — not in upstream recorded-fixture tests. Idempotent.
  const { markClickzettaRuntime } = await import("opencode/clickzetta/runtime")
  markClickzettaRuntime()
  // cz_change: initialize Langfuse generation tracing before any session runs
  // (no-op unless configured). OTEL spans are handled by OtelPlugin registration.
  const LangfuseTracing = await import("opencode/plugin/langfuse")
  await LangfuseTracing.init()

  const agentArgs = isAgentSubcommand ? args.slice(1) : args

  function show(out: string) {
    const text = out.trimStart()
    if (!text.startsWith("cz-cli agent ") && !text.startsWith("clickzetta ")) {
      process.stderr.write(EOL + "  " + UI.Style.TEXT_INFO_BOLD + "◆ cz-cli" + UI.Style.TEXT_NORMAL + EOL + EOL)
      process.stderr.write(text)
      return
    }
    process.stderr.write(out)
  }

  const cli = yargs(agentArgs)
    .parserConfiguration({ "populate--": true })
    .scriptName("cz-cli agent")
    .wrap(100)
    .help("help", "show help")
    .alias("help", "h")
    .version("version", "show version number", InstallationVersion)
    .alias("version", "v")
    .epilogue(
      "LLM configuration:\n" +
      "  `cz-cli setup --credential <base64>` creates [llm.clickzetta] and selects it by default.\n" +
      "  Add Claude/OpenAI/etc: `cz-cli agent llm add my-claude --provider anthropic --api-key sk-ant-... --use`\n" +
      "           supports clickzetta, anthropic, openai, bedrock, google, azure, openai-compatible, openrouter.\n" +
      "  Inspect: `cz-cli agent llm show`\n" +
      "  Test:    `cz-cli agent llm test [name]`\n" +
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
    .option("profile", {
      // cz_change: select a ClickZetta connection profile; applied in middleware
      // below (exports CZ_* env) before any command handler runs.
      describe: "ClickZetta profile to use (from ~/.clickzetta/profiles.toml)",
      type: "string",
    })

  cli.middleware(async (opts) => {
    if (opts.pure) {
      // cz_change: opencode's plugin loader reads Flag.OPENCODE_PURE.
      process.env.OPENCODE_PURE = "1"
    }

    // cz_change: expand the selected profile into the CZ_* env vars the cz tooling
    // reads, before any agent/session work.
    const { applyClickZettaProfile } = await import("opencode/cli/cmd/clickzetta-profile")
    applyClickZettaProfile(opts.profile as string | undefined)

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
  })

  cli
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
    .command(AgentCommand)
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

  commandGroup(cli, "agent")

  try {
    if (agentArgs.includes("-h") || agentArgs.includes("--help")) {
      await cli.parse(agentArgs, (err: Error | undefined, _argv: unknown, out: string) => {
        if (err) throw err
        if (!out) return
        show(out)
      })
    } else {
      await cli.parse()
    }
  } catch (e) {
    if (process.exitCode) {
      // commandGroup already emitted structured output and set exitCode
    } else {
      let data: Record<string, any> = {}
      if (e instanceof NamedError) {
        const obj = e.toObject()
        Object.assign(data, {
          ...(obj.data as Record<string, any>),
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
    }
  } finally {
    await flushOtel()
    await flushLangfuse()
    process.exit()
  }
}
