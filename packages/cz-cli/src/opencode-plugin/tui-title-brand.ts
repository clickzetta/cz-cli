import path from "node:path"
import os from "node:os"
import type { TuiPlugin } from "@opencode-ai/plugin/tui"

// cz_change: rebrand the terminal window/tab title without touching packages/tui
// or packages/opencode. app.tsx writes "OpenCode" / "OC | <title>" straight to
// renderer.setTerminalTitle (see the title createEffect). We receive the SAME
// CliRenderer instance, so wrapping setTerminalTitle rewrites the brand tokens on
// every upstream write — it naturally follows session/route changes with no
// reactive plumbing (TuiRouteCurrent carries no session title, TuiLifecycle has
// no route hook, so an effect-based approach can't see what app.tsx sees).
// Empty strings (title disabled / renderer teardown) pass through untouched.
// Lives in a plain .ts module (no JSX) so it stays unit-testable under bun test.
//
// cz_change: wrapping ALONE is not enough, and this was verified broken against the
// shipped binary — capturing OSC-0 escapes showed the home title stuck at "OpenCode".
// Cause: app.tsx's title createEffect writes "OpenCode" for the home route during
// initial render, which happens BEFORE TUI plugins finish loading, and that effect
// only re-runs when the route/session changes. So on the home screen our wrapper is
// installed too late and never sees a write (entering a session then does produce a
// correctly branded "CZ | <title>"). Fix: after wrapping, immediately re-emit the
// branded title once, rather than waiting for an upstream write that will not come.
// We only do this when the title feature is actually on, mirroring upstream's own
// guard (kv "terminal_title_enabled" + Flag.OPENCODE_DISABLE_TERMINAL_TITLE), so we
// never resurrect a title the user turned off.

// cz_change: the sidebar footer's brand line. Upstream's own sidebar_footer
// builtin (packages/tui/src/feature-plugins/sidebar/footer.tsx) renders
// "• OpenCode <version>" under the session's directory — a brand token sitting in
// plain view on every session screen. It cannot be rebranded by wrapping a
// renderer method the way the terminal title is, so the cz brand plugin claims
// the slot instead (see tui-brand.tsx). The pieces the replacement view needs
// that aren't JSX live here, next to czBrandTitle, so they're unit-testable.
// (The /connect dialog and home tips still carry opencode copy — deliberately
// kept, since replacing them would mean editing packages/tui.)
export const CZ_BRAND_LEAD = "CZ"
export const CZ_BRAND_TAIL = "CLI"

/**
 * `~`-abbreviated path, matching upstream abbreviateHome (packages/tui/src/runtime.tsx)
 * — reimplemented because it isn't part of the public plugin API. Paths outside
 * home are returned untouched.
 */
export function czAbbreviateHome(input: string, home: string): string {
  if (!home) return input
  const relative = path.relative(home, input)
  if (relative === "") return "~"
  if (relative === ".." || relative.startsWith(".." + path.sep) || path.isAbsolute(relative)) return input
  return "~" + path.sep + relative
}

/**
 * The directory line upstream shows above the brand, split the same way: every
 * segment but the last is muted, the last is emphasized. `branch` is appended as
 * `:branch` only when the session sits in the TUI's own directory, which is the
 * caller's decision — upstream compares session.directory with state.path.directory.
 */
export function czFooterPath(input: { directory: string; home?: string; branch?: string }): {
  parent: string
  name: string
} {
  const out = czAbbreviateHome(input.directory, input.home ?? os.homedir())
  const text = input.branch ? out + ":" + input.branch : out
  const list = text.split("/")
  return {
    parent: list.slice(0, -1).join("/"),
    name: list.at(-1) ?? "",
  }
}

// Pure mapping from an upstream title to its cz-branded form.
export function czBrandTitle(title: string): string {
  if (!title) return title // "" = disabled/teardown — leave as-is
  if (title === "OpenCode") return "CZ CLI"
  if (title.startsWith("OC | ")) return "CZ | " + title.slice("OC | ".length)
  return title
}

// Whether the terminal-title feature is enabled, mirroring app.tsx's own guard so a
// user who disabled titles never gets one re-emitted by the catch-up write. Defaults
// to enabled when kv is unavailable, matching upstream's `kv.get(key, true)`.
export function terminalTitleEnabled(input: {
  kvGet?: (key: string, fallback: boolean) => boolean
  env?: Record<string, string | undefined>
}): boolean {
  const raw = input.env?.OPENCODE_DISABLE_TERMINAL_TITLE
  if (raw !== undefined && raw !== "" && raw !== "0" && raw.toLowerCase() !== "false") return false
  try {
    return input.kvGet?.("terminal_title_enabled", true) ?? true
  } catch {
    return true
  }
}

type TitleBrandApi = Pick<Parameters<TuiPlugin>[0], "renderer" | "lifecycle"> &
  Partial<Pick<Parameters<TuiPlugin>[0], "kv" | "route">>

export function installTerminalTitleBrand(api: TitleBrandApi) {
  const renderer = api.renderer as { setTerminalTitle?: (title: string) => void }
  const original = renderer.setTerminalTitle
  if (typeof original !== "function") return
  const bound = original.bind(renderer)
  const marker = "__czTitleBrand" as const
  const tagged = renderer as unknown as Record<string, unknown>
  if (tagged[marker]) return // already wrapped (plugin reloaded onto same renderer)

  renderer.setTerminalTitle = (title: string) => bound(czBrandTitle(title))
  tagged[marker] = true

  // Catch-up write: the home-route title was already emitted before we loaded, and
  // upstream's effect will not re-run until the route changes. Re-emit it branded.
  // Guarded on the same conditions upstream checks, and wrapped so a failure here
  // can never break plugin activation (branding is best-effort).
  try {
    const enabled = terminalTitleEnabled({
      kvGet: api.kv ? (key, fallback) => api.kv!.get(key, fallback) : undefined,
      env: process.env,
    })
    if (enabled) renderer.setTerminalTitle(initialTitle(api.route?.current))
  } catch {
    // ignore — a missing kv/route or a renderer that rejects the write is non-fatal
  }

  api.lifecycle.onDispose(() => {
    renderer.setTerminalTitle = original
    delete tagged[marker]
  })
}

// The title upstream would have written for the CURRENT route. We only need the
// home/unknown case in practice (session routes re-run the effect and flow through
// the wrapper), so anything non-home falls back to the plain brand.
export function initialTitle(route?: { name?: string }): string {
  void route
  return czBrandTitle("OpenCode")
}
