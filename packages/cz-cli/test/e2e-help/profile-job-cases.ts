import type { HelpCase } from "../e2e-help-runner.ts"

export const profileJobHelpCases: HelpCase[] = [
  // profile
  {
    args: ["profile", "--help"],
    expectHeader: "cz-cli profile",
    expectCommands: ["list", "detail", "create", "update", "delete", "use"],
  },
  {
    args: ["profile", "list", "--help"],
    expectHeader: "cz-cli profile list",
    expectOptions: ["--show-secret"],
  },
  {
    args: ["profile", "detail", "--help"],
    expectHeader: "cz-cli profile detail",
    expectOptions: ["name"],
  },
  {
    args: ["profile", "create", "--help"],
    expectHeader: "cz-cli profile create",
    expectOptions: ["name", "--pat", "--instance", "--workspace"],
  },
  {
    args: ["profile", "update", "--help"],
    expectHeader: "cz-cli profile update",
    expectOptions: ["name", "key", "value", "pat"],
  },
  {
    args: ["profile", "delete", "--help"],
    expectHeader: "cz-cli profile delete",
    expectOptions: ["name"],
  },
  {
    args: ["profile", "use", "--help"],
    expectHeader: "cz-cli profile use",
    expectOptions: ["name"],
  },
  {
    args: ["profile", "status", "--help"],
    expectHeader: "cz-cli profile status",
  },
  {
    args: ["profile", "quickstart", "--help"],
    expectHeader: "cz-cli profile quickstart",
    expectOptions: ["--credential"],
  },
  {
    args: ["setup", "--help"],
    expectHeader: "cz-cli setup",
    expectOptions: ["--credential", "--login-method", "--login", "--account-name", "--username", "--password"],
    expectCommands: [
      "Choose a login method:",
      "ClickZetta - https://accounts.clickzetta.com/login",
      "Singdata  - https://accounts.singdata.com/login",
      "Custom URL - Enter a login page URL or paste a JDBC connection string",
      "JDBC example:",
    ],
  },

  // job
  {
    args: ["job", "--help"],
    expectHeader: "cz-cli job",
    expectCommands: ["status", "result", "profile"],
  },
  {
    args: ["job", "status", "--help"],
    expectHeader: "cz-cli job status",
    expectOptions: ["job-id"],
  },
  {
    args: ["job", "result", "--help"],
    expectHeader: "cz-cli job result",
    expectOptions: ["job-id", "--limit", "--timeout"],
  },
  {
    args: ["job", "profile", "--help"],
    expectHeader: "cz-cli job profile",
    expectOptions: ["job-id", "--raw", "--limit", "--path"],
  },
]
