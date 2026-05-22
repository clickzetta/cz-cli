import type { Argv } from "yargs"

export function commandGroup(yargs: Argv, commandName: string): Argv {
  const commands = getRegisteredCommands(yargs)
  const available = commands.length > 0 ? commands.join(", ") : "see --help"

  const humanMsg = `Missing subcommand for '${commandName}'. Available: ${available}`
  const aiMsg = `Missing subcommand. Available subcommands: ${available}. Run \`cz-cli ${commandName} --help\` for details.`

  return yargs
    .strictCommands()
    .strictOptions()
    .fail((msg, err) => {
      if (err) throw err
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
      const output = JSON.stringify({
        error: { code: "USAGE_ERROR", message: finalMsg },
        ai_message: finalAi,
      })
      process.stdout.write(output + "\n")
      process.exitCode = 2
      throw new Error(finalMsg)
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
