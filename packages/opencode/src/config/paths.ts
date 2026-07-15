export * as ConfigPaths from "./paths"

import path from "path"
import { Flag } from "@opencode-ai/core/flag/flag"
import { Global } from "@opencode-ai/core/global"
import { unique } from "remeda"
import * as Effect from "effect/Effect"
import { FSUtil } from "@opencode-ai/core/fs-util"

export const files = Effect.fn("ConfigPaths.projectFiles")(function* (
  name: string,
  directory: string,
  worktree?: string,
) {
  const afs = yield* FSUtil.Service
  return (yield* afs.up({
    targets: [`${name}.jsonc`, `${name}.json`],
    start: directory,
    stop: worktree,
  })).toReversed()
})

export const directories = Effect.fn("ConfigPaths.directories")(function* (directory: string, worktree?: string) {
  const afs = yield* FSUtil.Service
  return unique([
    Global.Path.config,
    ...(!Flag.OPENCODE_DISABLE_PROJECT_CONFIG
      ? yield* afs.up({
          targets: [".opencode"],
          start: directory,
          stop: worktree,
        })
      : []),
    //======================== cz-cli change ========================
    // Home-level global config dir. Upstream reads ~/.opencode here (a hardcoded
    // literal that the app="clickzetta" rename in global.ts CANNOT reach — that
    // constant only governs the XDG-derived config/data/cache/state roots, not
    // this ~/.<name> discovery path). Left as ".opencode", a machine that also
    // has a real opencode install would share ~/.opencode with it — its
    // plugins/agents/commands would leak into cz-cli and vice versa. Reading
    // ~/.clickzetta instead isolates cz-cli's home-level config from opencode.
    // See packages/cz-cli/UPSTREAM-PATCHES.md.
    ...(yield* afs.up({
      targets: [".clickzetta"],
      start: Global.Path.home,
      stop: Global.Path.home,
    })),
    //====================== end cz-cli change ======================
    ...(Flag.OPENCODE_CONFIG_DIR ? [Flag.OPENCODE_CONFIG_DIR] : []),
  ])
})

export function fileInDirectory(dir: string, name: string) {
  return [path.join(dir, `${name}.json`), path.join(dir, `${name}.jsonc`)]
}
