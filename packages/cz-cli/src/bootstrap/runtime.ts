import { EOL } from "os"
import os from "os"
import fs from "fs"
import path from "path"
import { errorMessage } from "opencode/util/error"
import { flushOtel } from "../opencode-plugin/otel/index.js"
import { flushLangfuse, initLangfuse } from "../langfuse.js"
import { applyDefaultOtelEnv } from "../otel-defaults.js"
import { CLICKZETTA_AGENT_SYSTEM_PROMPT } from "../agent-system-prompt.js"
import { disableProjectConfigByDefault, disableUpstreamAutoupdate } from "./upstream-autoupdate.js"
import {
  injectClickzettaAgentConfig,
  injectClickzettaTuiConfig,
  installClickzettaWorkerEnvShim,
  parseAgentTimeoutMs,
} from "./runtime-config.js"

let globalHandlersRegistered = false

export async function main(args: string[], agentRuntime = false): Promise<number> {
  // cz_change: neutralize the upstream opencode auto-updater. Both entry flows
  // (compiled boot.ts and dev main.ts → run-cli → delegateToAgentRuntime) converge
  // here, and the TUI's server Worker — which triggers opencode's `upgrade()` — is
  // only created further down in the agent-runtime branch, after
  // installClickzettaWorkerEnvShim() snapshots process.env into the Worker. Setting
  // the flag at the top of main() guarantees it is in process.env before that Worker
  // is built. See disableUpstreamAutoupdate for the flag/timing rationale.
  disableUpstreamAutoupdate()

  // cz_change: default project-level opencode config discovery to OFF, so a repo's
  // stray opencode.json / .opencode never alters cz-cli. Same timing/Worker-propagation
  // rationale as disableUpstreamAutoupdate; user can override with
  // OPENCODE_DISABLE_PROJECT_CONFIG=0. See disableProjectConfigByDefault.
  disableProjectConfigByDefault()


  if (!globalHandlersRegistered) {
    globalHandlersRegistered = true
    process.on("unhandledRejection", (e) => {
      process.stderr.write(`Unhandled rejection: ${errorMessage(e)}${EOL}`)
    })
    process.on("uncaughtException", (e) => {
      process.stderr.write(`Uncaught exception: ${errorMessage(e)}${EOL}`)
      if (e instanceof Error && e.stack) process.stderr.write(e.stack + EOL)
    })
  }

  const clickzettaHome = process.env.CLICKZETTA_TEST_HOME || os.homedir()
  applyDefaultOtelEnv()

  if (!agentRuntime) {
    const { createTraceparent } = await import("@clickzetta/sdk")
    if (!process.env.CLICKZETTA_TRACEPARENT) {
      process.env.CLICKZETTA_TRACEPARENT = createTraceparent()
    }
    const { runCliWithTracking } = await import("@clickzetta/cli")
    await runCliWithTracking(args)
    return (process.exitCode as number) ?? 0
  }

  // cz_change: ClickZetta LLM config lives in ~/.clickzetta/llm.json (opencode
  // native format). If that file exists, point OPENCODE_CONFIG at it so
  // opencode loads providers/model through its built-in mechanism.
  try {
    const { migrateProfilesLlmToJson, llmConfigPath } = await import("../llm/native-config.js")
    // cz_change: one-time migration from origin/main's `[llm.*]` tables in
    // profiles.toml into llm.json (idempotent no-op once done). The `update`
    // command runs in the OLD binary and can't execute this, so trigger it here
    // on the first agent run of the new binary. See migrateProfilesLlmToJson.
    try {
      migrateProfilesLlmToJson()
    } catch {}
    // cz_change: heal older llm.json where every provider name="ClickZetta"
    // (collapsed the /model picker into one duplicated group). name = key.
    try {
      const { normalizeLlmProviderNames } = await import("../llm/native-config.js")
      normalizeLlmProviderNames()
    } catch {}
    const llmPath = llmConfigPath()
    if (fs.existsSync(llmPath) && !process.env.OPENCODE_CONFIG) {
      process.env.OPENCODE_CONFIG = llmPath
    }
  } catch {}

  // cz_change: re-home origin's `agent run --timeout <seconds>` first-byte timeout.
  // Parse it here (same process, args carry it) and inject it into the provider config;
  // opencode's provider.ts consumes options.headerTimeout. null = flag present but invalid.
  const agentTimeoutMs = parseAgentTimeoutMs(args)
  if (agentTimeoutMs === null) {
    process.stderr.write("--timeout must be a positive number of seconds\n")
    return 1
  }
  injectClickzettaAgentConfig(agentTimeoutMs)

  // cz_change: restore ClickZetta home logo in the TUI via OPENCODE_TUI_CONFIG
  // (opencode/tui stay pristine — see injectClickzettaTuiConfig). Best-effort.
  injectClickzettaTuiConfig()

  // cz_change: make the runtime env we just injected (OPENCODE_CONFIG=llm.json,
  // OPENCODE_CONFIG_CONTENT) reach the bare-agent TUI's server Worker. Bun snapshots
  // Worker env at process start, so our runtime mutations wouldn't otherwise be seen
  // inside the Worker (opencode cli/cmd/tui.ts `new Worker(file)`). See
  // installClickzettaWorkerEnvShim. Must run before the TUI handler creates the Worker.
  installClickzettaWorkerEnvShim()

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
      const { forward } = await import("./forward.ts")
      await forward(args)
    }
    const { runSetup } = await import("../commands/agent-setup.js")
    await runSetup(args.slice(1))
  }

  const isAgentSubcommand = args[0] === "agent" || args[0] === "run"
  const isHelpRequest = args.includes("--help") || args.includes("-h")

  // --help for agent/run: forward to cz-cli so TUI modules are never loaded.
  if (isAgentSubcommand && isHelpRequest) {
    const { forward } = await import("./forward.ts")
    await forward(args)
  }

  if (args[0] === "agent" && args[1] === "llm") {
    const { runLlm } = await import("../commands/agent-llm.js")
    await runLlm(args.slice(1))
  }

  if (args[0] === "llm") {
    const { runLlm } = await import("../commands/agent-llm.js")
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

    const { forward } = await import("./forward.ts")
    await forward(isHelpOrEmpty ? ["--help"] : args)
  }
  // Dynamic imports — only reached for `cz-cli agent …`
  const { default: yargs } = await import("yargs")
  const { UI } = await import("opencode/cli/ui")
  const { Installation } = await import("opencode/installation/index")
  const { InstallationVersion } = await import("@opencode-ai/core/installation/version")
  const { FormatError } = await import("opencode/cli/error")
  const { Heap } = await import("opencode/cli/heap")
  // cz_change: use the cz-owned run wrapper (agent-cmd/run.ts) instead of the
  // pristine upstream RunCommand, so ClickZetta customizations (--async,
  // --session create-if-missing) live in cz-cli. Mirrors SessionCommand.
  const { RunCommand } = await import("../agent-cmd/run.js")
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
  // cz_change: session command tree is owned by cz-cli (adds `status`; a2's
  // rebase-to-pure-upstream dropped the cz SessionStatusCommand). Reuses
  // upstream list/delete internally. See src/agent-cmd/session.ts.
  const { SessionCommand } = await import("../agent-cmd/session.js")
  const { DbCommand } = await import("opencode/cli/cmd/db")
  const { PluginCommand } = await import("opencode/cli/cmd/plug")
  const { SetupCommand } = await import("../commands/agent-setup.js")
  const { AgentLlmCommand } = await import("../commands/agent-llm.js")
  const { commandGroup } = await import("@clickzetta/cli/command-group")
  process.env.CLICKZETTA_AGENT_SYSTEM_PROMPT = CLICKZETTA_AGENT_SYSTEM_PROMPT
  await initLangfuse()

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
      "  `cz-cli setup --credential <base64>` writes ~/.clickzetta/llm.json and selects it by default.\n" +
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
    if (opts.printLogs) process.env.OPENCODE_PRINT_LOGS = "1"
    if (opts.logLevel) process.env.OPENCODE_LOG_LEVEL = opts.logLevel as string
    if (opts.pure) {
      // cz_change: opencode's plugin loader reads Flag.OPENCODE_PURE.
      process.env.OPENCODE_PURE = "1"
    }

    // cz_change: expand the selected profile into the CZ_* env vars the cz tooling
    // reads, before any agent/session work.
    const { applyClickZettaProfile } = await import("./profile-env.js")
    applyClickZettaProfile(opts.profile as string | undefined)

    Heap.start()

    process.env.AGENT = "1"
    process.env.CLICKZETTA = "1"
    process.env.CLICKZETTA_PID = String(process.pid)
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
      const formatted = FormatError(e)
      if (formatted) UI.error(formatted)
      if (formatted === undefined) {
        UI.error("Unexpected error" + EOL)
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
