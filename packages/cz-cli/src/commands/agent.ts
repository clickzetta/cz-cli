import type { Argv } from "yargs"
import type { GlobalArgs } from "../cli.js"

export function registerAgentCommand(cli: Argv<GlobalArgs>): void {
  cli.command("agent", "AI agent — run sessions, configure LLMs, manage tasks (Lakehouse setup and LLM setup are separate)", (yargs) =>
    yargs
      .command(
        "run <prompt>",
        "Run AI agent with a natural-language prompt",
        (y) =>
          y
            .positional("prompt", { type: "string", demandOption: true, describe: "Natural-language request" })
            .option("session", { type: "string", describe: "Session ID for multi-turn conversations" })
            .option("format", { type: "string", choices: ["default", "json", "a2a"], describe: "Output format (default=formatted, json=raw JSON events, a2a=agent-to-agent structured)" })
            .option("dangerously-skip-permissions", { type: "boolean", describe: "Skip permission prompts (for CI/automation)" })
            .option("agent", { type: "string", describe: "Agent to use" })
            .example("cz-cli agent run \"show tables\"", "One-shot query")
            .example("cz-cli agent run \"describe sales\" --session my-session", "Multi-turn with session"),
        () => {
          // This handler is never reached — opencode kernel handles `agent run` directly.
          // This command definition exists only to provide correct --help output.
        },
      )
      .command(
        "llm",
        "Manage agent LLMs in ~/.clickzetta/profiles.toml ([llm.*], separate from ClickZetta Lakehouse profile setup)",
        (y) => y
          .command("show", "Show the active LLM, all defined entries, and setup guidance", (llm) => llm, () => {})
          .command("list", "List all configured [llm.*] entries", (llm) => llm, () => {})
          .command(
            "add <name>",
            "Add or update an [llm.<name>] entry",
            (llm) =>
              llm
                .positional("name", { type: "string", describe: "entry name, e.g. my-openai", demandOption: true })
                .option("provider", {
                  type: "string",
                  describe: "provider: clickzetta, anthropic, openai, openai-compatible, bedrock, google, azure, openrouter",
                })
                .option("api-key", { type: "string", describe: "API key for the provider" })
                .option("base-url", { type: "string", describe: "Base URL for openai-compatible relays and custom gateways" })
                .option("model", { type: "string", describe: "Optional model ID override" })
                .option("use", { type: "boolean", describe: "Set this entry as default_llm after writing" }),
            () => {},
          )
          .command(
            "test [name]",
            "Test the active or named LLM entry with a lightweight connectivity probe",
            (llm) => llm.positional("name", { type: "string", describe: "entry name; defaults to default_llm" }),
            () => {},
          )
          .command("use <name>", "Select which [llm.<name>] to use", (llm) => llm.positional("name", { type: "string", demandOption: true }), () => {})
          .command("remove <name>", "Remove an [llm.<name>] entry", (llm) => llm.positional("name", { type: "string", demandOption: true }), () => {})
          .command("reset", "Clear default_llm", (llm) => llm, () => {})
          .command("purge-legacy", "Remove deprecated llm_* fields from [profiles.*]", (llm) => llm, () => {})
          .strict(false)
          .demandCommand(1, "Run `cz-cli agent llm --help` to see available subcommands")
          .example("cz-cli setup --credential <base64_string>", "New environment: configure ClickZetta built-in LLM from registration credential")
          .example("cz-cli agent llm add my-openai --provider openai --api-key $OPENAI_API_KEY --use", "Add OpenAI and select it")
          .example("cz-cli agent llm add my-relay --provider openai-compatible --base-url https://your-gateway.example.com/v1 --api-key <API_KEY> --use", "Add an OpenAI-compatible relay")
          .example("cz-cli agent llm test my-openai", "Verify GPT / OpenAI-style API connectivity")
          .example("cz-cli agent llm show", "Show active LLM config and next steps")
          .epilogue(
            "LLM setup paths:\n" +
            "  ClickZetta built-in LLM:\n" +
            "    `cz-cli setup --credential <base64_string>`\n\n" +
            "  External LLMs:\n" +
            "    `cz-cli agent llm add my-openai --provider openai --api-key <OPENAI_API_KEY> --use`\n" +
            "    `cz-cli agent llm add my-relay --provider openai-compatible --base-url https://your-gateway.example.com/v1 --api-key <API_KEY> --use`\n\n" +
            "  Verify:\n" +
            "    `cz-cli agent llm test [name]`\n\n" +
            "  ClickZetta Lakehouse login / workspace / schema / vcluster setup is separate:\n" +
            "    `cz-cli setup`\n" +
            "    `cz-cli setup --username <username> --password <password> --account-name <account_name>`",
          ),
        () => {},
      )
      .strictCommands().strictOptions().demandCommand(1, "")
      .example("cz-cli agent run \"create a daily sync task\"", "One-shot (scripts, CI)")
      .example("cz-cli agent run \"describe sales\" --session s1", "Conversational (reuse context)")
      .example("cz-cli agent llm --help", "See LLM onboarding, examples, and testing commands")
      .strict(false),
  )
}
