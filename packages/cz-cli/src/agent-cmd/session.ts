import type { Argv } from "yargs"
import { cmd } from "opencode/cli/cmd/cmd"
import { SessionListCommand, SessionDeleteCommand } from "opencode/cli/cmd/session"
import { SessionStatusCommand } from "./session-status.js"
import { commandGroup } from "../command-group.js"

/**
 * cz-cli-owned `agent session` command tree.
 *
 * The command *definition* lives here (not in opencode) so cz-cli can extend
 * flags/subcommands freely; the runtime host still executes it. `list`/`delete`
 * are reused verbatim from upstream opencode; `status` is the cz addition that
 * the a2 rebase-to-pure-upstream dropped, reimplemented in `./session-status`.
 */
export const SessionCommand = cmd({
  command: "session",
  describe: "manage sessions",
  builder: (yargs: Argv) =>
    commandGroup(
      yargs.command(SessionListCommand).command(SessionDeleteCommand).command(SessionStatusCommand),
      "agent session",
    ),
  async handler() {},
})
