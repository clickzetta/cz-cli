import type { Argv } from "yargs"
import { suggestClosest } from "./suggest.js"
import { parseOutputArgs, renderOutput } from "./output/index.js"
import { KNOWN_GLOBAL_FLAGS, INVOCATION_ARGS_KEY } from "./cli.js"
import { SubcommandHelpShown } from "./subcommand-help.js"

// Re-exported so the opencode agent runtime (which imports commandGroup from
// this module) can catch the sentinel at its own parse boundaries. See
// subcommand-help.ts.
export { SubcommandHelpShown } from "./subcommand-help.js"

export function commandGroup<T>(yargs: Argv<T>, commandName: string): Argv<T> {
  const commands = getRegisteredCommands(yargs)
  const localOptions = getRegisteredOptions(yargs)
  const available = commands.length > 0 ? commands.join(", ") : "see --help"

  // The raw args for this invocation, stashed by createCli on the top-level
  // instance (which yargs passes through to nested builders). Captured here so
  // the fail handler can resolve --format/--field from the real invocation
  // rather than process.argv, which on the same-process execute() path belongs
  // to the host process. Falls back to process.argv for any caller that built
  // its yargs without createCli.
  const invocationArgs = (yargs as unknown as Record<string, unknown>)[INVOCATION_ARGS_KEY]
  const outputArgsSource = Array.isArray(invocationArgs)
    ? (invocationArgs as string[])
    : process.argv.slice(2)

  const humanMsg = `Missing subcommand for '${commandName}'. Available: ${available}`
  const aiMsg = `Missing subcommand. Available subcommands: ${available}. Run \`cz-cli ${commandName} --help\` for details.`

  return yargs
    .strictCommands()
    .strictOptions()
    .fail((msg, err, failYargs) => {
      if (err) throw err

      // A bare group invocation (`cz-cli ai-gateway`, `cz-cli ai-gateway key`)
      // is not a user error — the caller has not yet chosen a subcommand. Treat
      // it like `--help`: render this group's help and throw the sentinel, so
      // incomplete branch commands are self-documenting instead of returning
      // USAGE_ERROR.
      //
      // yargs hands the failing instance to the fail handler as its 3rd arg, so
      // failYargs.showHelp() renders THIS group's help (correct even for a
      // nested group). Throwing (not returning) stops the failure from bubbling
      // up to ancestor fail handlers — which would reset exitCode to 2 and
      // re-emit USAGE_ERROR — and aborts the parse before the post-validation
      // profile middleware runs, so a bare group prints help, never NO_PROFILE.
      // The parse boundary catches SubcommandHelpShown and exits 0.
      if (msg && msg.startsWith("Missing subcommand for '")) {
        failYargs.showHelp((help: string) => process.stdout.write(help + "\n"))
        throw new SubcommandHelpShown()
      }

      // Distinguish the two yargs failure shapes so we suggest the right thing:
      //   "Unknown command: X"  -> X is a bad SUBCOMMAND  -> match subcommand names
      //   "Unknown argument: X" -> X is a bad FLAG        -> match flag names
      // (Previously both went through the subcommand matcher, so a flag typo like
      //  `schema list --limt` wrongly suggested the subcommand 'list'.)
      let suggestion: string | undefined
      let badSubcommand: string | undefined
      let badFlag: string | undefined

      const cmdMatch = msg?.match(/Unknown commands?: (.+)/)
      const argMatch = msg?.match(/Unknown arguments?: (.+)/)
      if (cmdMatch) {
        badSubcommand = cmdMatch[1]!.split(",")[0]!.trim()
        suggestion = suggestClosest(badSubcommand, commands)
      } else if (argMatch) {
        badFlag = argMatch[1]!.split(",")[0]!.trim().replace(/^-+/, "")
        const flagCandidates = [...localOptions, ...KNOWN_GLOBAL_FLAGS].filter((f) => f.length > 1)
        const hit = suggestClosest(badFlag, flagCandidates)
        if (hit) suggestion = `--${hit}`
      }

      const finalMsg = (!msg || msg.trim() === "") ? humanMsg : msg
      let finalAi: string
      if (!msg || msg.trim() === "" || finalMsg === humanMsg) {
        finalAi = aiMsg
      } else if (msg.startsWith("Missing subcommand for")) {
        finalAi = msg.replace(/^Missing subcommand for '([^']+)'\. Available: (.+)$/, (_, cmd, subs) =>
          `Missing subcommand. Available subcommands: ${subs}. Run \`cz-cli ${cmd} --help\` for details.`)
      } else {
        finalAi = `${finalMsg}. Run \`cz-cli ${commandName} --help\` for details.`
      }

      const displayMsg = suggestion ? `${finalMsg}. Did you mean '${suggestion}'?` : finalMsg
      if (suggestion && badSubcommand) {
        finalAi = `Unknown subcommand '${badSubcommand}' for '${commandName}'. Did you mean '${suggestion}'? Available subcommands: ${available}.`
      } else if (suggestion && badFlag) {
        finalAi = `Unknown option '--${badFlag}' for '${commandName}'. Did you mean '${suggestion}'? Run \`cz-cli ${commandName} --help\` for available options.`
      }

      const errorObj: Record<string, unknown> = { code: "USAGE_ERROR", message: displayMsg }
      if (suggestion) errorObj.did_you_mean = suggestion
      const outputArgs = parseOutputArgs(outputArgsSource)
      const output = renderOutput({
        error: errorObj,
        ai_message: finalAi,
      }, outputArgs.format, outputArgs.field)
      process.stdout.write(output + "\n")
      process.exitCode = 2
      throw new Error(displayMsg)
    })
    .demandCommand(1, humanMsg)
}

function getRegisteredCommands(yargs: Argv): string[] {
  try {
    const internal = (yargs as any).getInternalMethods()
    if (internal && typeof internal.getCommandInstance === "function") {
      const cmdInstance = internal.getCommandInstance()
      if (cmdInstance && typeof cmdInstance.getCommands === "function") {
        return cmdInstance.getCommands().filter((c: string) => c !== "$0")
      }
    }
  } catch {}
  return []
}

// The group's own declared option names (long forms), used to suggest a fix for
// a mistyped command-specific flag (e.g. `--limt` -> `--limit`).
function getRegisteredOptions(yargs: Argv): string[] {
  try {
    const opts = (yargs as any).getOptions?.()
    if (opts && opts.key && typeof opts.key === "object") {
      return Object.keys(opts.key)
    }
  } catch {}
  return []
}
