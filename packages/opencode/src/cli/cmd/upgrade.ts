import type { Argv } from "yargs"
import { UI } from "../ui"
import * as prompts from "@clack/prompts"
import { Effect } from "effect"
import { AppRuntime } from "@/effect/app-runtime"
import { Installation } from "@/installation"

export const UpdateCommand = {
  command: "update [target]",
  describe: "update cz-cli to the latest or a specific version",
  builder: (yargs: Argv) => {
    return yargs
      .positional("target", {
        describe: "version to upgrade to, for ex '0.3.87' or 'v0.3.87'",
        type: "string",
      })
      .option("nightly", {
        describe: "install the latest nightly build",
        type: "boolean",
        default: false,
      })
  },
  handler: async (args: { target?: string; nightly?: boolean }) => {
    UI.empty()
    UI.println("  " + UI.Style.TEXT_INFO_BOLD + "◆ cz-cli" + UI.Style.TEXT_NORMAL)
    UI.empty()
    prompts.intro("Upgrade")
    const channel = args.nightly ? "nightly" : "stable"
    const result = await AppRuntime.runPromise(
      Installation.Service.use((svc) =>
        Effect.gen(function* () {
          const method = yield* svc.method()
          if (method === "unknown") return { ok: false as const, error: "Unknown installation method" }
          const target = args.target?.replace(/^v/, "") || (yield* svc.latest(method, channel))
          return yield* Effect.catch(
            svc.upgrade(method, target, channel).pipe(Effect.as({ ok: true as const, target })),
            (error) =>
              Effect.succeed({
                ok: false as const,
                error: error instanceof Error ? error.message : String(error),
              }),
          )
        }),
      ),
    )
    if (!result.ok) {
      prompts.log.error(result.error)
      prompts.outro("Failed")
      process.exitCode = 1
      return
    }
    prompts.log.success(`Updated cz-cli to ${result.target}`)
    prompts.outro("Done")
  },
}
