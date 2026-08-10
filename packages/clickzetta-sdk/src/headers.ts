/**
 * Case-insensitive HTTP header merging.
 *
 * `fetch` (undici) treats a plain header record as a list of `append()` calls,
 * so two keys differing only in case — e.g. the SDK's `instanceid` plus a
 * profile's `header.Instanceid` — are folded into ONE field line whose value is
 * the two values joined by `, `. The gateway then sees `instanceid: 270088,
 * 270088` and its `Integer` binding fails. RFC 9110 §5.3 forbids a sender from
 * emitting multiple field lines for a name that is not defined as a
 * comma-separated list, so the malformed request is ours, not the server's.
 *
 * Folding names to lower case is lossless: header names are case-insensitive
 * and undici lower-cases them on the wire regardless. The only behaviour change
 * is that a later source now *overrides* an earlier one instead of being
 * silently appended to it.
 */
export function mergeHeaders(
  ...sources: (Record<string, string | undefined> | undefined)[]
): Record<string, string> {
  const merged = new Map<string, string>()
  for (const source of sources) {
    for (const [name, value] of Object.entries(source ?? {})) {
      if (value === undefined) continue
      merged.set(name.toLowerCase(), value)
    }
  }
  return Object.fromEntries(merged)
}

/**
 * Read a header by name regardless of the casing the caller wrote it in.
 * Profiles carry raw user-typed header names (`Instanceid`, `instancename`),
 * so any lookup against them has to be case-insensitive.
 */
export function getHeader(
  headers: Record<string, string> | undefined,
  name: string,
): string | undefined {
  const wanted = name.toLowerCase()
  return Object.entries(headers ?? {}).find(([key]) => key.toLowerCase() === wanted)?.[1]
}
