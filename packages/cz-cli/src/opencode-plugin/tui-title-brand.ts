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

// Pure mapping from an upstream title to its cz-branded form.
export function czBrandTitle(title: string): string {
  if (!title) return title // "" = disabled/teardown — leave as-is
  if (title === "OpenCode") return "CZ CLI"
  if (title.startsWith("OC | ")) return "CZ | " + title.slice("OC | ".length)
  return title
}

export function installTerminalTitleBrand(api: Pick<Parameters<TuiPlugin>[0], "renderer" | "lifecycle">) {
  const renderer = api.renderer as { setTerminalTitle?: (title: string) => void }
  const original = renderer.setTerminalTitle
  if (typeof original !== "function") return
  const bound = original.bind(renderer)
  const marker = "__czTitleBrand" as const
  const tagged = renderer as unknown as Record<string, unknown>
  if (tagged[marker]) return // already wrapped (plugin reloaded onto same renderer)

  renderer.setTerminalTitle = (title: string) => bound(czBrandTitle(title))
  tagged[marker] = true
  api.lifecycle.onDispose(() => {
    renderer.setTerminalTitle = original
    delete tagged[marker]
  })
}
