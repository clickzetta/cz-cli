import type { HelpCase } from "../e2e-help-runner.ts"

export const runsTaskHelpCases: HelpCase[] = [
  // runs
  {
    args: ["runs", "--help"],
    expectHeader: "cz-cli runs",
    expectCommands: ["list", "detail", "wait", "logs", "deps", "stop", "refill", "rerun", "stats"],
  },
  {
    args: ["runs", "list", "--help"],
    expectHeader: "cz-cli runs list",
    expectOptions: ["--task", "--status", "--run-type", "--from", "--to"],
  },
  {
    args: ["runs", "detail", "--help"],
    expectHeader: "cz-cli runs detail",
    expectOptions: ["id"],
  },
  {
    args: ["runs", "wait", "--help"],
    expectHeader: "cz-cli runs wait",
    expectOptions: ["--attempts", "--interval", "--allow-timeout"],
  },
  {
    args: ["runs", "logs", "--help"],
    expectHeader: "cz-cli runs logs",
    expectOptions: ["id"],
  },
  {
    args: ["runs", "deps", "--help"],
    expectHeader: "cz-cli runs deps",
    expectOptions: ["id", "--parent-level", "--child-level"],
  },
  {
    args: ["runs", "stop", "--help"],
    expectHeader: "cz-cli runs stop",
    expectOptions: ["id", "--yes"],
  },
  {
    args: ["runs", "refill", "--help"],
    expectHeader: "cz-cli runs refill",
    expectOptions: ["task", "--from", "--to", "--yes"],
  },
  {
    args: ["runs", "rerun", "--help"],
    expectHeader: "cz-cli runs rerun",
    expectOptions: ["id"],
  },
  {
    args: ["runs", "stats", "--help"],
    expectHeader: "cz-cli runs stats",
    expectOptions: ["--task", "--from", "--to"],
  },

  // attempts
  {
    args: ["attempts", "--help"],
    expectHeader: "cz-cli attempts",
    expectCommands: ["list", "log"],
  },
  {
    args: ["attempts", "list", "--help"],
    expectHeader: "cz-cli attempts list",
    expectOptions: ["--run-id", "--task-id", "--page"],
  },
  {
    args: ["attempts", "log", "--help"],
    expectHeader: "cz-cli attempts log",
    expectOptions: ["--run-id", "--task-id", "--attempt-id"],
  },

  // task
  {
    args: ["task", "--help"],
    expectHeader: "cz-cli task",
    expectCommands: ["list", "create", "content", "save-content", "save-config", "lineage", "online", "offline", "execute", "delete"],
  },
  {
    args: ["task", "list", "--help"],
    expectHeader: "cz-cli task list",
    expectOptions: ["--like", "--type", "CONDITION"],
  },
  {
    args: ["task", "list-folders", "--help"],
    expectHeader: "cz-cli task list-folders",
  },
  {
    args: ["task", "create", "--help"],
    expectHeader: "cz-cli task create",
    expectOptions: ["name", "--type", "CONDITION"],
  },
  {
    args: ["task", "create-folder", "--help"],
    expectHeader: "cz-cli task create-folder",
    expectOptions: ["name"],
  },
  {
    args: ["task", "content", "--help"],
    expectHeader: "cz-cli task content",
    expectOptions: ["task"],
  },
  {
    args: ["task", "save-content", "--help"],
    expectHeader: "cz-cli task save-content",
    expectOptions: ["task", "--content", "--file"],
  },
  {
    args: ["task", "save-config", "--help"],
    expectHeader: "cz-cli task save-config",
    expectOptions: ["task", "--vc", "--retry-count", "--auto-lineage", "--outputs", "--output-tables"],
  },
  {
    args: ["task", "save-merge", "--help"],
    expectHeader: "cz-cli task save-merge",
    expectOptions: ["task", "--dependency", "--status", "SKIPPED"],
  },
  {
    args: ["task", "save-cron", "--help"],
    expectHeader: "cz-cli task save-cron",
    expectOptions: ["task", "--cron", "--auto-lineage", "--outputs", "--output-tables"],
  },
  {
    args: ["task", "lineage", "--help"],
    expectHeader: "cz-cli task lineage",
    expectOptions: ["task", "Task name or ID", "--schema", "--content", "--file"],
  },
  {
    args: ["task", "deps", "--help"],
    expectHeader: "cz-cli task deps",
    expectOptions: ["task"],
  },
  {
    args: ["task", "online", "--help"],
    expectHeader: "cz-cli task deploy",
    expectOptions: ["task", "--yes"],
  },
  {
    args: ["task", "offline", "--help"],
    expectHeader: "cz-cli task undeploy",
    expectOptions: ["task", "--yes", "--with-downstream"],
  },
  {
    args: ["task", "execute", "--help"],
    expectHeader: "cz-cli task execute",
    expectOptions: ["task", "--vc", "--content"],
  },
  {
    args: ["task", "flow", "--help"],
    expectHeader: "cz-cli task flow",
    expectCommands: ["dag", "create-node", "remove-node", "bind", "unbind", "node-detail", "node-save", "submit", "instances"],
  },
  {
    args: ["task", "flow", "dag", "--help"],
    expectHeader: "cz-cli task flow dag",
    expectOptions: ["task"],
  },
  {
    args: ["task", "flow", "create-node", "--help"],
    expectHeader: "cz-cli task flow create-node",
    expectOptions: ["task", "--name", "--type"],
  },
  {
    args: ["task", "flow", "remove-node", "--help"],
    expectHeader: "cz-cli task flow remove-node",
    expectOptions: ["task"],
  },
  {
    args: ["task", "flow", "bind", "--help"],
    expectHeader: "cz-cli task flow bind",
    expectOptions: ["task", "--upstream", "--downstream"],
  },
  {
    args: ["task", "flow", "unbind", "--help"],
    expectHeader: "cz-cli task flow unbind",
    expectOptions: ["task"],
  },
  {
    args: ["task", "flow", "node-detail", "--help"],
    expectHeader: "cz-cli task flow node-detail",
    expectOptions: ["task"],
  },
  {
    args: ["task", "flow", "node-save", "--help"],
    expectHeader: "cz-cli task flow node-save",
    expectOptions: ["task", "--content"],
  },
  {
    args: ["task", "flow", "node-save-config", "--help"],
    expectHeader: "cz-cli task flow node-save-config",
    expectOptions: ["task", "--cron"],
  },
  {
    args: ["task", "flow", "submit", "--help"],
    expectHeader: "cz-cli task flow submit",
    expectOptions: ["task"],
  },
  {
    args: ["task", "flow", "instances", "--help"],
    expectHeader: "cz-cli task flow instances",
    expectOptions: ["task", "--instance"],
  },
  {
    args: ["task", "delete-folder", "--help"],
    expectHeader: "cz-cli task delete-folder",
    expectOptions: ["folder", "--yes"],
  },
  {
    args: ["task", "delete", "--help"],
    expectHeader: "cz-cli task delete",
    expectOptions: ["task", "--yes"],
  },
]
