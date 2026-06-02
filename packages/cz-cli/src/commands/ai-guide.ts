import type { Argv } from "yargs"
import type { GlobalArgs } from "../cli.js"
import { success } from "../output/index.js"
import { buildAiGuide, buildToonPayload, registerStaticCommands } from "../guide-builder.js"

export function registerAiGuideCommand(cli: Argv<GlobalArgs>): void {
  cli.command(
    "ai-guide",
    "Generate AI-friendly command reference",
    (yargs) =>
      yargs
        .option("wide", { type: "boolean", default: false, describe: "Include per-command option details" })
        .option("budget", { type: "number", describe: "Max payload size in chars" })
        .option("format", {
          type: "string",
          choices: ["json", "pretty", "toon"] as const,
          default: "toon",
          describe: "Output format (default: toon)",
        }),
    (argv) => {
      registerStaticCommands()

      const guide = buildAiGuide({ wide: argv.wide, budgetChars: argv.budget })
      // Default to "toon" format when neither --format nor the global formatter is explicitly set
      const effectiveFormat = argv.format !== "toon"
        ? argv.format
        : (argv.format_explicit ? argv.format : "toon")
      const useToon = effectiveFormat === "toon" || (!argv.format_explicit && argv.format === "toon")
      const payload = useToon ? buildToonPayload(guide as unknown as Record<string, unknown>) : guide
      success(payload, { format: useToon ? "toon" : (effectiveFormat ?? "toon") })
    },
  )
}
