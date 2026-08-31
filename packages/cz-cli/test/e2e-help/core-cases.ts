import type { HelpCase } from "../e2e-help-runner.ts"

export const coreHelpCases: HelpCase[] = [
  // Top-level
  {
    args: ["--help"],
    expectHeader: "cz-cli",
    expectCommands: ["sql", "schema", "table", "workspace", "status", "profile", "task", "runs", "attempts", "agent", "job", "setup", "fs"],
  },
  {
    args: [],
    expectHeader: "cz-cli",
    expectCommands: ["sql", "schema", "table", "workspace", "status", "profile"],
  },

  // sql
  {
    args: ["sql", "--help"],
    expectHeader: "cz-cli sql",
    expectCommands: ["status"],
    expectOptions: ["--sync", "--write", "--limit", "--batch"],
  },
  {
    args: ["sql", "status", "--help"],
    expectHeader: "cz-cli sql status",
    expectOptions: ["job-id"],
  },

  // schema
  {
    args: ["schema", "--help"],
    expectHeader: "cz-cli schema",
    expectCommands: ["list", "describe", "create", "drop"],
  },
  {
    args: ["schema", "list", "--help"],
    expectHeader: "cz-cli schema list",
    expectOptions: ["--like", "--limit"],
  },
  {
    args: ["schema", "describe", "--help"],
    expectHeader: "cz-cli schema describe",
    expectOptions: ["name"],
  },

  {
    args: ["schema", "create", "--help"],
    expectHeader: "cz-cli schema create",
    expectOptions: ["name"],
  },
  {
    args: ["schema", "drop", "--help"],
    expectHeader: "cz-cli schema drop",
    expectOptions: ["name"],
  },

  // table
  {
    args: ["table", "--help"],
    expectHeader: "cz-cli table",
    expectCommands: ["list", "describe", "preview", "stats", "history", "create", "drop"],
  },
  {
    args: ["table", "list", "--help"],
    expectHeader: "cz-cli table list",
    expectOptions: ["--in", "--like", "--limit"],
  },
  {
    args: ["table", "describe", "--help"],
    expectHeader: "cz-cli table describe",
    expectOptions: ["name"],
  },
  {
    args: ["table", "preview", "--help"],
    expectHeader: "cz-cli table preview",
    expectOptions: ["name", "--limit"],
  },
  {
    args: ["table", "stats", "--help"],
    expectHeader: "cz-cli table stats",
    expectOptions: ["name"],
  },
  {
    args: ["table", "history", "--help"],
    expectHeader: "cz-cli table history",
    expectOptions: ["--in", "--like"],
  },
  {
    args: ["table", "create", "--help"],
    expectHeader: "cz-cli table create",
    expectOptions: ["--from-file"],
  },
  {
    args: ["table", "drop", "--help"],
    expectHeader: "cz-cli table drop",
    expectOptions: ["name"],
  },

  // workspace
  {
    args: ["workspace", "--help"],
    expectHeader: "cz-cli workspace",
    expectCommands: ["list", "current", "use"],
  },
  {
    args: ["workspace", "list", "--help"],
    expectHeader: "cz-cli workspace list",
  },
  {
    args: ["workspace", "current", "--help"],
    expectHeader: "cz-cli workspace current",
  },
  {
    args: ["workspace", "use", "--help"],
    expectHeader: "cz-cli workspace use",
    expectOptions: ["name", "--schema", "--persist"],
  },

  // workspace-param
  {
    args: ["workspace-param", "--help"],
    expectHeader: "cz-cli workspace-param",
    expectCommands: ["list", "add", "update", "enable", "disable", "delete"],
  },
  {
    args: ["workspace-param", "list", "--help"],
    expectHeader: "cz-cli workspace-param list",
    expectOptions: ["--project-id", "--page-index", "--page-size"],
  },
  {
    args: ["workspace-param", "add", "--help"],
    expectHeader: "cz-cli workspace-param add",
    expectOptions: ["--project-id", "--key", "--value", "--source-type", "--encrypt"],
  },
  {
    args: ["workspace-param", "update", "--help"],
    expectHeader: "cz-cli workspace-param update",
    expectOptions: ["--project-id", "--id", "--key", "--value", "--source-type", "--encrypt"],
  },
  {
    args: ["workspace-param", "enable", "--help"],
    expectHeader: "cz-cli workspace-param enable",
    expectOptions: ["--project-id", "--id"],
  },
  {
    args: ["workspace-param", "disable", "--help"],
    expectHeader: "cz-cli workspace-param disable",
    expectOptions: ["--project-id", "--id"],
  },
  {
    args: ["workspace-param", "delete", "--help"],
    expectHeader: "cz-cli workspace-param delete",
    expectOptions: ["--project-id", "--id"],
  },

  // status
  {
    args: ["status", "--help"],
    expectHeader: "cz-cli status",
    expectOptions: ["--profile"],
  },

  // filesystem
  {
    args: ["fs", "--help"],
    expectHeader: "cz-cli fs",
    expectCommands: ["ls", "head", "mb", "rb", "mkdir", "cp", "mv", "rm"],
    expectOptions: ["czfs:/Volumes/<workspace>/<schema>/<volume>/", "@user", "@table", "Root metadata queries", "Table Volumes are created automatically"],
    forbid: ["volume://"],
  },
  {
    args: ["fs", "ls", "--help"],
    expectHeader: "cz-cli fs ls",
    expectOptions: ["path", "--recursive", "--limit", "czfs:/", "@table", "@user"],
    forbid: ["volume://"],
  },
  {
    args: ["fs", "head", "--help"],
    expectHeader: "cz-cli fs head",
    expectOptions: ["file", "--bytes", "czfs:/Volumes/@user/your_workspace/your_user/demo.csv"],
    forbid: ["-c, --bytes"],
  },
  {
    args: ["fs", "mb", "--help"],
    expectHeader: "cz-cli fs mb",
    expectOptions: ["volume", "czfs:/Volumes/your_workspace/your_schema/your_volume", "cannot create User or Table Volumes"],
  },
  {
    args: ["fs", "rb", "--help"],
    expectHeader: "cz-cli fs rb",
    expectOptions: ["volume", "czfs:/Volumes/your_workspace/your_schema/your_volume", "empty Named Volume"],
  },
  {
    args: ["fs", "mkdir", "--help"],
    expectHeader: "cz-cli fs mkdir",
    expectOptions: ["path", "existing Volume", "@table", "@user"],
  },
  {
    args: ["fs", "cp", "--help"],
    expectHeader: "cz-cli fs cp",
    expectOptions: ["source", "destination", "--recursive", "--overwrite", "your_workspace", "Existing targets are refused"],
  },
  {
    args: ["fs", "mv", "--help"],
    expectHeader: "cz-cli fs mv",
    expectOptions: ["source", "destination", "--recursive", "--overwrite", "your_workspace", "Existing targets are refused"],
  },
  {
    args: ["fs", "rm", "--help"],
    expectHeader: "cz-cli fs rm",
    expectOptions: ["path", "--recursive", "--force", "--dry-run", "your_workspace", "Deletion is permanent"],
  },
  {
    args: ["table", "load", "--help"],
    expectHeader: "cz-cli table load",
    expectOptions: ["name", "source", "--using", "--header", "czfs:/Volumes/ws/sc/v/", "@user", "@table", "COPY INTO ..."],
  },
]
