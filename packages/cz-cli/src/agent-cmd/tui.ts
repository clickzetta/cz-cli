import type { Argv } from "yargs"
import { cmd } from "opencode/cli/cmd/cmd"
import { TuiThreadCommand as UpstreamTuiThreadCommand } from "opencode/cli/cmd/tui"

/**
 * cz-cli-owned default (`$0`) TUI command — wraps the pristine upstream
 * TuiThreadCommand to REMOVE `--mini` and its dependent flags.
 *
 * Why: `--mini` is upstream's alternate minimal interface, and it is unbrandable
 * from the cz layer. Verified against the shipped binary — it prints upstream
 * branding on BOTH ends of the session:
 *
 *   entry:  █▀▀█  OpenCode
 *   exit:   █▀▀█  Session  <title>
 *           █  █  Continue opencode --mini -s ses_XXXX
 *
 * (packages/opencode/src/cli/cmd/run/splash.ts `entrySplash`/`exitSplash`). Unlike
 * the main TUI's exit epilogue — which is a single process.stdout.write we can
 * filter, see bootstrap/tui-epilogue-brand.ts — the splash is drawn cell-by-cell
 * into renderables, so there is no cz-layer hook that can reach it. And the
 * `opencode --mini -s <id>` it prints is a DEAD END for cz users: cz-cli isolates
 * its global dirs (UPSTREAM-PATCHES.md #1/#2), so a real opencode install answers
 * "Session not found".
 *
 * Rather than take an intrusive patch on packages/opencode purely for branding, we
 * stop advertising and accepting the flag. The full TUI (the default) is unaffected
 * and is fully branded. Users who explicitly pass --mini get a clear error instead
 * of an unbranded interface with a broken continue hint.
 *
 * Implementation note: yargs cannot "unset" an option a parent builder declared, so
 * we do not call the upstream builder's --mini at all — we run upstream's builder,
 * then re-declare the five flags as hidden and reject them in the handler. Hidden
 * (not absent) because upstream's builder already registered them; hiding keeps
 * them out of --help while letting us emit a purposeful error.
 */

// --mini plus every flag whose upstream handler requires it.
const MINI_FLAGS = ["mini", "no-replay", "replay-limit", "demo"] as const

// Long-form spellings we scan argv for, so `--mini=true` and `--mini` both report.
const MINI_ARGV = ["--mini", "--no-replay", "--replay-limit", "--demo"] as const

/** The --mini-family flag present in argv, if any. Exported for tests. */
export function findMiniFlag(argv: readonly string[]): string | undefined {
  return MINI_ARGV.find((flag) => argv.some((arg) => arg === flag || arg.startsWith(flag + "=")))
}

export const MINI_UNSUPPORTED_MESSAGE =
  "--mini is not supported by cz-cli. Run `cz-agent` (or `cz-cli agent`) for the full interface."

export const TuiThreadCommand = cmd({
  command: UpstreamTuiThreadCommand.command!,
  describe: UpstreamTuiThreadCommand.describe!,
  builder: (yargs: Argv) => {
    let next = (UpstreamTuiThreadCommand.builder as (y: Argv) => Argv)(yargs)
    // Hide the mini family from --help; the handler below rejects them.
    for (const name of MINI_FLAGS) next = next.option(name, { hidden: true })
    return next
  },
  async handler(raw) {
    const args = raw as Record<string, unknown>
    // Check argv rather than parsed args: yargs gives `mini` a default of false, so
    // a parsed-value check cannot distinguish "absent" from "--no-mini".
    const flag = findMiniFlag(process.argv.slice(2))
    if (flag || args.mini === true) {
      process.stderr.write(MINI_UNSUPPORTED_MESSAGE + "\n")
      process.exitCode = 1
      return
    }
    await (UpstreamTuiThreadCommand.handler as (a: unknown) => Promise<void>)(raw)
  },
})
