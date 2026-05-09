import type { Argv } from "yargs"
import { createInterface } from "node:readline"
import type { GlobalArgs } from "../cli.js"
import { success, error } from "../output/index.js"
import { logOperation } from "../logger.js"
import { loadProfiles, saveProfiles, setTelemetry, type ProfileEntry } from "../connection/profile-store.js"

function askYesNo(question: string): Promise<boolean> {
  if (!process.stdin.isTTY) return Promise.resolve(true)
  const rl = createInterface({ input: process.stdin, output: process.stderr })
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close()
      resolve(answer.trim().toLowerCase() !== "n")
    })
  })
}

/**
 * Top-level `setup` command — entry point for first-time configuration.
 * Equivalent to Python's `cz-cli setup --credential <base64>`.
 */
export function registerSetupCommand(cli: Argv<GlobalArgs>): void {
  cli.command(
    "setup",
    "Interactive configuration wizard",
    (yargs) =>
      yargs
        .option("credential", { type: "string", describe: "Base64-encoded registration credential" })
        .option("name", { type: "string", default: "default", describe: "Profile name to create" })
        .option("skip-verify", { type: "boolean", default: false, describe: "Skip connection verification" }),
    async (argv) => {
      const format = argv.output
      const REGISTER_URLS = [
        "https://accounts.clickzetta.com/register?ref=cz-cli",
        "https://accounts.singdata.com/register?ref=cz-cli",
      ]
      if (!argv.credential) {
        error("NO_CREDENTIAL", "Setup requires --credential <base64_string>. Register at: " + REGISTER_URLS[0], {
          format,
          extra: { register_urls: REGISTER_URLS, next_step: "cz-cli setup --credential <YOUR_CREDENTIAL>" },
        })
      }
      let cred: Record<string, unknown>
      try {
        const decoded = Buffer.from(argv.credential as string, "base64").toString("utf-8")
        cred = JSON.parse(decoded) as Record<string, unknown>
      } catch (e) {
        error("INVALID_CREDENTIAL", `Invalid base64 or JSON: ${e instanceof Error ? e.message : String(e)}`, { format })
        return // unreachable but satisfies TS
      }
      const instanceName = cred.instanceName as string | undefined
      const accessToken = cred.accessToken as string | undefined
      if (!instanceName || !accessToken) {
        error("INVALID_CREDENTIAL", "Missing required fields: instanceName, accessToken", { format })
      }
      const profileName = argv.name as string
      const profiles = loadProfiles()
      if (profiles[profileName]) {
        error("PROFILE_EXISTS", `Profile '${profileName}' already exists. Use --name <other> or delete it first.`, { format })
      }
      const profileObj: ProfileEntry = {
        instance: instanceName!,
        workspace: (cred.workspaceName as string) ?? "default",
        schema: (cred.schema as string) ?? "public",
        vcluster: (cred.virtualCluster as string) ?? "default",
        pat: accessToken!,
        service: (cred.service as string) ?? "dev-api.clickzetta.com",
        protocol: (cred.protocol as string) ?? "https",
      }
      profiles[profileName] = profileObj
      saveProfiles(profiles)

      // Telemetry opt-in: ask user in TTY, default yes for non-interactive
      const telemetryEnabled = await askYesNo("Enable anonymous telemetry to help improve cz-cli? (Y/n) ")
      setTelemetry(telemetryEnabled)

      logOperation("setup", { ok: true })
      success({
        message: `Profile '${profileName}' created successfully.`,
        profile_name: profileName,
        instance: instanceName,
        workspace: profileObj.workspace,
        schema: profileObj.schema,
      }, { format })
    },
  )
}
