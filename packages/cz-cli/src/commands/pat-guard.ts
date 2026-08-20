// cz_change: the `--pat` guard, shared by `login` and its deprecated `setup` alias.
//
// It lives in its own module rather than in either command because both spellings reach
// the same runAuthConfigure flow, and that flow reads no `pat` — so the same mistake must
// get the same answer whichever name the user typed. login.ts already imports setup.ts for
// runAuthConfigure, so putting it in either one would make the pair circular.
import type { GlobalArgs } from "../cli.js"
import { error, EXIT_USAGE_ERROR } from "../output/index.js"

/** The subset of argv the guard reads — every flag that counts as another credential. */
export interface PatGuardArgs extends GlobalArgs {
  name?: string
  credential?: string
  "login-method"?: string
  login?: string
}

/**
 * Handle `--pat`, which no login flow consumes. Returns true when the caller should
 * stop (the PAT was the only credential offered).
 *
 * A PAT is a stored profile credential, not a sign-in: nothing in the setup flow
 * reads it (it accepts --credential or username+password+account-name), so a PAT
 * passed here used to be dropped silently and the user got a confusing "provide
 * username, password and account_name" error. Refuse instead of pretending — but only
 * when the PAT stands alone. A wrapper that forwards `--pat "$CZ_PAT"` alongside the
 * credential it actually authenticates with has a working invocation, and turning
 * that into exit 2 would break it over an argument the flow ignores either way.
 */
export function patRefusedOrNoted(argv: PatGuardArgs, command = "login"): boolean {
  if (!argv.pat) return false
  const alone = !argv.credential && !argv.username && !argv.password && !argv["login-method"] && !argv.login
  if (alone) {
    error(
      "PAT_NOT_A_LOGIN",
      `\`${command}\` does not take --pat. A PAT is a stored profile credential, not a sign-in: `
      + `run \`cz-cli profile create ${profileNameForHint(argv.name)} --pat <token> --service <host> --instance <inst> --workspace <ws>\` instead.`,
      { format: argv.format, exitCode: EXIT_USAGE_ERROR },
    )
    return true
  }
  // stderr, so a JSON consumer on stdout is unaffected (same channel the `setup`
  // deprecation notice uses).
  process.stderr.write(
    `⚠ --pat is ignored by \`${command}\`; signing in with the other credentials given.`
    + ` Use \`cz-cli profile create <name> --pat <token>\` to store a PAT.\n`,
  )
  return false
}

/**
 * A session name safe to embed in the suggested `profile create` command line.
 *
 * The suggestion is copy-pasted (and read by agents — `aiMessage` exists in this
 * file for exactly that), so a name carrying spaces or shell metacharacters must
 * not be interpolated raw into something that reads as runnable.
 */
export function profileNameForHint(name: string | undefined): string {
  return name && /^[A-Za-z0-9_.-]+$/.test(name) ? name : "<name>"
}
