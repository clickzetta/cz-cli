import type { Argv } from "yargs"
import { toServiceUrl, type ConnectionConfig } from "@clickzetta/sdk"
import type { GlobalArgs } from "../cli.js"
import { error, success } from "../output/index.js"
import { resolveConnectionConfig } from "../connection/config.js"
import { accountsBaseUrl } from "../connection/accounts-url.js"
import { decodeCredential, provisionProfileFromCredential, provisionProfileFromOAuth, ProvisionError } from "../connection/provision.js"
import { runAuthConfigure, SETUP_LOGIN_METHODS, type AuthConfigureArgs } from "./setup.js"
import { loginWithBrowser, type BrowserLoginResult } from "./login-browser.js"

interface LoginArgs extends GlobalArgs {
  // Kept as a hidden no-op for backward compatibility: browser OAuth is now the
  // default entry point, so passing --browser changes nothing.
  browser?: boolean
  credential?: string
  name?: string
  "login-method"?: string
  login?: string
  "account-name"?: string
  "skip-verify"?: boolean
}

// Dependency seam for tests: the yargs handler always uses the real imports,
// while unit tests inject fakes (a fake browser login + a fake config carrying
// a spy tokenStore) to exercise the orchestration without real network/browser.
export interface RunLoginDeps {
  loginWithBrowser?: (opts: { baseUrl: string; accountsBaseUrl: string }) => Promise<BrowserLoginResult>
  resolveConnectionConfig?: (argv: LoginArgs) => ConnectionConfig
  accountsBaseUrl?: (service: string) => string
  runAuthConfigure?: (argv: AuthConfigureArgs) => Promise<void>
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
 * Default browser-OAuth path: run the loopback flow against the resolved
 * service, then provision the profile (create-or-refresh) + token + LLM via
 * {@link provisionProfileFromOAuth}. The success payload never echoes tokens;
 * on failure nothing is persisted and a non-zero exit code is set.
 */
async function runBrowserLogin(argv: LoginArgs, deps: RunLoginDeps): Promise<void> {
  const resolve = deps.resolveConnectionConfig ?? resolveConnectionConfig
  const doBrowserLogin = deps.loginWithBrowser ?? loginWithBrowser
  const toAccountsBaseUrl = deps.accountsBaseUrl ?? accountsBaseUrl

  const cfg = resolve(argv)

  try {
    const { token, userInfo } = await doBrowserLogin({
      baseUrl: toServiceUrl(cfg.service, cfg.protocol),
      accountsBaseUrl: toAccountsBaseUrl(cfg.service),
    })

    const { instance: finalInstance, llmConfigured } = provisionProfileFromOAuth(argv.profile ?? argv.name, {
      token,
      userInfo,
      service: cfg.service,
      protocol: cfg.protocol,
      instance: cfg.instance,
    })

    success(
      {
        logged_in: true,
        instance: finalInstance || null,
        workspace: userInfo?.workspace || null,
        user_id: token.userId || null,
        llm_configured: llmConfigured,
        expires_in_ms: token.expireTimeMs,
      },
      { format: argv.format },
    )
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    error("LOGIN_FAILED", msg, { format: argv.format, debug: argv.debug })
  }
}

export function registerLoginCommand(cli: Argv<GlobalArgs>): void {
  cli.command(
    "login",
    "Sign in (browser OAuth by default) and provision the profile + token + LLM",
    (y) =>
      y
        .option("browser", {
          // Browser OAuth is now the default; kept as a hidden no-op so existing
          // `login --browser` scripts keep working.
          type: "boolean",
          hidden: true,
          describe: "Deprecated no-op: browser OAuth is the default",
        })
        .option("credential", { type: "string", describe: "Base64-encoded registration credential (new-user path)" })
        .option("name", { type: "string", default: "default", describe: "Profile name to create/update" })
        .option("login-method", {
          type: "string",
          choices: SETUP_LOGIN_METHODS.map((option) => option.value),
          describe: "Non-OAuth flow: choose ClickZetta, Singdata, or a custom setup",
        })
        .option("login", { type: "string", describe: "Non-OAuth flow: custom login page URL or JDBC connection string" })
        .option("account-name", { type: "string", describe: "Account name for existing ClickZetta users" })
        .option("skip-verify", { type: "boolean", default: false, describe: "Skip connection verification (non-OAuth flow)" }),
    async (argv) => {
      await runLogin(argv as LoginArgs)
    },
  )
}
