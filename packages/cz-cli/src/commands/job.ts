import type { Argv } from "yargs"
import type { GlobalArgs } from "../cli.js"
import { error } from "../output/index.js"

export function registerJobCommand(cli: Argv<GlobalArgs>): void {
  cli.command(
    "job",
    "Job performance tools (placeholder)",
    () => {},
    (argv) => {
      error(
        "NOT_IMPLEMENTED",
        "Job commands are not yet implemented. Use 'cz-tool sql' for ad-hoc queries.",
        { format: argv.output },
      )
    },
  )
}
