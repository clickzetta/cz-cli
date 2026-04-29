import type { Argv } from "yargs"
import { UI } from "../ui"
import * as prompts from "@clack/prompts"

export const UpgradeCommand = {
  command: "upgrade [target]",
  describe: "upgrade czcli to the latest or a specific version",
  builder: (yargs: Argv) => {
    return yargs.positional("target", {
      describe: "version to upgrade to, for ex '0.1.48' or 'v0.1.48'",
      type: "string",
    })
  },
  handler: async (_args: { target?: string }) => {
    UI.empty()
    UI.println("  " + UI.Style.TEXT_INFO_BOLD + "◆ CZAgent" + UI.Style.TEXT_NORMAL)
    UI.empty()
    prompts.intro("Upgrade")
    // TODO: implement czcli self-upgrade via GitHub Releases (clickzetta/cz-code)
    prompts.log.warn("In-place upgrade is not yet supported. Please download the latest release from GitHub.")
    prompts.outro("Done")
  },
}
