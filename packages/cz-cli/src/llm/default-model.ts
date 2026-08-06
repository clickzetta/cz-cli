// cz_change: answers "which model does `cz-cli agent` start on?" for the CLI,
// using the SAME resolver the TUI runs (@opencode-ai/core/model-selection). The
// only thing that differs is where the four inputs come from — the TUI reads its
// sync store, we call Provider.list() directly.
//
// This replaces `agent llm show`'s old "automatic (OpenCode selects at runtime)".
// There is nothing automatic about it: with any usable provider the resolver's
// last tier is unconditional, so a concrete model always comes out. Reporting it
// requires the live model catalog, because ClickZetta entries deliberately store
// no `models` in llm.json (see llm/native-config.ts providerFromInput) — the
// catalog is discovered at runtime from the gateway's GET /v1/models.
//
// Consequence, accepted deliberately: `agent llm show` performs network I/O. It
// degrades rather than fails — discovery errors are already swallowed inside
// opencode's clickzetta loader, and an empty catalog surfaces here as undefined,
// which the caller renders as "unavailable" instead of a fabricated name.
import { join } from "node:path"
import { readFileSync } from "node:fs"
import { Effect } from "effect"
import {
  resolveModelSelection,
  type ResolvedModelSelection,
  type ModelSelectionProvider,
} from "@opencode-ai/core/model-selection"

/** Recent selections as persisted by the TUI, newest first. Best-effort: a
 * missing or malformed file just means there is no history to consult. */
export function readRecentSelections(statePath: string): Array<{ providerID?: unknown; modelID?: unknown }> {
  try {
    const parsed = JSON.parse(readFileSync(join(statePath, "model.json"), "utf-8")) as unknown
    if (typeof parsed !== "object" || parsed === null) return []
    const recent = (parsed as { recent?: unknown }).recent
    if (!Array.isArray(recent)) return []
    return recent.filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null)
  } catch {
    return []
  }
}

/**
 * Resolve the startup model exactly as the TUI would, for the current config.
 *
 * `argsModel` is intentionally omitted: no CLI command that reports the default
 * accepts opencode's `--model`, and passing something the TUI wouldn't see would
 * make the two disagree — the one thing this shared path exists to prevent.
 */
export async function resolveDefaultModel(): Promise<ResolvedModelSelection | undefined> {
  const { AppRuntime } = await import("opencode/effect/app-runtime")
  const { InstanceStore } = await import("opencode/project/instance-store")
  const { InstanceRef } = await import("opencode/effect/instance-ref")
  const { Provider } = await import("opencode/provider/provider")
  const { Config } = await import("opencode/config/config")
  const { Global } = await import("@opencode-ai/core/global")

  const body = Effect.gen(function* () {
    const providerSvc = yield* Provider.Service
    // Same call the TUI's provider list is built from (server handlers/config.ts
    // `providers`), so `providers` order and `providerDefault` match tier 4.
    const providers = yield* providerSvc.list()
    const config = yield* Config.Service.use((svc) => svc.get())
    return resolveModelSelection({
      configModel: typeof config.model === "string" ? config.model : undefined,
      recent: readRecentSelections(Global.Path.state),
      providers: Object.values(providers) as ModelSelectionProvider[],
      providerDefault: Provider.defaultModelIDs(providers),
    })
  })

  // Provider.list() reads instance state, so it needs a loaded InstanceContext —
  // bare AppRuntime fails with "InstanceRef not provided". Mirrors effectCmd and
  // agent-cmd/run.ts's withInstance: load → provide → dispose on every exit.
  const { store, ctx } = await AppRuntime.runPromise(
    InstanceStore.Service.use((s) => s.load({ directory: process.cwd() }).pipe(Effect.map((c) => ({ store: s, ctx: c })))),
  )
  try {
    return await AppRuntime.runPromise(body.pipe(Effect.provideService(InstanceRef, ctx)) as Effect.Effect<
      ResolvedModelSelection | undefined,
      never,
      never
    >)
  } finally {
    await AppRuntime.runPromise(store.dispose(ctx))
  }
}

/** How the resolved model was chosen, phrased for a TTY reader. Brand-free: the
 * user is running cz-cli, and naming the upstream project here told them nothing
 * actionable. */
export function describeSelectionSource(source: ResolvedModelSelection["source"]): string {
  switch (source) {
    case "args":
      return "--model"
    case "config":
      return "config.model"
    case "recent":
      return "last used"
    case "first":
      return "first available, not pinned"
  }
}
