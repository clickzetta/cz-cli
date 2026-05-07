import type { Argv } from "yargs"
import type { GlobalArgs } from "../cli.js"
import { success } from "../output/index.js"
import { buildAiGuide, buildToonPayload, registerStaticCommands } from "../guide-builder.js"
import { generateSkillMarkdown, writeGeneratedSkill, skillDriftDiff, SKILL_OUTPUT_PATH } from "../skill-generator.js"

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
        })
        .option("generate-skill", {
          type: "boolean",
          default: false,
          describe: "Generate SKILL.md from template and write to disk",
        })
        .option("check-skill", {
          type: "boolean",
          default: false,
          describe: "Check if SKILL.md is up to date (exit 1 if drifted)",
        })
        .option("skill-output", {
          type: "string",
          describe: "Output path for generated SKILL.md (default: skills/cz-cli/SKILL.md)",
        })
        .option("skill-template", {
          type: "string",
          describe: "Path to SKILL.template.md",
        }),
    (argv) => {
      registerStaticCommands()

      // --generate-skill: render and write SKILL.md
      if (argv.generateSkill) {
        const outputPath = writeGeneratedSkill({
          outputPath: argv.skillOutput,
          templatePath: argv.skillTemplate,
        })
        success({ generated: outputPath, command_count: "see frontmatter" })
        return
      }

      // --check-skill: diff generated vs existing, exit 1 if drifted
      if (argv.checkSkill) {
        const existingPath = argv.skillOutput ?? SKILL_OUTPUT_PATH
        const diff = skillDriftDiff({
          existingPath,
          templatePath: argv.skillTemplate,
        })
        if (diff) {
          console.error("Skill doc drift detected. Run: cz-cli ai-guide --generate-skill")
          console.error(diff)
          process.exit(1)
        }
        success({ status: "up_to_date", path: existingPath })
        return
      }

      // Default: output ai-guide JSON/toon payload
      const guide = buildAiGuide({ wide: argv.wide, budgetChars: argv.budget })
      // Default to "toon" format when --output is not explicitly set by the user
      const effectiveFormat = argv.format !== "toon"
        ? argv.format
        : (argv.output_explicit ? argv.output : "toon")
      const useToon = effectiveFormat === "toon" || (!argv.output_explicit && argv.format === "toon")
      const payload = useToon ? buildToonPayload(guide as unknown as Record<string, unknown>) : guide
      success(payload, { format: useToon ? "toon" : (effectiveFormat ?? "toon") })
    },
  )
}
