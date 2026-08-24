import { EOL } from "os"
import os from "os"
import fs from "fs"
import path from "path"
import { errorMessage } from "opencode/util/error"
import { flushOtel } from "../opencode-plugin/otel/index.js"
import { flushLangfuse, initLangfuse } from "../langfuse.js"
import { CLICKZETTA_AGENT_SYSTEM_PROMPT } from "../agent-system-prompt.js"
import { parseAgentTimeoutMs } from "./runtime-config.js"
import { KNOWN_GLOBAL_FLAGS } from "../cli.js"
import { applyBaseOpencodeEnv, applyAgentRuntimeInjection } from "./opencode-injection.js"

let globalHandlersRegistered = false

/**
 * The cz global flags that reach `cz-cli serve`'s own parser, as hidden no-ops.
 *
 * Built from cli.ts's KNOWN_GLOBAL_FLAGS — the single list the top-level parser and
 * both fail handlers already use — so adding a global there cannot silently start
 * failing `serve`. `help`/`version` are declared separately above with their real
 * behavior, and the short aliases are declared as their own entries because they
 * arrive un-canonicalized on this path.
 */
function serveInheritedGlobals(): Record<string, { type: "string" | "boolean"; hidden: true }> {
  const booleans = new Set(["debug", "d"])
  const skip = new Set(["help", "h", "version", "v"])
  const options: Record<string, { type: "string" | "boolean"; hidden: true }> = {}
  for (const flag of KNOWN_GLOBAL_FLAGS) {
    if (skip.has(flag)) continue
    options[flag] = { type: booleans.has(flag) ? "boolean" : "string", hidden: true }
  }
  return options
}

/** The logging flags `cz-cli serve` accepts, mirroring upstream's root parser. */
export interface ServeLogFlags {
  "print-logs"?: boolean
  "log-level"?: string
  pure?: boolean
}

/**
 * cz_change: wire `cz-cli serve`'s logging flags to the env vars opencode reads.
 *
 * These three are declared on upstream's ROOT parser (opencode's index.ts), which
 * `cz-cli serve` never goes through, so before this they were accepted and did
 * nothing — and could not be rejected either, because turning on .strict() without
 * declaring them would have failed a documented invocation. Exported so a test can
 * assert the wiring without starting a server.
 */
export function applyServeLogFlags(flags: ServeLogFlags): void {
  if (flags["print-logs"]) process.env.OPENCODE_PRINT_LOGS = "1"
  if (flags["log-level"]) process.env.OPENCODE_LOG_LEVEL = String(flags["log-level"])
  if (flags.pure) process.env.OPENCODE_PURE = "1"
}

export async function main(args: string[], agentRuntime = false): Promise<number> {
  // cz_change: apply the base opencode env injection (kill upstream auto-updater,
  // disable repo-local project config, telemetry defaults) at the very top of main()
  // — before opencode or the TUI server Worker reads any flag. All injection is
  // centralized in opencode-injection.ts; see its REGISTRY comment for the full list.
  applyBaseOpencodeEnv()

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

  if (!agentRuntime) {
    const { createTraceparent } = await import("@clickzetta/sdk")
    if (!process.env.CLICKZETTA_TRACEPARENT) {
      process.env.CLICKZETTA_TRACEPARENT = createTraceparent()
    }
    const { runCliWithTracking } = await import("@clickzetta/cli")
    await runCliWithTracking(args)
    return (process.exitCode as number) ?? 0
  }

  // cz_change: one-time llm.json migrations must run BEFORE the agent-runtime
  // injection reads llm.json. migrateProfilesLlmToJson pulls origin/main's
  // `[llm.*]` tables from profiles.toml — runCli() already ran it before its
  // gates (that is the load-bearing call; see the comment there), this stays as
  // a belt-and-braces no-op for entries that reach the runtime some other way.
  // normalizeLlmProviderNames heals older llm.json where every provider
  // collapsed to name="ClickZetta".
  try {
    const { migrateProfilesLlmToJson, normalizeLlmProviderNames } = await import("../llm/native-config.js")
    try {
      migrateProfilesLlmToJson()
    } catch {}
    try {
      normalizeLlmProviderNames()
    } catch {}
  } catch {}

  // cz_change: re-home origin's `agent run --timeout <seconds>` first-byte timeout.
  // Parse it here (same process, args carry it); opencode's provider.ts consumes
  // options.headerTimeout. null = flag present but invalid.
  const agentTimeoutMs = parseAgentTimeoutMs(args)
  if (agentTimeoutMs === null) {
    process.stderr.write("--timeout must be a positive number of seconds\n")
    return 1
  }

  // cz_change: agent-runtime-only injection — OPENCODE_CONFIG (llm.json),
  // OPENCODE_CONFIG_CONTENT (providers/skills/plugins + data_engineer default agent),
  // OPENCODE_TUI_CONFIG (brand), the operational system prompt, and the TUI Worker
  // env shim. All centralized in opencode-injection.ts; see its REGISTRY comment.
  applyAgentRuntimeInjection(agentTimeoutMs)

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
      // cz_change: same invariant as src/cli.ts — yargs' built-in messages must
      // not localize to the shell's LANG, or a caller parsing them (and
      // test/robustness.test.ts) sees Chinese on a zh_CN machine.
      .locale("en")
      .help("help", "show help")
      .alias("help", "h")
      .version("version", "show version number", InstallationVersion)
      .alias("version", "v")
      .command(ServeCommand)
      // cz_change: these three belong to upstream's ROOT parser (opencode's
      // index.ts), which `cz-cli serve` never goes through — so they used to be
      // accepted and do nothing. Declared here, wired to the same env vars
      // upstream's middleware sets, which is also what lets .strict() below reject
      // a real typo: `serve --prot 8080` silently started on the default port
      // (which is 0, i.e. a random one) instead of reporting the flag.
      .option("print-logs", { type: "boolean", describe: "print logs to stderr" })
      .option("log-level", { type: "string", choices: ["DEBUG", "INFO", "WARN", "ERROR"], describe: "log level" })
      .option("pure", { type: "boolean", describe: "run without external plugins" })
      // cz_change: `serve` is in run-cli.ts's RUNTIME_COMMANDS, so the outer layer has
      // ALREADY read the cz global flags off this same argv — the connection ones
      // select the lakehouse the served agent connects as (via ConnectionEnv), and
      // `--format` is re-inserted after the command word by normalizeCliArgs. They all
      // still arrive here, so .strict() below would reject invocations that work
      // today. Declared from the CLI's own list rather than by hand so the two cannot
      // drift, hidden and unused because the values are consumed before this parser
      // ever sees them — the same thing runLlm does for `--profile`.
      .options(serveInheritedGlobals())
      .middleware((opts) => applyServeLogFlags(opts as ServeLogFlags), true)
      .strict()
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
        "    cz-cli auth login <name>\n" +
        "      Recommended. Browser sign-in; <name> labels this login (e.g. company-prod).\n" +
        "      Discovers your instances/workspaces and creates a profile for each.\n\n" +
        "    cz-cli auth login <name> --credential <base64_string>\n" +
        "      New-user fast path from a registration token\n\n" +
        "    cz-cli auth login <name> --username <username> --password <password> --account-name <account_name>\n" +
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
          next_step: "cz-cli auth login <name>",
          next_steps: [
            "cz-cli auth login <name>",
            "cz-cli auth login <name> --credential <base64_string>",
            "cz-cli auth login <name> --username <username> --password <password> --account-name <account_name>",
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
  //
  // cz_change: only the commands cz-cli actually EXPOSES are imported and
  // registered here. run-cli.ts routes `agent <sub>` into this runtime solely for
  // AGENT_RUNTIME_SUBCOMMANDS (run/llm/session/stats/export); every other
  // subcommand never reaches this parser. Registering the rest of upstream's tree
  // (acp, attach, generate, account/login, providers, agent create, upgrade,
  // uninstall, web, models, import, github, pr, plugin, db, debug) therefore added
  // ~140ms of unreachable module loading per agent start, and — worse — split the
  // definition of "what cz exposes" across two places that had to be kept in sync
  // by hand. A re-baseline that added an upstream command would silently widen the
  // registered set while the whitelist stayed put.
  //
  // The set below is now the single source of truth alongside that whitelist:
  //   RunCommand/SessionCommand/AgentLlmCommand/StatsCommand/ExportCommand
  //     — the five whitelisted subcommands
  //   TuiThreadCommand ($0) — bare `cz-cli agent`, the interactive TUI
  //   McpCommand/ServeCommand — reached through their own branches above, not as
  //     `agent <sub>`; ServeCommand is also used by the `serve` fast path
  //   SetupCommand — `cz-cli agent setup`, cz-owned (commands/agent-setup.ts)
  // To expose another upstream command, add it BOTH here and to
  // AGENT_RUNTIME_SUBCOMMANDS in run-cli.ts.
  const { default: yargs } = await import("yargs")
  const { UI } = await import("opencode/cli/ui")
  const { InstallationVersion } = await import("@opencode-ai/core/installation/version")
  const { FormatError } = await import("opencode/cli/error")
  const { Heap } = await import("opencode/cli/heap")
  // cz_change: use the cz-owned run wrapper (agent-cmd/run.ts) instead of the
  // pristine upstream RunCommand, so ClickZetta customizations (--async,
  // --session create-if-missing) live in cz-cli. Mirrors SessionCommand.
  const { RunCommand } = await import("../agent-cmd/run.js")
  const { ServeCommand } = await import("opencode/cli/cmd/serve")
  const { StatsCommand } = await import("opencode/cli/cmd/stats")
  const { McpCommand } = await import("opencode/cli/cmd/mcp")
  const { ExportCommand } = await import("opencode/cli/cmd/export")
  // cz_change: cz-owned $0 TUI command — drops upstream's `--mini` interface, which
  // prints unbrandable opencode splash art plus a dead-end `opencode --mini -s <id>`
  // continue hint. See src/agent-cmd/tui.ts.
  const { TuiThreadCommand } = await import("../agent-cmd/tui.js")
  // cz_change: session command tree is owned by cz-cli (adds `status`; a2's
  // rebase-to-pure-upstream dropped the cz SessionStatusCommand). Reuses
  // upstream list/delete internally. See src/agent-cmd/session.ts.
  const { SessionCommand } = await import("../agent-cmd/session.js")
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
    // cz_change: pin English, as src/cli.ts does. Without it the agent subtree
    // answered `agent session list --format csv` with "无效的选项值：…" on a
    // zh_CN machine while the rest of the CLI stayed English.
    .locale("en")
    .wrap(100)
    .help("help", "show help")
    .alias("help", "h")
    .version("version", "show version number", InstallationVersion)
    .alias("version", "v")
    .epilogue(
      "LLM configuration:\n" +
      "  `cz-cli auth login <name> --credential <base64>` writes the API configuration to ~/.clickzetta/llm.json.\n" +
      "  Add Claude/OpenAI/etc: `cz-cli agent llm add my-claude --provider anthropic --api-key sk-ant-...`\n" +
      "           supports clickzetta, anthropic, openai, bedrock, google, azure, openai-compatible, openrouter.\n" +
      "  Inspect: `cz-cli agent llm show`\n" +
      "  Test:    `cz-cli agent llm test <name>`\n" +
      "  Models:  `cz-cli agent llm models <name>`\n" +
      "  Optional pin: `cz-cli agent llm use <name>/<MODEL_ID>` (otherwise the first available model is used)\n" +
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
    //
    // Fall back to CZ_PROFILE, not to default_profile: run-cli.ts has already
    // resolved --profile (and the -p short form) into CZ_PROFILE before
    // delegating here. Passing a bare `undefined` made this middleware RESET an
    // explicitly selected profile back to default_profile, silently retargeting
    // the session at the wrong lakehouse.
    const { applyClickZettaProfile } = await import("./profile-env.js")
    const { ConnectionEnv } = await import("../connection/env.js")
    applyClickZettaProfile((opts.profile as string | undefined) ?? ConnectionEnv.profileName())

    Heap.start()

    process.env.AGENT = "1"
    process.env.CLICKZETTA = "1"
    process.env.CLICKZETTA_PID = String(process.pid)
  })

  cli
    .usage("")
    .completion("completion", "generate shell completion script")
    // cz_change: declare the cz global output flags on the agent runtime root.
    // commandGroup(cli, "agent") below applies strictOptions(), so anything not
    // declared here is rejected as unknown — and cz's own `-o/--output` removal
    // notice points users at --format, which then failed on `agent stats`.
    // Upstream declares --format on `session` only, so acceptance differed per
    // subcommand for no reason a user could see. Declaring both at the root makes
    // the whole agent tree accept them uniformly; subcommands that implement a
    // formatter (session) still consume it, the rest ignore it.
    .option("format", {
      type: "string",
      describe: "Output format. Commands that emit JSON already ignore this; accepted everywhere for consistency.",
    })
    .option("field", {
      type: "string",
      describe: "Extract a single field from the response, where the command supports it.",
    })
    // cz_change: exposed commands only — see the import block above for why the
    // rest of upstream's tree is deliberately absent.
    .command(McpCommand)
    .command(TuiThreadCommand)
    .command(RunCommand)
    .command(AgentLlmCommand)
    .command(ServeCommand)
    .command(StatsCommand)
    .command(ExportCommand)
    .command(SessionCommand)
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
