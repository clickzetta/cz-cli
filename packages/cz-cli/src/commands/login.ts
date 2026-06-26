import type { Argv } from "yargs"
import { isLocalCallbackEnabled, toServiceUrl, type ConnectionConfig } from "@clickzetta/sdk"
import type { GlobalArgs } from "../cli.js"
import { error, success, EXIT_USAGE_ERROR } from "../output/index.js"
import { resolveConnectionConfig } from "../connection/config.js"
import { accountsBaseUrl } from "../connection/accounts-url.js"
import { makeProfileTokenStore, patchProfileConnection, patchProfileUserInfo } from "../connection/profile-store.js"
import { loginWithBrowser, type BrowserLoginResult } from "./login-browser.js"

interface LoginArgs extends GlobalArgs {
  browser?: boolean
}

// Dependency seam for tests: the yargs handler always uses the real imports,
// while unit tests inject fakes (a fake browser login + a fake config carrying
// a spy tokenStore) to exercise the orchestration without real network/browser.
export interface RunLoginDeps {
  loginWithBrowser?: (opts: { baseUrl: string; accountsBaseUrl: string }) => Promise<BrowserLoginResult>
  resolveConnectionConfig?: (argv: LoginArgs) => ConnectionConfig
  accountsBaseUrl?: (service: string) => string
}

/**
 * `cz-cli login` orchestration (requirement 11). Browser OAuth login is the
 * entry point: it runs when `--browser` is passed or `CZ_OAUTH_LOCAL_CALLBACK`
 * is enabled. Otherwise it prints guidance and exits with a usage error
 * WITHOUT touching the existing default login path (requirement 11.5).
 *
 * On success the token is persisted via the profile-backed tokenStore
 * (requirement 11.3) and a result is printed that MUST NOT echo the
 * access_token / refresh_token. On failure nothing is persisted (requirement
 * 11.4) and a non-zero exit code is set.
 */
export async function runLogin(argv: LoginArgs, deps: RunLoginDeps = {}): Promise<void> {
  const resolve = deps.resolveConnectionConfig ?? resolveConnectionConfig
  const doBrowserLogin = deps.loginWithBrowser ?? loginWithBrowser
  const toAccountsBaseUrl = deps.accountsBaseUrl ?? accountsBaseUrl

  const cfg = resolve(argv)
  const useBrowser = argv.browser === true || isLocalCallbackEnabled()

  if (!useBrowser) {
    error(
      "LOGIN_MODE_REQUIRED",
      "Browser login is the entry point for `cz-cli login`. Re-run with --browser or set CZ_OAUTH_LOCAL_CALLBACK=1.",
      { format: argv.format, exitCode: EXIT_USAGE_ERROR },
    )
    return
  }

  try {
    const { token, userInfo, raw } = await doBrowserLogin({
      baseUrl: toServiceUrl(cfg.service, cfg.protocol),
      accountsBaseUrl: toAccountsBaseUrl(cfg.service),
    })

    // The userinfo response may carry a different instance than the one used to
    // resolve config; prefer it so persistence lines up with reality.
    const finalInstance = userInfo?.instanceName || cfg.instance

    // Persist the logged-in connection context into the profile (requirement
    // 11.6/11.7). Best-effort, never throws.
    patchProfileConnection(argv.profile, {
      service: cfg.service,
      protocol: cfg.protocol,
      instance: finalInstance,
      workspace: userInfo?.workspace,
      schema: userInfo?.schema,
      vcluster: userInfo?.vcluster,
      userId: token.userId || undefined,
      accountId: userInfo?.accountId,
      accountName: userInfo?.accountName,
    })

    // Archive the FULL userinfo body verbatim so nothing is discarded
    // (requirement 11.9). Best-effort, never throws.
    if (raw) patchProfileUserInfo(argv.profile, raw)

    // Persist the token under the instance-only slot so a subsequent
    // resolveConnectionConfig (which keys the store on the instance) finds it.
    // We rebuild the store here because the instance may have changed from what
    // cfg.tokenStore was keyed on (requirement 11.3/11.6).
    makeProfileTokenStore(argv.profile, finalInstance).save(token)

    success(
      {
        logged_in: true,
        instance: finalInstance || null,
        workspace: userInfo?.workspace || null,
        user_id: token.userId || null,
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
    "Sign in via browser-based OAuth and persist the token to the current profile",
    (y) =>
      y.option("browser", {
        type: "boolean",
        describe: "Use browser-based OAuth login",
      }),
    async (argv) => {
      await runLogin(argv as LoginArgs)
    },
  )
}
