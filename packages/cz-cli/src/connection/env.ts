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

/**
 * Write `fields` as the USER's layer — never marked in `CZ_ENV_DERIVED`, and
 * un-marking any of these names that were previously derived.
 *
 * Use this ONLY for values that are literally, exactly what a flag on THIS
 * invocation supplied — never a resolved/expanded value that merely happens
 * to equal the profile's, since the caller cannot tell the two apart once
 * resolved (see run-cli.ts's applyAgentConnectionEnv for the split that keeps
 * this true). Writing a profile-sourced value through here instead of
 * `apply()` would mislabel it as the user's and make it permanently
 * un-clearable: `apply()`'s skip-if-user-owns-it check (`!derived.has(name)`)
 * treats every name written here as never eligible for replacement again,
 * even by a later `apply()` that legitimately switches profiles.
 *
 * The un-marking matters for the same reason in the other direction: without
 * it, a name this call writes but that a PRIOR `apply()` had marked derived
 * (typical in a nested invocation — an agent session that already expanded a
 * profile, spawning `cz-cli … --schema x`) would still read back as
 * `inherited` from `read()`, ranking it below the profile it should now
 * outrank, and a later `apply()` would still delete or overwrite it as if it
 * were still derived.
 *
 * Credentials are alternatives, not independent fields: writing a pat here
 * clears any username/password this layer holds, and vice versa, so a
 * leftover from the OTHER kind can never survive to win a priority tier it
 * has no business being in.
 */
export function applyUser(fields: Fields): void {
  const derived = new Set((process.env[DERIVED] ?? "").split(",").filter((name) => name.length > 0))
  const writingPat = fields.pat !== undefined
  const writingPassword = fields.username !== undefined || fields.password !== undefined
  for (const [field, name] of FIELDS) {
    if (field === "username" || field === "password") {
      if (writingPat) {
        delete process.env[name]
        derived.delete(name)
        continue
      }
    } else if (field === "pat" && writingPassword) {
      delete process.env[name]
      derived.delete(name)
      continue
    }
    const value = fields[field]
    if (!value) continue
    process.env[name] = value
    derived.delete(name)
  }
  if (derived.size > 0) process.env[DERIVED] = [...derived].join(",")
  else delete process.env[DERIVED]
}

/** Pin the profile name without touching the derived values. */
export function pin(name: string): void {
  process.env[PROFILE] = name
}

/** Unpin the profile, leaving the process to follow `default_profile` again. */
export function unpin(): void {
  delete process.env[PROFILE]
}

