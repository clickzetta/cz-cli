import type { Argv } from "yargs"
import type { GlobalArgs } from "../cli.js"

// cz_change: this command tree exists only to render `--help`; execution is
// delegated to the agent runtime (bootstrap/runtime.ts), which declares just
// --print-logs/--log-level/--pure/--profile. Every OTHER inherited cz global was
// therefore advertised but not accepted: `agent session list --schema foo` and
// `agent stats --debug` both exit 2 with "unrecognized option". Hide them so help
// describes what actually parses.
//
// --profile stays visible (the runtime really implements it). --format/--field are
// left alone: subcommands redefine --format themselves with their own choices.
//
// The short forms matter twice over, because upstream owns them inside `agent`:
// -s is --session (not cz --schema), -v is --version (not cz --vcluster), -d is
// unclaimed. `agent run --help` used to list "-s" twice, once per meaning.
const UNSUPPORTED_AGENT_GLOBALS = [
  "jdbc",
  "pat",
  "username",
  "password",
  "service",
  "protocol",
  "instance",
  "workspace",
  "schema",
  "vcluster",
  "debug",
] as const

function hideUnsupportedGlobals<T>(y: Argv<T>): Argv<T> {
  let next = y
  for (const name of UNSUPPORTED_AGENT_GLOBALS) next = next.option(name, { hidden: true }) as Argv<T>
  return next
}

export function registerAgentCommand(cli: Argv<GlobalArgs>): void {
  cli.command("agent", "AI agent — run sessions, configure LLMs, manage tasks, and optionally override default_profile for the current session", (yargs) =>
    // Applied at the GROUP level, not just per-subcommand: yargs renders a
    // subcommand's Options block from the instance the group builder received, so
    // hiding on a leaf's nested instance alone had no effect on its --help.
    hideUnsupportedGlobals(yargs)
      .command(
        "run <prompt>",
        "Run AI agent with a natural-language prompt",
        (y) => {
          // Reset inherited global --format choices before defining agent-specific ones
          const opts = (y as any).getOptions?.()
          if (opts?.choices?.format) opts.choices.format = []
          return hideUnsupportedGlobals(y)
            .positional("prompt", { type: "string", demandOption: true, describe: "Natural-language request" })
            .option("session", { alias: "s", type: "string", describe: "Session ID to continue" })
            .option("continue", { alias: "c", type: "boolean", describe: "Continue the last session" })
            .option("fork", { type: "boolean", describe: "Fork the session before continuing (requires --continue or --session)" })
            .option("title", { type: "string", describe: "Title for the session" })
            .option("model", { alias: "m", type: "string", describe: "Model to use in the format of provider/model" })
            .option("agent", { type: "string", describe: "Agent to use" })
            .option("file", { alias: "f", type: "string", array: true, describe: "File(s) to attach to message" })
            .option("format", { type: "string", choices: ["default", "json"] as const, describe: "Output format (default=formatted, json=raw JSON events)" })
            .option("timeout", { type: "number", describe: "LLM first-byte timeout in seconds for this run" })
            .option("thinking", { type: "boolean", default: false, describe: "Show thinking blocks" })
            .option("async", { type: "boolean", describe: "Submit asynchronously and return session ID immediately (default in non-TTY)" })
            .option("dangerously-skip-permissions", { type: "boolean", describe: "Skip permission prompts (for CI/automation)" })
            .example("cz-cli agent run \"show tables\"", "One-shot query")
            .example("cz-cli agent run \"show tables\" --profile staging", "Run the agent against a non-default ClickZetta profile")
            .example("cz-cli agent run \"describe sales\" --session my-session", "Multi-turn with session")
            .example("cz-cli agent run \"more details\" --continue", "Continue last session")
            .example("cz-cli agent run \"analyze this schema\" --timeout 150", "Subagent/automation with longer LLM timeout")
        },
        () => {
          // This handler is never reached — cz-cli delegates runtime execution to the internal agent kernel.
          // This command definition exists only to provide correct --help output.
        },
      )
      .command(
        "session",
        "Manage agent sessions",
        (y) =>
          hideUnsupportedGlobals(y)
            .command(
              "list",
              "List sessions",
              (s) => {
                // Reset inherited global --format choices; this command only supports table|json
                const opts = (s as any).getOptions?.()
                if (opts?.choices?.format) opts.choices.format = []
                return s
                  .option("max-count", { alias: "n", type: "number", describe: "Limit to N most recent sessions" })
                  .option("format", { type: "string", choices: ["table", "json"], default: "table", describe: "Output format" })
                  .option("all", { alias: "a", type: "boolean", default: false, describe: "List sessions from all directories" })
                  .example("cz-cli agent session list", "List all sessions")
                  .example("cz-cli agent session list -n 10", "List 10 most recent sessions")
                  .example("cz-cli agent session list --format json", "Output as JSON")
                  .example("cz-cli agent session list --all", "List sessions from all directories")
              },
              () => {},
            )
            .command(
              "delete <sessionID>",
              "Delete a session",
              (s) => s.positional("sessionID", { type: "string", demandOption: true, describe: "Session ID to delete" }),
              () => {},
            )
            .command(
              "status <sessionID>",
              "Get session status — busy/retry returns progress, idle returns result, on failure returns error",
              (s) => {
                // Reset inherited global --format choices; this command only supports json
                const opts = (s as any).getOptions?.()
                if (opts?.choices?.format) opts.choices.format = []
                return s
                  .positional("sessionID", { type: "string", demandOption: true, describe: "Session ID to check" })
                  .option("format", { type: "string", choices: ["json"] as const, default: "json", describe: "Output format" })
                  .option("wait", {
                    type: "boolean",
                    default: false,
                    describe: "Block until idle, streaming deduplicated NDJSON progress events; returns timeout after long periods with no new progress",
                  })
                  .example("cz-cli agent session status <sessionID>", "One-shot snapshot")
                  .example("cz-cli agent session status <sessionID> --wait", "Block, stream progress as NDJSON, exit on idle or timeout")
              },
              () => {},
            )
            .demandCommand(1, "Missing subcommand for 'agent session'. Available: list, delete, status")
            .strict(false),
        () => {},
      )
      .command(
        "export [sessionID]",
        "Export session conversation as JSON",
        (y) =>
          hideUnsupportedGlobals(y)
            .positional("sessionID", { type: "string", describe: "Session ID to export (defaults to last session)" })
            .option("sanitize", { type: "boolean", describe: "Redact sensitive transcript and file data" })
            .example("cz-cli agent export", "Export last session")
            .example("cz-cli agent export abc123", "Export specific session")
            .example("cz-cli agent export abc123 --sanitize", "Export with sensitive data redacted"),
        () => {},
      )
      .command(
        "stats",
        "Show token usage and cost statistics",
        (y) =>
          hideUnsupportedGlobals(y)
            .option("days", { type: "number", describe: "Show stats for the last N days (default: all time)" })
            .option("tools", { type: "number", describe: "Number of top tools to show (default: all)" })
            .example("cz-cli agent stats", "Show all-time usage")
            .example("cz-cli agent stats --days 7", "Show last 7 days")
            .example("cz-cli agent stats --days 30 --tools 10", "Last 30 days, top 10 tools"),
        () => {},
      )
      .command(
        "llm",
        "Manage agent LLMs in ~/.clickzetta/llm.json, separate from ClickZetta Lakehouse profile setup",
        (y) => hideUnsupportedGlobals(y)
          .command("show", "Show LLM configuration and which model is used by default", (llm) => llm, () => {})
          .command("list", "List all configured agent LLM entries", (llm) => llm, () => {})
          .command(
            "add <name>",
            "Add or update an agent LLM entry",
            (llm) =>
              llm
                .positional("name", { type: "string", describe: "entry name, e.g. my-openai", demandOption: true })
                .option("provider", {
                  type: "string",
                  describe: "provider: clickzetta, anthropic, openai, openai-compatible, bedrock, google, azure, openrouter",
                })
                .option("api-key", { type: "string", describe: "API key for the provider" })
                .option("base-url", { type: "string", describe: "Base URL for openai-compatible relays and custom gateways" })
                .option("known-model", {
                  type: "string",
                  describe: "Declare a model available on this entry; does not set the default model",
                }),
            () => {},
          )
          .command(
            "test [name]",
            "Probe an LLM entry's API connectivity",
            (llm) => llm.positional("name", { type: "string", describe: "entry name; defaults to the default model's entry (or the only one)" }),
            () => {},
          )
          .command("models [provider]", "List available models for a configured LLM entry", (llm) => llm.positional("provider", { type: "string", describe: "configured LLM entry name" }), () => {})
          .command(
            "use <model>",
            "Set the default model (writes config.model), format <entry>/<modelId>",
            (llm) => llm.positional("model", {
              type: "string",
              describe: "full model ref, e.g. my-openai/gpt-4o or clickzetta/deepseek/deepseek-v4-pro",
              demandOption: true,
            }),
            () => {},
          )
          .command("remove <name>", "Remove an agent LLM entry", (llm) => llm.positional("name", { type: "string", demandOption: true }), () => {})
          .command("reset", "Clear the default model", (llm) => llm, () => {})
          .command("purge-legacy", "Remove deprecated llm_* fields from [profiles.*]", (llm) => llm, () => {})
          .strict(false)
          .demandCommand(1, "Run `cz-cli agent llm --help` to see available subcommands")
          .example("cz-cli auth login <name> --credential <base64_string>", "New environment: sign in and configure ClickZetta built-in LLM from registration credential")
          .example("cz-cli agent llm add my-openai --provider openai --api-key $OPENAI_API_KEY", "Register OpenAI")
          .example("cz-cli agent llm test my-openai", "Verify GPT / OpenAI-style API connectivity")
          .example("cz-cli agent llm models my-openai", "List models available to the registered entry")
          .example("cz-cli agent llm use my-openai/gpt-4.1", "Set the default model")
          .example("cz-cli agent llm show", "Show LLM configuration and the default model")
          .epilogue(
            "LLM setup paths:\n" +
            "  ClickZetta built-in LLM:\n" +
            "    `cz-cli auth login <name> --credential <base64_string>`\n\n" +
            "  External LLMs:\n" +
            "    `cz-cli agent llm add my-openai --provider openai --api-key <OPENAI_API_KEY>`\n" +
            "    `cz-cli agent llm add my-relay --provider openai-compatible --base-url https://your-gateway.example.com/v1 --api-key <API_KEY>`\n\n" +
            "  Optional checks after registration:\n" +
            "    `cz-cli agent llm test <name>`\n" +
            "    `cz-cli agent llm models <name>`\n\n" +
            "  Optional default model (otherwise OpenCode selects automatically):\n" +
            "    `cz-cli agent llm use <name>/<MODEL_ID>`\n\n" +
            "  ClickZetta Lakehouse sign-in is separate:\n" +
            "    `cz-cli auth login <name>`  (see `cz-cli auth login --help` for all methods)",
          ),
        () => {},
      )
      .strictCommands().strictOptions().demandCommand(1, "Missing subcommand for 'agent'. Available: run, session, export, stats, llm")
      .example("cz-cli agent run \"create a daily sync task\"", "One-shot (scripts, CI)")
      .example("cz-cli agent --profile staging", "Open the interactive agent/TUI with the staging ClickZetta profile")
      .example("cz-cli agent run \"describe sales\" --session s1", "Conversational (reuse context)")
      .example("cz-cli agent run \"more details\" --continue", "Continue last session")
      .example("cz-cli agent session list", "List all sessions")
      .example("cz-cli agent session list -n 10 --format json", "Recent sessions as JSON")
      .example("cz-cli agent session delete <sessionID>", "Delete a session")
      .example("cz-cli agent session status <sessionID>", "Check if session is idle/busy (one-shot snapshot)")
      .example("cz-cli agent session status <sessionID> --wait", "Block until idle or timeout, streaming deduplicated NDJSON progress")
      .example("cz-cli agent run \"analyze\" --async", "Async submit, returns session_id immediately")
      .example("cz-cli agent export <sessionID>", "Export session as JSON")
      .example("cz-cli agent stats --days 7", "Token usage for last 7 days")
      .example("cz-cli agent llm --help", "See LLM onboarding, examples, and testing commands")
      .epilogue(
        "Profile selection:\n" +
        "  `--profile <name>` overrides `default_profile` from ~/.clickzetta/profiles.toml for the launched agent session.\n" +
        "  Use it with either `cz-cli agent --profile <name>` for the interactive TUI or `cz-cli agent run ... --profile <name>` for one-shot runs.",
      )
      .strict(false),
  )
}
