import type { Argv } from "yargs"
import type { GlobalArgs } from "../cli.js"

export function registerAgentCommand(cli: Argv<GlobalArgs>): void {
  cli.command("agent", "AI agent — run sessions, configure LLM, manage tasks (run `cz-cli agent --help` for full command list)", (yargs) =>
    yargs
      .command(
        "run <prompt>",
        "Run AI agent with a natural-language prompt",
        (y) =>
          y
            .positional("prompt", { type: "string", demandOption: true, describe: "Natural-language request" })
            .option("session", { type: "string", describe: "Session ID for multi-turn conversations" })
            .option("format", { type: "string", choices: ["a2a", "text"], describe: "Output format (a2a for structured)" })
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
        "Manage LLM providers (add, remove, show, list)",
        (y) => y
          .example("cz-cli agent llm add my-claude --provider anthropic --api-key sk-ant-... --use", "Add Claude")
          .example("cz-cli agent llm show", "Show active LLM config")
          .example("cz-cli agent llm list", "List all configured LLMs"),
        () => {},
      )
      .demandCommand(1, "")
      .example("cz-cli agent run \"create a daily sync task\"", "One-shot (scripts, CI)")
      .example("cz-cli agent run \"describe sales\" --session s1", "Conversational (reuse context)")
      .strict(false),
  )
}
