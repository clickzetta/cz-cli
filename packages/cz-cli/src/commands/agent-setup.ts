import type { CommandModule } from "yargs"
import { createCli } from "../cli.js"
import { registerSetupCommand } from "./setup.js"

export const SetupCommand: CommandModule = {
  command: "setup",
  describe: "configure a ClickZetta or Singdata profile from a login page or JDBC connection string",
  builder: (yargs) =>
    yargs
      .usage("cz-cli setup")
      .option("credential", {
        type: "string",
        describe: "base64-encoded registration credential (compatibility path)",
      })
      .option("profile-name", {
        type: "string",
        describe: "profile name to write (default: 'default')",
        default: "default",
      })
      .example("cz-cli setup --login-method clickzetta", "start the ClickZetta login flow")
      .example("cz-cli setup --login-method custom --login <LOGIN_URL_OR_JDBC>", "use a custom login page URL or JDBC connection string")
      .example("cz-cli setup", "interactive setup (TTY only)"),
  handler: async (args) => {
    const argv: string[] = []
    if (typeof args.credential === "string") argv.push("--credential", args.credential)
    if (typeof args["profile-name"] === "string" && args["profile-name"] !== "default") {
      argv.push("--profile-name", args["profile-name"])
    }
    await runSetup(argv)
  },
}

export async function runSetup(args: readonly string[]): Promise<never> {
  const normalized = args.map((arg) => arg === "--profile-name" ? "--name" : arg)
  const cli = createCli(["setup", ...normalized])
  registerSetupCommand(cli)
  await cli.demandCommand(1, "").help().parseAsync()
  process.exit(process.exitCode ?? 0)
}
