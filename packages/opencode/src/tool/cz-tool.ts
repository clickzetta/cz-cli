import z from "zod"
import { Effect, Stream } from "effect"
import { ChildProcess } from "effect/unstable/process"
import { ChildProcessSpawner } from "effect/unstable/process/ChildProcessSpawner"
import * as Tool from "./tool"
import DESCRIPTION from "./cz-tool.txt"
import { resolveCzTool } from "../cli/cmd/forward"

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
    const spawner = yield* ChildProcessSpawner

    return () =>
      Effect.sync(() => ({
        description: DESCRIPTION,
        parameters: Parameters,
        execute: (params: z.infer<typeof Parameters>, _ctx: Tool.Context) =>
          Effect.gen(function* () {
            const bin = resolveCzTool()
            const profileArg = params.profile ? ` --profile ${params.profile}` : ""
            const shellCmd = `${bin} ${params.command} --output json${profileArg}`

            const chunks: string[] = []
            let exitCode: number | null = null

            exitCode = yield* Effect.scoped(
              Effect.gen(function* () {
                const handle = yield* spawner.spawn(
                  ChildProcess.make("sh", ["-c", shellCmd], {
                    stdin: "ignore",
                    detached: false,
                  }),
                )

                yield* Effect.forkScoped(
                  Stream.runForEach(Stream.decodeText(handle.all), (chunk) =>
                    Effect.sync(() => {
                      chunks.push(chunk)
                    }),
                  ),
                )

                return yield* handle.exitCode
              }),
            ).pipe(Effect.orDie)

            const output = chunks.join("")
            const result = exitCode === 0 ? output : `Exit code: ${exitCode}\n${output}`

            return {
              title: `cz-tool ${params.command.split(/\s+/)[0] ?? ""}`,
              metadata: {
                exitCode,
              },
              output: result || "(no output)",
            }
          }),
      }))
  }),
)
