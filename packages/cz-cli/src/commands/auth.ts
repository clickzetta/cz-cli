import type { Argv } from "yargs"
import { readFileSync, mkdirSync, writeFileSync, renameSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { parse as parseTOML, stringify as stringifyTOML } from "smol-toml"
import { commandGroup } from "../command-group.js"
import type { GlobalArgs } from "../cli.js"
import { success, error } from "../output/index.js"
import { buildLoginCommand } from "./login.js"

/**
 * `cz-cli auth` — the authentication command group.
 *
 * Auth manages SESSIONS (a shared `[oauth.<name>]` token) as first-class
 * objects, mirroring AWS SSO's `sso-session`. One `login <name>` mints one
 * session plus N `<name>_*` connection profiles that all point at it. The
 * `profile` group manages those connection contexts (instance/workspace/
 * service); `auth` manages the sessions/tokens above them.
 *
 * Subcommands:
 *   auth login <name>   create/refresh a session (browser OAuth) + its profiles
 *   auth logout <name>  delete a session's [oauth.<name>] token and its profiles
 *   auth list           list sessions and how many profiles each backs
 *   auth status         show the active profile and its session/token validity
 */

function profilesPath(): string {
  const base = process.env.CLICKZETTA_TEST_HOME || homedir()
  return join(base, ".clickzetta", "profiles.toml")
}

/**
 * Hide the inherited global connection flags from `auth` help. `auth` manages
 * sessions, not a connection you read: --profile selects which profile to READ
 * (irrelevant — auth operates on sessions/tokens), and jdbc/service/instance/…
 * describe a connection auth doesn't consume. Hidden (not removed) so parsing
 * stays intact; `auth login` re-shows the few flags it genuinely uses.
 */
function hideConnectionGlobals<T>(y: Argv<T>): Argv<T> {
  // NOTE: pat/username/password are intentionally NOT hidden here — they are
  // valid `auth login` credentials and must stay visible in `auth login --help`.
  // (Hiding them at the group level wins over the subcommand's re-show, so we
  // simply don't hide them; they're harmless noise on logout/list/status.)
  return y
    .option("profile", { hidden: true })
    .option("jdbc", { hidden: true })
    .option("service", { hidden: true })
    .option("protocol", { hidden: true })
    .option("instance", { hidden: true })
    .option("workspace", { hidden: true })
    .option("schema", { hidden: true })
    .option("vcluster", { hidden: true })
}

function loadFullFile(): Record<string, unknown> {
  try {
    return parseTOML(readFileSync(profilesPath(), "utf-8")) as Record<string, unknown>
  } catch {
    return {}
  }
}

function saveFullFile(data: Record<string, unknown>): void {
  const path = profilesPath()
  mkdirSync(join(path, ".."), { recursive: true })
  const tmp = `${path}.tmp`
  writeFileSync(tmp, stringifyTOML(data), { mode: 0o600 })
  renameSync(tmp, path)
}

interface OAuthEntry {
  expire_time_ms?: number
  obtained_at?: number
  [k: string]: unknown
}

/** Milliseconds until a token expires; negative if already expired. */
function msUntilExpiry(entry: OAuthEntry | undefined): number | undefined {
  if (!entry) return undefined
  const dur = typeof entry.expire_time_ms === "number" ? entry.expire_time_ms : undefined
  const obtained = typeof entry.obtained_at === "number" ? entry.obtained_at : undefined
  if (dur === undefined || obtained === undefined || dur === 0) return undefined
  return obtained + dur - Date.now()
}

export function registerAuthCommand(cli: Argv<GlobalArgs>): void {
  cli.command(
    "auth",
    "Manage authentication sessions (OAuth tokens) and sign in",
    (yargs) => {
      const y = hideConnectionGlobals(commandGroup(yargs as Argv<GlobalArgs>, "auth"))

      // auth login <name> — registers the shared login command (builder+handler).
      buildLoginCommand(y)

      return y
        .command(
          "logout <name>",
          "Delete a session's OAuth token and all profiles that use it",
          (b) =>
            hideConnectionGlobals(b)
              .positional("name", { type: "string", demandOption: true, describe: "Session name (the [oauth.<name>] id)" })
              .option("keep-profiles", { type: "boolean", default: false, describe: "Remove only the token, keep the connection profiles" }),
          (argv) => runLogout(argv as unknown as LogoutArgs),
        )
        .command(
          "list",
          "List authentication sessions and the profiles each backs",
          (b) => hideConnectionGlobals(b),
          (argv) => runList(argv as unknown as GlobalArgs),
        )
        .command(
          "status",
          "Show the active profile and its session/token validity",
          (b) => hideConnectionGlobals(b),
          (argv) => runStatus(argv as unknown as GlobalArgs),
        )
    },
  )

  // Back-compat: keep top-level `cz-cli login` as an alias of `cz-cli auth login`.
  buildLoginCommand(cli)
}

interface LogoutArgs extends GlobalArgs {
  name: string
  "keep-profiles"?: boolean
}

function runLogout(argv: LogoutArgs): void {
  const format = argv.format
  try {
    const data = loadFullFile()
    const oauth = (data.oauth ?? {}) as Record<string, unknown>
    const profiles = (data.profiles ?? {}) as Record<string, Record<string, unknown>>
    const name = argv.name

    const hadToken = name in oauth
    // Profiles that point at this session.
    const linked = Object.keys(profiles).filter((p) => profiles[p]?.oauth === name)

    if (!hadToken && linked.length === 0) {
      return error("SESSION_NOT_FOUND", `No auth session '${name}' (no [oauth.${name}] and no profiles reference it)`, { format })
    }

    // Remove the shared token section.
    if (hadToken) delete oauth[name]
    data.oauth = oauth

    // Remove the linked profiles unless the caller opted to keep them.
    const removedProfiles: string[] = []
    if (!argv["keep-profiles"]) {
      for (const p of linked) {
        delete profiles[p]
        removedProfiles.push(p)
      }
      // Fix up default_profile if it was one of the removed ones.
      if (typeof data.default_profile === "string" && removedProfiles.includes(data.default_profile)) {
        const remaining = Object.keys(profiles)
        if (remaining.length > 0) data.default_profile = remaining[0]
        else delete data.default_profile
      }
    }
    data.profiles = profiles

    saveFullFile(data)
    success(
      {
        logged_out: true,
        session: name,
        token_removed: hadToken,
        profiles_removed: removedProfiles,
      },
      { format },
    )
  } catch (err) {
    error("INTERNAL_ERROR", err instanceof Error ? err.message : String(err), { format })
  }
}

function runList(argv: GlobalArgs): void {
  const format = argv.format
  try {
    const data = loadFullFile()
    const oauth = (data.oauth ?? {}) as Record<string, OAuthEntry>
    const profiles = (data.profiles ?? {}) as Record<string, Record<string, unknown>>
    const activeProfile = typeof data.default_profile === "string" ? data.default_profile : undefined
    const activeSession = activeProfile ? (profiles[activeProfile]?.oauth as string | undefined) : undefined

    const sessions = Object.keys(oauth).map((name) => {
      const linked = Object.keys(profiles).filter((p) => profiles[p]?.oauth === name)
      const remaining = msUntilExpiry(oauth[name])
      return {
        session: name,
        active: name === activeSession,
        profiles: linked,
        profile_count: linked.length,
        expires_in_ms: remaining ?? null,
        expired: remaining !== undefined ? remaining <= 0 : null,
      }
    })

    success({ sessions, active_session: activeSession ?? null, active_profile: activeProfile ?? null }, { format })
  } catch (err) {
    error("INTERNAL_ERROR", err instanceof Error ? err.message : String(err), { format })
  }
}

function runStatus(argv: GlobalArgs): void {
  const format = argv.format
  try {
    const data = loadFullFile()
    const oauth = (data.oauth ?? {}) as Record<string, OAuthEntry>
    const profiles = (data.profiles ?? {}) as Record<string, Record<string, unknown>>
    const activeProfile = typeof data.default_profile === "string" ? data.default_profile : undefined

    if (!activeProfile || !profiles[activeProfile]) {
      return success({ logged_in: false, active_profile: null }, { format })
    }
    const profile = profiles[activeProfile]
    const session = typeof profile.oauth === "string" ? profile.oauth : undefined
    const remaining = session ? msUntilExpiry(oauth[session]) : undefined

    success(
      {
        logged_in: Boolean(session),
        active_profile: activeProfile,
        session: session ?? null,
        instance: typeof profile.instance === "string" ? profile.instance : null,
        workspace: typeof profile.workspace === "string" ? profile.workspace : null,
        service: typeof profile.service === "string" ? profile.service : null,
        expires_in_ms: remaining ?? null,
        expired: remaining !== undefined ? remaining <= 0 : null,
      },
      { format },
    )
  } catch (err) {
    error("INTERNAL_ERROR", err instanceof Error ? err.message : String(err), { format })
  }
}
