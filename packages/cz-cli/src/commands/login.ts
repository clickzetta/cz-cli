import type { Argv } from "yargs"
import * as p from "@clack/prompts"
import { toServiceUrl } from "@clickzetta/sdk"
import type { GlobalArgs } from "../cli.js"
import { error, success } from "../output/index.js"
import { accountsBaseUrl } from "../connection/accounts-url.js"
import { resolveLoginTarget, type LoginTarget } from "../connection/login-target.js"
import { decodeCredential, provisionProfileFromCredential, provisionProfilesFromOAuthCombos, ProvisionError } from "../connection/provision.js"
import { enumerateOAuthCombos, type OAuthConnCombo } from "../connection/oauth-enumerate.js"
import { runAuthConfigure, SETUP_LOGIN_METHODS, type AuthConfigureArgs } from "./setup.js"
import { loginWithBrowser, type BrowserLoginResult } from "./login-browser.js"

export interface LoginArgs extends GlobalArgs {
  // Kept as a hidden no-op for backward compatibility: browser OAuth is now the
  // default entry point, so passing --browser changes nothing.
  browser?: boolean
  credential?: string
  name?: string
  "oauth-url"?: string
  partition?: string
  "login-method"?: string
  login?: string
  "account-name"?: string
  "skip-verify"?: boolean
}

// Dependency seam for tests: the yargs handler always uses the real imports,
// while unit tests inject fakes (a fake browser login) to exercise the
// orchestration without real network/browser. Note: NO resolveConnectionConfig
// seam — the browser-OAuth path deliberately never reads a profile.
export interface RunLoginDeps {
  loginWithBrowser?: (opts: { baseUrl: string; accountsBaseUrl: string }) => Promise<BrowserLoginResult>
  resolveLoginTarget?: (args: { oauthUrl?: string; partition?: string }) => Promise<LoginTarget>
  accountsBaseUrl?: (service: string) => string
  runAuthConfigure?: (argv: AuthConfigureArgs) => Promise<void>
  // Injectable enumerator (tests avoid real listUserWorkspaces network calls).
  enumerateOAuthCombos?: (input: {
    token: BrowserLoginResult["token"]
    userId: number
    tenantId: number
    instances: NonNullable<BrowserLoginResult["instances"]>
  }) => Promise<OAuthConnCombo[]>
  // Injectable session-name prompt (TTY). Returns the entered name, or undefined
  // if cancelled / non-interactive. Tests inject a fake; default uses @clack.
  promptSessionName?: () => Promise<string | undefined>
}

/** Default TTY prompt for the session name. Non-TTY → undefined (caller errors). */
async function defaultPromptSessionName(): Promise<string | undefined> {
  if (!process.stdin.isTTY) return undefined
  const result = await p.text({
    message: "Session name (names your OAuth login + its profiles, e.g. company-prod):",
    placeholder: "company-prod",
    validate: (v) => (v && v.trim().length > 0 ? undefined : "A session name is required"),
  })
  if (p.isCancel(result)) return undefined
  return String(result).trim()
}

/**
 * `cz-cli login` is the adaptive front door for authentication, dispatching by
 * argv:
 *   --credential <b64>          → new-user credential provisioning
 *   --pat / --username+password → non-interactive setup flow (CI/agents)
 *   --login-method / --login    → portal-discovery setup flow
 *   (default, no credential)    → browser OAuth: create/refresh profile,
 *                                 store the OAuth token, and configure the LLM
 *
 * The non-OAuth branches delegate to the shared {@link runAuthConfigure} so
 * `login` and the deprecated `setup` alias run one implementation. Browser
 * OAuth never echoes the access_token / refresh_token, and on failure persists
 * nothing (requirement 11.3/11.4).
 */
export async function runLogin(argv: LoginArgs, deps: RunLoginDeps = {}): Promise<void> {
  const authConfigure = deps.runAuthConfigure ?? runAuthConfigure

  // --credential: new-user credential path (equivalent to old setup --credential).
  if (argv.credential) {
    let cred: Record<string, unknown>
    try {
      cred = decodeCredential(argv.credential)
    } catch (e) {
      error("INVALID_CREDENTIAL", `Invalid base64 or JSON: ${e instanceof Error ? e.message : String(e)}`, { format: argv.format })
      return
    }
    const profileName = argv.name ?? "default"
    try {
      provisionProfileFromCredential(profileName, cred)
    } catch (e) {
      const code = e instanceof ProvisionError ? e.code : "PROFILE_EXISTS"
      error(code, e instanceof Error ? e.message : String(e), { format: argv.format })
      return
    }
    success(
      {
        logged_in: true,
        profile_name: profileName,
        instance: typeof cred.instanceName === "string" ? cred.instanceName : null,
        workspace: typeof cred.workspaceName === "string" ? cred.workspaceName : null,
      },
      { format: argv.format },
    )
    return
  }

  // Explicit non-interactive credentials or a portal-discovery signal: reuse the
  // shared setup flow (covers --pat, --username/--password, --login-method,
  // --login, and the non-TTY step protocol).
  if (argv.pat || argv.username || argv.password || argv["login-method"] || argv.login) {
    await authConfigure(argv as AuthConfigureArgs)
    return
  }

  // Default: browser OAuth.
  await runBrowserLogin(argv, deps)
}

/**
 * Default browser-OAuth path. The login target (which central OAuth entry to
 * hit) is resolved WITHOUT reading any profile — see {@link resolveLoginTarget}.
 * OAuth runs against the region-independent central host; the region-specific
 * business `service` is then read back from userinfo (gatewayMapping) and
 * written into the profile, so the profile reflects what was actually
 * authenticated rather than driving where login went. The success payload never
 * echoes tokens; on failure nothing is persisted and a non-zero exit code is set.
 */
async function runBrowserLogin(argv: LoginArgs, deps: RunLoginDeps): Promise<void> {
  const resolveTarget = deps.resolveLoginTarget ?? resolveLoginTarget
  const doBrowserLogin = deps.loginWithBrowser ?? loginWithBrowser
  const toAccountsBaseUrl = deps.accountsBaseUrl ?? accountsBaseUrl
  const enumerate = deps.enumerateOAuthCombos ?? enumerateOAuthCombos

  // Session name is required — it names the shared [oauth.<name>] token and the
  // <name>_0/_1 profile prefix, so multiple accounts don't overwrite each other.
  // If not supplied on the command line, prompt for it interactively (TTY);
  // non-interactive with no name is a hard error.
  const promptName = deps.promptSessionName ?? defaultPromptSessionName
  let sessionName = argv.name?.trim()
  if (!sessionName) {
    sessionName = (await promptName())?.trim()
  }
  if (!sessionName) {
    error(
      "SESSION_NAME_REQUIRED",
      "A session name is required. Run: cz-cli auth login <name> (e.g. cz-cli auth login company-prod). It names the shared OAuth token and the profile prefix.",
      {
        format: argv.format,
        aiMessage: "Re-run with a session name as the first argument: `cz-cli auth login <name>` (pick a short label like company-prod or personal). See `cz-cli auth login --help`.",
      },
    )
    return
  }

  try {
    const target = await resolveTarget({
      oauthUrl: argv["oauth-url"],
      partition: argv.partition,
    })

    const { token, userInfo, instances } = await doBrowserLogin({
      baseUrl: toServiceUrl(target.entryHost, target.protocol),
      accountsBaseUrl: toAccountsBaseUrl(target.entryHost),
    })

    // Prefer the region-specific business service userinfo reports (via
    // gatewayMapping). Fall back to the login entry host ONLY so a profile is
    // still written — but that central host does NOT serve SQL (/lh/submitJob),
    // so flag it: a profile with service=central host can authenticate yet fail
    // every query with a confusing 404. We surface this at login rather than let
    // it manifest as an opaque runtime error.
    const regionService = userInfo?.service
    const finalService = regionService ?? target.entryHost
    const serviceIsCentralFallback = !regionService

    // Enumerate every (instance × workspace) combination so each becomes its own
    // profile, all sharing one OAuth token. userinfo alone only knows the
    // default instance's single workspace, so this fans out listUserWorkspaces
    // per instance (best-effort: failing instances are skipped).
    let combos: OAuthConnCombo[] = []
    if (instances && instances.length > 0 && userInfo?.userId && userInfo?.tenantId) {
      combos = await enumerate({
        token,
        userId: userInfo.userId,
        tenantId: userInfo.tenantId,
        instances,
      })
    }

    // Profiles are named `<sessionName>_0/_1…` and all share the [oauth.<sessionName>]
    // token. The global --profile selects which profile to READ and must not name
    // what login WRITES. When enumeration yields nothing, provisioning falls back
    // to a single profile from userinfo alone.
    const { profiles, defaultProfile, llmConfigured } = provisionProfilesFromOAuthCombos(
      sessionName,
      combos,
      {
        token,
        userInfo,
        service: finalService,
        protocol: target.protocol,
        instance: userInfo?.instanceName,
        // The login entry host IS the OAuth issuer — persist it so the refresh
        // path targets `/oauth2/token` there, not the region service.
        issuer: target.entryHost,
      },
    )

    // Warn when the provisioned profile may not be able to run SQL, so success
    // isn't silently misleading (login reported OK but the profile is unusable).
    const warnings: string[] = []
    if (serviceIsCentralFallback) {
      warnings.push(
        `Could not resolve a region service host from your account (no gatewayMapping); the profile's service falls back to the central login host '${finalService}', which does not serve SQL. Queries will fail until an instance/region is available. Re-run login after your account has a provisioned instance.`,
      )
    }
    if (!userInfo?.instanceName && combos.length === 0) {
      warnings.push(
        "Your account has no accessible instance yet, so the profile has no instance set. Provision an instance, then re-run `cz-cli auth login`.",
      )
    }

    success(
      {
        logged_in: true,
        default_profile: defaultProfile,
        profiles,
        profile_count: profiles.length,
        user_id: token.userId || null,
        llm_configured: llmConfigured,
        expires_in_ms: token.expireTimeMs,
        ...(warnings.length ? { warnings } : {}),
      },
      { format: argv.format },
    )
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    // Preserve the structured intent of expected input errors instead of
    // flattening everything to LOGIN_FAILED: an agent must distinguish "user
    // needs to supply something" (fixable) from "the browser/network failed"
    // (retry). resolveLoginTarget throws Errors prefixed with their own code.
    const { code, aiMessage } = classifyLoginError(msg)
    error(code, msg, { format: argv.format, debug: argv.debug, aiMessage })
  }
}

/**
 * Map a login failure message to a precise error code + an agent-actionable
 * `aiMessage`. Expected input errors (target/cancel) keep their own code so
 * callers don't have to string-match; genuine runtime failures fall through to
 * LOGIN_FAILED with retry guidance.
 */
function classifyLoginError(msg: string): { code: string; aiMessage: string } {
  if (msg.startsWith("LOGIN_TARGET_REQUIRED")) {
    return {
      code: "LOGIN_TARGET_REQUIRED",
      aiMessage: "No sign-in target. Re-run with a region — `cz-cli auth login <name> --partition cn` (or intl) — or `--oauth-url <host>` for internal/self-hosted. See `cz-cli auth login --help`.",
    }
  }
  if (msg.startsWith("LOGIN_CANCELLED")) {
    return {
      code: "LOGIN_CANCELLED",
      aiMessage: "Sign-in was cancelled before completing. Re-run `cz-cli auth login <name>` to try again.",
    }
  }
  return {
    code: "LOGIN_FAILED",
    aiMessage: "Browser sign-in did not complete (network, timeout, or the authorization was not finished). Re-run `cz-cli auth login <name>`; for internal environments pass `--oauth-url <host>`. See `cz-cli auth login --help`.",
  }
}

/**
 * Register the `login [name]` command (builder + handler) onto the given yargs.
 * Shared by the `auth` group (`cz-cli auth login`) and the top-level back-compat
 * alias (`cz-cli login`), so both paths run one implementation.
 */
export function buildLoginCommand<T>(y: Argv<T>): Argv<T> {
  return y.command(
    "login [name]",
    "Sign in (browser OAuth by default) and provision the profile + token + LLM",
    (b) =>
      b
        .positional("name", {
          type: "string",
          describe: "Session name (required for OAuth) — labels this login: names the shared OAuth token [oauth.<name>] and the profile prefix <name>_0/_1, like an AWS SSO session name.",
        })
        .option("browser", {
          // Browser OAuth is now the default; kept as a hidden no-op so existing
          // `login --browser` scripts keep working.
          type: "boolean",
          hidden: true,
          describe: "Deprecated no-op: browser OAuth is the default",
        })
        .option("credential", { type: "string", describe: "Base64-encoded registration credential (new-user path)" })
        .option("name", { type: "string", describe: "Session name (same as the positional [name]); names [oauth.<name>] + profile prefix" })
        .option("oauth-url", { type: "string", describe: "Explicit OAuth sign-in entry URL (internal envs / custom domains), e.g. uat-api.clickzetta.com. Distinct from the business --service." })
        .option("partition", { type: "string", choices: ["cn", "intl"], describe: "Region to sign in to: cn (clickzetta.com) or intl (singdata.com)" })
        .option("login-method", {
          type: "string",
          choices: SETUP_LOGIN_METHODS.map((option) => option.value),
          describe: "Non-OAuth flow: choose ClickZetta, Singdata, or a custom setup",
        })
        .option("login", { type: "string", describe: "Non-OAuth flow: custom login page URL or JDBC connection string" })
        .option("account-name", { type: "string", describe: "Account name for existing ClickZetta users" })
        .option("skip-verify", { type: "boolean", default: false, describe: "Skip connection verification (non-OAuth flow)" })
        // These inherited globals are meaningless for `login` (it CREATES the
        // profile/connection, it doesn't read one), so hide them from help.
        // --profile selects which profile to READ; login writes <name>. The
        // connection-context flags are auto-discovered from userinfo.
        .option("profile", { hidden: true })
        .option("jdbc", { hidden: true })
        .option("service", { hidden: true })
        .option("protocol", { hidden: true })
        .option("instance", { hidden: true })
        .option("workspace", { hidden: true })
        .option("schema", { hidden: true })
        .option("vcluster", { hidden: true })
        // pat/username/password ARE login inputs — re-show them (the auth group
        // hides them by default). --pat is a valid non-OAuth login credential.
        .option("pat", { type: "string", hidden: false, describe: "Non-OAuth flow: Personal Access Token" })
        .option("username", { type: "string", hidden: false, describe: "Non-OAuth flow: username (with --password)" })
        .option("password", { type: "string", hidden: false, describe: "Non-OAuth flow: password (with --username)" })
        .example("cz-cli auth login company-prod", "Browser OAuth (recommended). 'company-prod' names the session; creates a profile per instance×workspace")
        .example("cz-cli auth login company-prod --partition cn", "OAuth against China (clickzetta.com); skip the region prompt")
        .example("cz-cli auth login internal --oauth-url uat-api.clickzetta.com", "OAuth against an internal/self-hosted entry")
        .example("cz-cli auth login my-profile --credential <base64>", "New user: provision a single profile from a registration credential")
        .example("cz-cli auth login my-profile --username <u> --password <p> --account-name <acct>", "Existing account, non-interactive (CI/scripts)")
        .epilogue(
          "Three ways to sign in:\n" +
          "  OAuth (default): opens a browser. <name> is the SESSION name — cz-cli\n" +
          "    discovers your instances/workspaces and creates one profile per\n" +
          "    combination (<name>_0, <name>_1, …), all sharing the [oauth.<name>] token.\n" +
          "  --credential:    provision a single profile named <name> from a token.\n" +
          "  --username/...:  existing-account flow into a single profile named <name>;\n" +
          "    cz-cli prompts for any missing step.\n\n" +
          "Note: <name> is a session name only for OAuth (it backs multiple profiles).\n" +
          "For --credential / --pat / --username it is just the single profile name.\n\n" +
          "Cookie auth is not a login: set header.Cookie in a profile directly.",
        ),
    async (argv) => {
      await runLogin(argv as unknown as LoginArgs)
    },
  )
}
