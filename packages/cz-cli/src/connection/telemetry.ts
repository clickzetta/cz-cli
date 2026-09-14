import { current } from "./profile-context.js"
import { profileStoreFingerprint, readProfileEntry } from "./profile-store.js"

/**
 * profile row field -> OTel attribute. The ONLY place either name is spelled.
 *
 * `setup` used to write `attrs["enduser.id"] = String(opts.userId)` by hand, so the key
 * existed twice in the codebase and the two copies could disagree about spelling, about
 * `String()` coercion, or about which signal layer they belong on — which is how the log
 * path ended up putting identity on the Resource. Callers now pass a profile-shaped row and
 * get the attributes back; `IdentityAttributes` keeps them from inventing a fifth key.
 */
const FIELDS = [
  ["user_id", "enduser.id"],
  ["instance", "instance.name"],
  ["workspace", "workspace.name"],
  ["service", "service.url"],
] as const

/** The four attributes above, and nothing else. */
export type IdentityAttributes = Partial<Record<(typeof FIELDS)[number][1], string>>

/** Map a profile row (or a login's not-yet-persisted equivalent) onto the attributes. */
export function identityAttributes(row: Record<string, unknown> | undefined): IdentityAttributes {
  if (!row) return {}
  return Object.fromEntries(
    FIELDS.flatMap(([field, attribute]) => {
      const value = row[field]
      if (typeof value === "string" && value.trim()) return [[attribute, value]]
      if (typeof value === "number" && Number.isFinite(value)) return [[attribute, String(value)]]
      return []
    }),
  )
}

let cache: { key: string; attributes: IdentityAttributes } | undefined

/**
 * Read the active profile on each operation; never cache identity on the SDK resource.
 *
 * Memoised on the profile-store FINGERPRINT rather than on a clock: this runs once per span,
 * log record and metric, so the TOML parse it used to do every time is worth avoiding — but
 * a time-based cache would hide a `user_id` that a `cz-cli sql` subprocess just wrote for
 * the length of the window, and picking that write up on the next span is how a session
 * that started without an id recovers one. The fingerprint is a read of a small file plus a
 * hash; the parse happens only when the file changed.
 */
export function profileTelemetryAttributes(): IdentityAttributes {
  const profile = current()
  const key = JSON.stringify([profileStoreFingerprint(), profile ?? null])
  if (cache?.key === key) return cache.attributes
  const attributes = identityAttributes(readProfileEntry(profile))
  cache = { key, attributes }
  return attributes
}
