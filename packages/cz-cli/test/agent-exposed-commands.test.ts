import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

/**
 * Locks the agent runtime's exposed command surface.
 *
 * run-cli.ts routes `agent <sub>` into the runtime only for
 * AGENT_RUNTIME_SUBCOMMANDS; anything else never reaches that parser. Upstream's
 * remaining command tree (acp, attach, generate, login, providers, upgrade,
 * uninstall, web, models, import, github, pr, plugin, db, debug) was registered
 * there anyway — unreachable modules loaded on every agent start, and a second,
 * hand-synced definition of "what cz exposes".
 *
 * These assertions read the source rather than importing runtime.ts, whose module
 * graph boots the whole agent stack (TUI, server, providers). A re-baseline that
 * re-adds an upstream command will fail here, which is the point: widening the
 * surface must be a deliberate edit to BOTH lists, not a merge artifact.
 */

const RUNTIME_SRC = readFileSync(join(import.meta.dir, "..", "src", "bootstrap", "runtime.ts"), "utf-8")
const RUN_CLI_SRC = readFileSync(join(import.meta.dir, "..", "src", "run-cli.ts"), "utf-8")

// Commands deliberately NOT exposed. Each is a real upstream export that used to
// be registered under `agent`.
const WITHHELD = [
  "AcpCommand",
  "AttachCommand",
  "GenerateCommand",
  "ConsoleCommand",
  "ProvidersCommand",
  "AgentCommand",
  "UpgradeCommand",
  "UninstallCommand",
  "WebCommand",
  "ModelsCommand",
  "ImportCommand",
  "GithubCommand",
  "PrCommand",
  "PluginCommand",
  "DbCommand",
  "DebugCommand",
]

const EXPOSED = [
  "McpCommand",
  "TuiThreadCommand",
  "RunCommand",
  "AgentLlmCommand",
  "ServeCommand",
  "StatsCommand",
  "ExportCommand",
  "SessionCommand",
  "SetupCommand",
]

describe("agent runtime exposed command surface", () => {
  for (const name of WITHHELD) {
    test(`does not register ${name}`, () => {
      expect(RUNTIME_SRC).not.toInclude(`.command(${name})`)
    })
  }

  for (const name of EXPOSED) {
    test(`registers ${name}`, () => {
      expect(RUNTIME_SRC).toInclude(`.command(${name})`)
    })
  }

  // Every withheld command must also be free of its eager import: the import is
  // where the ~140ms of unreachable module loading actually came from.
  test("imports no withheld upstream command module", () => {
    const withheldModules = [
      "cli/cmd/acp",
      "cli/cmd/attach",
      "cli/cmd/generate",
      "cli/cmd/account",
      "cli/cmd/providers",
      "cli/cmd/agent",
      "cli/cmd/upgrade",
      "cli/cmd/uninstall",
      "cli/cmd/web",
      "cli/cmd/models",
      "cli/cmd/import",
      "cli/cmd/github",
      "cli/cmd/pr",
      "cli/cmd/plug",
      "cli/cmd/db",
      "cli/cmd/debug/index",
    ]
    const leaked = withheldModules.filter((m) => RUNTIME_SRC.includes(`"opencode/${m}"`))
    expect(leaked).toEqual([])
  })

  // The registered set and the routing whitelist are two halves of one decision.
  // If they drift, `agent <sub>` either 404s on a registered command or routes to
  // a command that is not there.
  test("routing whitelist matches the exposed subcommand names", () => {
    const match = RUN_CLI_SRC.match(/AGENT_RUNTIME_SUBCOMMANDS = new Set\(\[([^\]]+)\]\)/)
    expect(match).not.toBeNull()
    const listed = [...match![1]!.matchAll(/"([^"]+)"/g)].map((m) => m[1]).sort()
    expect(listed).toEqual(["export", "llm", "run", "session", "stats"])
  })
})
