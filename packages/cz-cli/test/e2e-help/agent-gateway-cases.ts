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

  // AIGW
  {
    args: ["ai-gateway", "--help"],
    expectHeader: "cz-cli ai-gateway",
    expectCommands: ["key", "model"],
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
    forbid: ["cz-cli gateway key create"],
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
