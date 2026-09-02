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
    args: ["analytics-agent", "datasource", "browse", "--help"],
    expectHeader: "cz-cli analytics-agent datasource browse",
    expectOptions: ["--path"],
    expectCommands: ["Examples:", "--path workspace:default/schema:public", "如果当前工作区是 default、schema 是 public，就这样写。"],
  },
  {
    args: ["analytics-agent", "datasource", "load", "--help"],
    expectHeader: "cz-cli analytics-agent datasource load",
    expectOptions: ["--path", "--domain-ids"],
    expectCommands: [
      "Examples:",
      "cz-cli analytics-agent datasource load 3 --path",
      "workspace:default/schema:public/table:orders --domain-ids '[5]'",
      "workspace:default/schema:public/table:orders --domain-ids '[5,6]'",
      "--domain-ids '[5]'",
      "--domain-ids '[5,6]'",
      "如果当前工作区是 default、schema 是 public、表名是",
      "只导入一个域，就这样写。",
      "要导入多个域，就这样写。",
    ],
  },
  {
    args: ["analytics-agent", "domain", "create", "--help"],
    expectHeader: "cz-cli analytics-agent domain create",
    expectOptions: ["--sample-questions"],
    expectCommands: ["Examples:", "--sample-questions '[\"Q1\"]'"],
  },
  {
    args: ["analytics-agent", "domain", "update", "--help"],
    expectHeader: "cz-cli analytics-agent domain update",
    expectOptions: ["--sample-questions"],
    expectCommands: ["Examples:", "--sample-questions '[\"Q1\"]'"],
  },
  {
    args: ["analytics-agent", "domain", "table", "add", "--help"],
    expectHeader: "cz-cli analytics-agent domain table add",
    expectOptions: ["--path", "--table-name"],
    expectCommands: ["Examples:", "--path workspace:default/schema:public/table:orders", "如果当前工作区是 default、schema 是 public、表名是 orders，就这样写。"],
  },
  {
    args: ["analytics-agent", "metric", "list", "--help"],
    expectHeader: "cz-cli analytics-agent metric list",
    expectOptions: ["--domain-ids", "--body"],
    expectCommands: ["Examples:", "--domain-ids '[5]'", "--domain-ids '[5,6]'", "如果只查一个域，就这样写。", "如果要同时查多个域，就这样写。"],
  },
  {
    args: ["analytics-agent", "metric", "create", "--help"],
    expectHeader: "cz-cli analytics-agent metric create",
    expectOptions: ["--domain-ids", "--datasource-id", "--expression"],
    expectCommands: ["Examples:", "--domain-ids '[5]'", "--domain-ids '[5,6]'", "如果只创建到一个域，就这样写。", "如果要同时绑定多个域，就这样写。"],
  },
  {
    args: ["analytics-agent", "metric", "update", "--help"],
    expectHeader: "cz-cli analytics-agent metric update",
    expectOptions: ["--domain-ids", "--datasource-id", "--expression"],
    expectCommands: ["Examples:", "--domain-ids '[5]'", "--domain-ids '[5,6]'", "如果只更新一个域，就这样写。", "如果要同时更新多个域，就这样写。"],
  },
  {
    args: ["analytics-agent", "metric", "validate", "--help"],
    expectHeader: "cz-cli analytics-agent metric validate",
    expectOptions: ["--domain-ids", "--datasource-id", "--expression"],
    expectCommands: ["Examples:", "--domain-ids '[5]'", "--domain-ids '[5,6]'", "如果只校验一个域，就这样写。", "如果要同时校验多个域，就这样写。"],
  },
  {
    args: ["analytics-agent", "answer-builder", "create", "--help"],
    expectHeader: "cz-cli analytics-agent answer-builder create",
    expectOptions: ["--domain-ids", "--analysis-name", "--datasource-id"],
    expectCommands: ["Examples:", "--domain-ids '[5]'", "--domain-ids '[5,6]'", "如果只创建到一个域，就这样写。", "如果要同时创建到多个域，就这样写。"],
  },
  {
    args: ["analytics-agent", "answer-builder", "update", "--help"],
    expectHeader: "cz-cli analytics-agent answer-builder update",
    expectOptions: ["--domain-ids", "--analysis-name", "--datasource-id"],
    expectCommands: ["Examples:", "--analysis-name total-sales", "--domain-ids '[5,6]'", "如果只更新一个域，就这样写。", "如果要同时更新多个域，就这样写。"],
  },
  {
    args: ["analytics-agent", "answer-builder", "list", "--help"],
    expectHeader: "cz-cli analytics-agent answer-builder list",
    expectOptions: ["--domain-ids", "--body"],
    expectCommands: ["Examples:", "--domain-ids '[5]'", "--domain-ids '[5,6]'", "如果只查一个域，就这样写。", "如果要同时查多个域，就这样写。"],
  },
  {
    args: ["analytics-agent", "answer-builder", "validate", "--help"],
    expectHeader: "cz-cli analytics-agent answer-builder validate",
    expectOptions: ["--domain-ids", "--analysis-name", "--datasource-id"],
    expectCommands: ["Examples:", "--analysis-name total-sales", "--domain-ids '[5,6]'", "如果只校验一个域，就这样写。", "如果要同时校验多个域，就这样写。"],
  },
  {
    args: ["analytics-agent", "knowledge", "create", "--help"],
    expectHeader: "cz-cli analytics-agent knowledge create",
    expectOptions: ["--domain-ids", "--content"],
    expectCommands: ["Examples:", "--domain-ids '[5]' --content \"hello\"", "--domain-ids '[5,6]' --content \"hello\"", "如果只绑定一个域，就这样写。", "如果要同时绑定多个域，就这样写。"],
  },
  {
    args: ["analytics-agent", "knowledge", "update", "--help"],
    expectHeader: "cz-cli analytics-agent knowledge update",
    expectOptions: ["--domain-ids", "--content"],
    expectCommands: ["Examples:", "42 --domain-ids '[5]' --content", "42 --domain-ids '[5,6]' --content", "如果只绑定一个域，就这样写。", "如果要同时绑定多个域，就这样写。"],
  },
  {
    args: ["analytics-agent", "knowledge", "file", "upload", "--help"],
    expectHeader: "cz-cli analytics-agent knowledge file upload",
    expectOptions: ["--domain-ids", "--target-path", "--name"],
    expectCommands: ["Examples:", "1 ./a.txt --domain-ids '[5]'", "1 ./a.txt --domain-ids '[5,6]'", "如果只绑定一个域，就这样写。", "如果要同时绑定多个域，就这样写。"],
  },
  {
    args: ["analytics-agent", "session", "create", "--help"],
    expectHeader: "cz-cli analytics-agent session create",
    expectOptions: ["--domain-id", "--msg"],
    expectCommands: ["Examples:", "--domain-id 195 --msg \"Q1\""],
  },
  {
    args: ["analytics-agent", "session", "run", "--help"],
    expectHeader: "cz-cli analytics-agent session run",
    expectOptions: ["--domain-id", "--msg"],
    expectCommands: ["Examples:", "--domain-id 195 --msg \"Q1\"", "同一个 session 内的问答必须串行"],
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
