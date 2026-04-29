import type { Argv } from "yargs"
import type { GlobalArgs } from "../cli.js"
import { success } from "../output/index.js"
import { buildAiGuide, registerStaticCommands } from "../guide-builder.js"

export function registerAiGuideCommand(cli: Argv<GlobalArgs>): void {
  cli.command(
    "ai-guide",
    "Generate AI-friendly command reference",
    (yargs) =>
      yargs
        .option("wide", { type: "boolean", default: false, describe: "Include per-command option details" })
        .option("budget", { type: "number", describe: "Max payload size in chars" })
        .option("format", {
          alias: "f",
          type: "string",
          choices: ["json", "pretty", "toon"] as const,
          default: "toon",
          describe: "Output format (default: toon)",
        }),
    (argv) => {
      registerStaticCommands()
      const guide = buildAiGuide({ wide: argv.wide, budgetChars: argv.budget })
      success(guide, { format: argv.format })
    },
  )
}
