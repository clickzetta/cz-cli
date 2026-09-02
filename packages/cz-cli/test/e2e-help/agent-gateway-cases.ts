import type { HelpCase } from "../e2e-help-runner.ts"

export const agentGatewayHelpCases: HelpCase[] = [
  // agent (top-level description only — agent subcommands are executed by the internal runtime)
  {
    args: ["agent", "--help"],
    expectHeader: "cz-cli agent",
    expectCommands: ["run", "session", "export", "stats", "llm"],
  },
  {
    args: ["agent", "run", "--help"],
    expectHeader: "cz-cli agent run",
    expectOptions: ["--format", "--session", "--timeout", "--dangerously-skip-permissions", "--continue", "--model", "--file"],
  },
  {
    args: ["agent", "session", "--help"],
    expectHeader: "cz-cli agent session",
    expectCommands: ["list", "delete"],
  },
  {
    args: ["agent", "session", "list", "--help"],
    expectHeader: "cz-cli agent session list",
    expectOptions: ["--max-count", "--format"],
  },
  {
    args: ["agent", "session", "delete", "--help"],
    expectHeader: "cz-cli agent session delete",
    expectOptions: ["sessionID"],
  },
  {
    args: ["analytics-agent", "session", "--help"],
    expectHeader: "cz-cli analytics-agent session",
    expectCommands: ["list", "create", "delete", "run", "result", "stop"],
  },
  {
    args: ["analytics-agent", "session", "delete", "--help"],
    expectHeader: "cz-cli analytics-agent session delete",
    expectOptions: ["--session-id"],
    expectCommands: ["Delete a text2insight session by session ID"],
  },
  {
    args: ["agent", "session", "status", "--help"],
    expectHeader: "cz-cli agent session status",
    expectOptions: ["sessionID", "--wait", "timeout"],
  },
  {
    args: ["agent", "export", "--help"],
    expectHeader: "cz-cli agent export",
    expectOptions: ["sessionID", "--sanitize"],
  },
  {
    args: ["agent", "stats", "--help"],
    expectHeader: "cz-cli agent stats",
    expectOptions: ["--days", "--tools"],
  },
  {
    args: ["agent", "llm", "--help"],
    expectHeader: "cz-cli agent llm",
    expectCommands: ["show", "list", "add", "test", "models", "use", "remove", "reset"],
    forbid: ["--use"],
  },
  {
    args: ["agent", "llm", "add", "--help"],
    expectHeader: "cz-cli agent llm add <name>",
    expectOptions: ["--provider", "--api-key", "--base-url", "--known-model", "Declare a model available on this entry"],
    forbid: ["--model", "--use"],
  },
  {
    args: ["agent", "llm", "test", "--help"],
    expectHeader: "cz-cli agent llm test [name]",
    expectOptions: ["default model's entry (or the only one)"],
  },
  {
    args: ["agent", "llm", "use", "--help"],
    expectHeader: "cz-cli agent llm use <model>",
    expectOptions: ["full model ref", "my-openai/gpt-4o"],
  },
  {
    args: ["agent", "llm", "reset", "--help"],
    expectHeader: "cz-cli agent llm reset",
    forbid: ["OpenCode selects automatically"],
  },

  // AIGW
  {
    args: ["ai-gateway", "--help"],
    expectHeader: "cz-cli ai-gateway",
    expectCommands: ["quota", "key", "model"],
  },
  {
    args: ["ai-gateway", "quota", "--help"],
    expectHeader: "cz-cli ai-gateway quota",
    expectOptions: ["--model"],
    // Prose from the epilogue, not a subcommand — `quota` has none.
    expectText: ["x-czgw-ratelimit-api-key-token-*"],
  },
  {
    args: ["ai-gateway", "key", "--help"],
    expectHeader: "cz-cli ai-gateway key",
    expectCommands: ["list", "create", "upsert", "get", "set-quota", "enable", "disable", "delete"],
  },
  {
    args: ["ai-gateway", "key", "create", "--help"],
    expectHeader: "cz-cli ai-gateway key create",
    expectOptions: ["--period", "--quota", "--route-type", "--add-to-llm"],
    expectCommands: ["Examples:", "cz-cli ai-gateway key create my-key"],
    forbid: ["cz-cli gateway key create", "--add-to-llm my-key --use", "Select the registered config as the active agent LLM"],
  },
  {
    args: ["ai-gateway", "model", "--help"],
    expectHeader: "cz-cli ai-gateway model",
    expectCommands: ["list"],
  },
  {
    args: ["ai-gateway", "model", "list", "--help"],
    expectHeader: "cz-cli ai-gateway model list",
    expectOptions: ["key", "--page", "--page-size", "--limit", "--no-limit"],
  },

  // setup
  {
    args: ["setup", "--help"],
    expectHeader: "cz-cli setup",
    expectOptions: ["--credential"],
  },
]
