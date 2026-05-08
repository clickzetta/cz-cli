import z from "zod"
import { Effect } from "effect"
import * as Tool from "./tool"
import DESCRIPTION from "./cz-tool.txt"
import { execute } from "@clickzetta/cli"

const Parameters = z.object({
  command: z.string().describe(
    "The cz-tool command to execute, e.g. 'sql \"SELECT 1\"' or 'table list --schema public'",
  ),
  profile: z
    .string()
    .optional()
    .describe("Profile name to use (uses default profile if omitted)"),
})

export const CzToolTool = Tool.define(
  "cz_tool",
  Effect.gen(function* () {
    return () =>
      Effect.sync(() => ({
        description: DESCRIPTION,
        parameters: Parameters,
        execute: (params: z.infer<typeof Parameters>, _ctx: Tool.Context) =>
          Effect.gen(function* () {
            const extraArgs = params.profile ? ["--profile", params.profile] : undefined
            const result = yield* Effect.promise(() => execute(params.command, extraArgs))
            const output = result.exitCode === 0
              ? result.output
              : `Exit code: ${result.exitCode}\n${result.output}`

            return {
              title: `cz-tool ${params.command.split(" ")[0] ?? ""}`,
              metadata: { exitCode: result.exitCode },
              output: output || "(no output)",
            }
          }),
      }))
  }),
)
