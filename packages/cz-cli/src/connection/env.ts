export * as ConnectionEnv from "./env"

/**
 * Single owner of the `CZ_*` connection variables.
 *
 * `CZ_*` carries two unrelated things that used to share one namespace: the
 * user's own override layer (`CZ_SCHEMA=x cz-cli sql …`, which outranks the
 * profile by design) and our own transport for whichever profile is selected
 * (expanded here, read back by this process and inherited by children). Once the
 * second wrote into the first, precedence became unknowable and callers guessed:
 * a profile's credential could lose to a value WE had injected from another
 * profile, which is how `--profile B` ended up authenticating as A.
 *
 * The fix is provenance, published rather than inferred. Every variable we write
 * is listed in `CZ_ENV_DERIVED`, so any reader — including a child process, where
 * an in-process bookkeeping table cannot reach — can tell the two apart:
 * unlisted is the user's and outranks the profile, listed is ours and loses to it.
 *
 * No other module may touch these variables; `test/connection-env-owner.test.ts`
 * enforces it.
 */

/**
 * Connection fields and the variable each travels as, in the order `apply`
 * writes them. A tuple list rather than a record so iterating it keeps the field
 * names as literals — `Object.entries` on a record widens them to `string` and
 * every read back would need a cast.
 */
const FIELDS = [
  ["pat", "CZ_PAT"],
  ["username", "CZ_USERNAME"],
  ["password", "CZ_PASSWORD"],
  ["service", "CZ_SERVICE"],
  ["protocol", "CZ_PROTOCOL"],
  ["instance", "CZ_INSTANCE"],
  ["workspace", "CZ_WORKSPACE"],
  ["schema", "CZ_SCHEMA"],
  ["vcluster", "CZ_VCLUSTER"],
  ["accountsUrl", "CZ_ACCOUNTS_URL"],
] as const

export type Field = (typeof FIELDS)[number][0]
export type Fields = Partial<Record<Field, string>>

/** Names of the variables this process derived from a profile. */
const DERIVED = "CZ_ENV_DERIVED"
const PROFILE = "CZ_PROFILE"

/**
 * The ambient `CZ_*` layers, split by who set them. `user` outranks the profile,
 * `inherited` loses to it — see the module docblock.
 */
export interface Ambient {
  readonly user: Readonly<Fields>
  readonly inherited: Readonly<Fields>
}

export function read(): Ambient {
  const derived = new Set((process.env[DERIVED] ?? "").split(",").filter((name) => name.length > 0))
  const user: Fields = {}
  const inherited: Fields = {}
  for (const [field, name] of FIELDS) {
    const value = process.env[name]
    if (!value) continue
    const target = derived.has(name) ? inherited : user
    target[field] = value
  }
  return { user, inherited }
}

/** The pinned profile name, or undefined when this process follows the default. */
export function profileName(): string | undefined {
  const value = process.env[PROFILE]
  return value && value.length > 0 ? value : undefined
}

/**
 * Replace the derived layer with `fields`, wholesale.
 *
 * Wholesale is the point: an overwrite-only update left the previous profile's
 * `CZ_SCHEMA` / `CZ_VCLUSTER` in place whenever the incoming profile omitted
 * them, and the env layer then outranked the profile that was just selected. A
 * variable we previously derived and no longer derive is therefore deleted, while
 * anything the user set is left alone — that is exactly what `CZ_ENV_DERIVED`
 * records.
 *
 * A profile may legitimately carry both a pat and a username/password, so both
 * are written when both exist; choosing between them is the resolver's job
 * (`auth_type`, then the tier order in connection/config.ts), not this layer's.
 */
export function apply(fields: Fields, profile?: string): void {
  const derived = new Set((process.env[DERIVED] ?? "").split(",").filter((name) => name.length > 0))
  const written: string[] = []
  for (const [field, name] of FIELDS) {
    // A variable the user set is not ours to write or to clear. Overwriting it
    // with the profile's value contradicted the override layer it is supposed to
    // be — `CZ_SCHEMA=x cz-cli …` only survived against profiles that happened
    // to omit `schema` — and it also relabelled the user's value as derived, so
    // the next switch deleted it.
    if (process.env[name] && !derived.has(name)) continue
    const value = fields[field]
    if (value) {
      process.env[name] = value
      written.push(name)
      continue
    }
    if (derived.has(name)) delete process.env[name]
  }
  if (written.length > 0) process.env[DERIVED] = written.join(",")
  else delete process.env[DERIVED]
  if (profile !== undefined) process.env[PROFILE] = profile
}

/** Pin the profile name without touching the derived values. */
export function pin(name: string): void {
  process.env[PROFILE] = name
}

/** Unpin the profile, leaving the process to follow `default_profile` again. */
export function unpin(): void {
  delete process.env[PROFILE]
}

/**
 * The `CZ_*` a child process should receive: the derived layer plus the pinned
 * profile name. The user's own variables are already in `process.env` and reach
 * the child through normal inheritance, so they are not repeated here.
 */
export function childEnv(): Record<string, string> {
  const result: Record<string, string> = {}
  for (const name of (process.env[DERIVED] ?? "").split(",")) {
    const value = name.length > 0 ? process.env[name] : undefined
    if (value) result[name] = value
  }
  if (Object.keys(result).length > 0) result[DERIVED] = Object.keys(result).join(",")
  const profile = profileName()
  if (profile) result[PROFILE] = profile
  return result
}
