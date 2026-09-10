import { current } from "./profile-context.js"
import { profileStoreFingerprint, readProfileEntry } from "./profile-store.js"

const FIELDS = [
  ["user_id", "enduser.id"],
  ["instance", "instance.name"],
  ["workspace", "workspace.name"],
  ["service", "service.url"],
] as const

let cache: { key: string; attributes: Record<string, string> } | undefined

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
export function profileTelemetryAttributes(): Record<string, string> {
  const profile = current()
  const key = JSON.stringify([profileStoreFingerprint(), profile ?? null])
  if (cache?.key === key) return cache.attributes
  const entry = readProfileEntry(profile)
  const attributes: Record<string, string> = entry
    ? Object.fromEntries(
        FIELDS.flatMap(([field, attribute]) => {
          const value = entry[field]
          if (typeof value === "string" && value.trim()) return [[attribute, value]]
          if (typeof value === "number" && Number.isFinite(value)) return [[attribute, String(value)]]
          return []
        }),
      )
    : {}
  cache = { key, attributes }
  return attributes
}
