// cz_change: the ACTIVE profile as a `current()` / `set()` pair — the shape
// opencode uses for the active model (`local.model` in packages/tui/src/context/
// local.tsx), so switching profiles reads the same way as switching models.
//
// It lives HERE rather than in that context for two reasons. A profile is a cz
// concept — upstream has none — so adding it to `local` would edit a pristine file
// and conflict on every rebase. And `local` is reachable only from the TUI, while
// a profile has three consumers that cannot see each other:
//
//   1. the TUI (footer, /profile, the reminder injected into each turn)
//   2. plain CLI commands (`cz-cli sql …`) — no solid, no reactive graph
//   3. child processes — the model runs `cz-cli` via bash and reads CZ_* env
//
// `local.model` can be pure TUI state because only the TUI needs it. A profile
// cannot, so `process.env.CZ_PROFILE` stays the storage: it is the one medium all
// three share, and it is what the CZ_* override layer is already built on. A
// private variable here would be a SECOND source of truth.
//
// NOT persisted, by design. Nothing here writes profiles.toml — that file is read
// for `default_profile` at startup and for each profile's settings, never written.
// A switch lasts as long as the process. Persisting it would leave a tenant (and
// possibly a cloud partition) selected with no trace on the command line, which is
// a far worse failure than for a model: an agent silently pointed at the wrong
// lakehouse can run writes there. `cz-cli profile use` remains the explicit,
// visible way to change the default.
import { ConnectionEnv } from "./env.js"
import { getDefaultProfileName } from "./profile-store.js"

/** Notified after the active profile actually changes. Never fires on a no-op. */
type ProfileListener = (name: string | undefined) => void

const listeners = new Set<ProfileListener>()

/**
 * The profile this process is running as.
 *
 * `CZ_PROFILE` wins; `default_profile` is the fallback. Both steps live here
 * because call sites that spelled the order themselves drifted — one read only the
 * default and retargeted a `--profile B` session at another tenant.
 *
 * The fallback is load-bearing: `CZ_PROFILE` is usually already resolved (run-cli
 * .ts expands `--profile`/`-p` into it at startup), but that does not happen on
 * every entry point — plain CLI commands and library-style imports (tests) reach
 * here with it unset.
 *
 * Returns undefined only when neither is available, which callers should treat as
 * "no profile configured" rather than substituting one of their own.
 */
export function current(): string | undefined {
  return ConnectionEnv.profileName() ?? getDefaultProfileName()
}

/**
 * Switch the active profile. The ONLY way it changes after startup.
 *
 * Re-derives the whole CZ_* override layer, which is why this must not be a bare
 * `process.env.CZ_PROFILE = name`: the auth vars (CZ_PAT / CZ_USERNAME /
 * CZ_PASSWORD) are mutually exclusive alternatives, so the previous profile's
 * credential has to be cleared or it wins the auth priority in
 * resolveConnectionConfig() and authenticates as the OLD identity.
 * applyClickZettaProfile owns that logic; this wraps it and adds notification.
 *
 * Pass undefined to fall back to `default_profile`.
 *
 * Does NOT validate that the profile exists — callers own that and can report a
 * better error than this layer could. Returns the name now in effect.
 */
export async function set(name: string | undefined): Promise<string | undefined> {
  const previous = current()

  // Imported lazily so the read path (`current`) never pulls in the TOML parser —
  // it is reached from the pre-bundled TUI runtime asset, where every extra module
  // is shipped weight.
  const { applyClickZettaProfile } = await import("../bootstrap/profile-env.js")
  applyClickZettaProfile(name)

  // applyClickZettaProfile always PINS what it resolved, including when it fell
  // back to default_profile itself. For an explicit `undefined` that is the wrong
  // end state: unpinning has to leave the process following default_profile, so a
  // later `cz-cli profile use` elsewhere is picked up rather than shadowed by a
  // snapshot of the old value. The CZ_* layer it just derived stays — those are the
  // default profile's settings, which is exactly what unpinned should use.
  if (name === undefined) ConnectionEnv.unpin()

  const next = current()
  if (next === previous) return next
  for (const listener of listeners) {
    try {
      listener(next)
    } catch {
      // One consumer must not break the switch for the others.
    }
  }
  return next
}

/** Subscribe to switches. Returns an unsubscribe function. */
export function onChange(listener: ProfileListener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
