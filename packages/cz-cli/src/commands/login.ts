import type { Argv } from "yargs"
import * as p from "@clack/prompts"
import { toServiceUrl } from "@clickzetta/sdk"
import type { GlobalArgs } from "../cli.js"
import { error, success, EXIT_USAGE_ERROR } from "../output/index.js"
import { patRefusedOrNoted } from "./pat-guard.js"
import { resolveLoginTarget, type LoginTarget } from "../connection/login-target.js"
import { decodeCredential, provisionProfileFromCredential, provisionProfilesFromOAuthCombos, ProvisionError } from "../connection/provision.js"
import { enumerateOAuthCombos, type OAuthConnCombo } from "../connection/oauth-enumerate.js"
import {
  getDefaultProfileName,
  oauthSessionProvisioned,
  readLastProvider,
  readSessionIssuer,
  sanitizeOAuthId,
  saveLastProvider,
} from "../connection/profile-store.js"
import { readLlmEntries } from "../llm/native-config.js"
import { runAuthConfigure, SETUP_LOGIN_METHODS, type AuthConfigureArgs } from "./setup.js"
import { loginWithBrowser } from "./login-browser.js"
import {
  DEVICE_FLOW_ENVIRONMENTS,
  DEVICE_PROVIDERS,
  deviceFlowSupported,
  deviceProviderChoices,
  loginWithDevice,
  normalizeProvider,
  TERMINAL_QR_PROVIDER_LIST,
  BROWSER_QR_PROVIDER_LIST,
  type DeviceProvider,
} from "./login-device.js"
import { discoverOAuthConfig, generateRequestId, type OAuthLoginResult } from "./oauth-userinfo.js"

export interface LoginArgs extends GlobalArgs {
  // Kept as a hidden no-op for backward compatibility: browser OAuth is now the
  // default entry point, so passing --browser changes nothing.
  browser?: boolean
  credential?: string
  name?: string
  "oauth-url"?: string
  partition?: string
  // Names the identity provider the device flow's verification page should use —
  // one of DEVICE_PROVIDERS (login-device.ts), which is where the split between the
  // scan platforms and the credential page is declared. Its PRESENCE is what selects
  // device flow over the browser: the gateway requires a provider for device
  // authorization, so "device flow" and "which provider" are one decision, not two.
  provider?: string
  "login-method"?: string
  login?: string
  "account-name"?: string
  "skip-verify"?: boolean
  "refresh-llm"?: boolean
}

// Dependency seam for tests: the yargs handler always uses the real imports,
// while unit tests inject fakes (a fake browser login) to exercise the
// orchestration without real network/browser. Note: NO resolveConnectionConfig
// seam — the browser-OAuth path deliberately never reads a profile.
export interface RunLoginDeps {
  loginWithBrowser?: (opts: { baseUrl: string }) => Promise<OAuthLoginResult>
  loginWithDevice?: (opts: {
    baseUrl: string
    provider: DeviceProvider
  }) => Promise<OAuthLoginResult>
  resolveLoginTarget?: (args: { oauthUrl?: string; partition?: string; recordedIssuer?: string }) => Promise<LoginTarget>
  runAuthConfigure?: (argv: AuthConfigureArgs) => Promise<void>
  // Injectable enumerator (tests avoid real listUserWorkspaces network calls).
  enumerateOAuthCombos?: (input: {
    token: OAuthLoginResult["token"]
    userId: number
    tenantId: number
    instances: NonNullable<OAuthLoginResult["instances"]>
  }) => Promise<OAuthConnCombo[]>
  // Injectable session-name prompt (TTY). Returns the entered name, or undefined
  // if cancelled / non-interactive. Tests inject a fake; default uses @clack.
  promptSessionName?: () => Promise<string | undefined>
  // Injectable provider menu (TTY, no --provider). Resolves to the chosen device
  // provider, to "browser" for the loopback flow, or to undefined when the user
  // aborted. Note the three-way result: "aborted" must stay distinguishable from
  // "chose the browser", or an Esc would silently sign the user in through the
  // very flow they were trying to get away from.
  // `remembered` is the stored route from a previous login (see readLastProvider);
  // it is declared here because a seam that omits it lets the caller drop it
  // silently — the preselection would just stop working with nothing failing.
  promptProvider?: (
    choices: Array<{ label: string; value: DeviceProvider }>,
    remembered?: string,
  ) => Promise<DeviceProvider | "browser" | undefined>
  // Injectable capability probe: does this OAuth entry advertise device
  // authorization? Only consulted to decide whether the menu is worth showing.
  deviceFlowAvailable?: (baseUrl: string) => Promise<boolean>
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
 * Default provider menu: the browser loopback first (it is the historical default,
 * so Enter keeps doing what it always did), then the scan platforms in the order
 * `--provider` advertises them.
 *
 * `password` is deliberately NOT offered. From the user's side it is the same act
 * as the browser option — open a page on this machine and type a ClickZetta
 * username and password — and the difference (a device-code poll instead of a
 * loopback callback) is the one thing they have no way to judge. Two menu entries
 * that read alike and behave alike is a worse question than one. It stays reachable
 * as `--provider password` for the narrow case that wants it: no third-party
 * identity to scan with AND a loopback the network breaks.
 *
 * `initial` preselects the route this session used last, so a re-login is one Enter
 * rather than the same choice made again. It is validated against the offered
 * options before use: a remembered route can stop being on the menu (`password` did
 * exactly that), and pointing @clack at an absent value highlights nothing.
 *
 * Returns "browser" for the loopback flow and undefined only when the user aborted.
 * Collapsing those two into one value is the mistake this shape exists to prevent:
 * an Esc would then be indistinguishable from choosing the browser, and the user
 * would be signed in through the flow they just declined.
 */
async function defaultPromptProvider(
  choices: Array<{ label: string; value: DeviceProvider }>,
  initial?: string,
): Promise<DeviceProvider | "browser" | undefined> {
  const options: Array<{ label: string; value: DeviceProvider | "browser" }> = [
    { label: "Browser sign-in (this machine)", value: "browser" },
    ...choices,
  ]
  const chosen = await p.select<DeviceProvider | "browser">({
    message: "How do you want to sign in?",
    options,
    initialValue: preselectedProvider(
      options.map((option) => option.value),
      initial,
    ),
  })
  if (p.isCancel(chosen)) return undefined
  return chosen
}

/**
 * Which stored route may be preselected, given what the menu actually offers.
 *
 * A remembered route outlives the menu it was written for: `password` was offerable
 * once and is not any more, and a stored value can predate a rename. Handing @clack
 * a value absent from its options highlights nothing, so an unofferable hint has to
 * degrade to "no preselection" and let the menu use its own first entry.
 */
export function preselectedProvider(
  values: Array<DeviceProvider | "browser">,
  remembered?: string,
): DeviceProvider | "browser" | undefined {
  return values.find((value) => value === remembered)
}

/**
 * Does this OAuth entry advertise device authorization?
 *
 * Consulted only to decide whether showing the menu is honest: an entry without
 * the endpoint has exactly one usable option, and offering four QR platforms that
 * all end in DEVICE_FLOW_UNSUPPORTED is worse than not asking. A discovery failure
 * answers "no" rather than throwing — the browser flow rediscovers the same
 * metadata a moment later and reports the failure with its own request id, so
 * failing here would only replace that error with a less specific one.
 */
async function defaultDeviceFlowAvailable(baseUrl: string): Promise<boolean> {
  // A network round trip stands between the user's last keystroke and the menu.
  // Unannounced it reads as the CLI having hung, so say what is being waited on.
  const spinner = p.spinner()
  spinner.start("Checking which sign-in methods this environment offers")
  try {
    const config = await discoverOAuthConfig(baseUrl, generateRequestId())
    // login-device.ts's own predicate, not a second reading of the metadata: the
    // two answers have to be the same one, or the menu offers a route the flow
    // then refuses.
    const available = deviceFlowSupported(config.serverMetadata())
    spinner.stop(available ? "Sign-in methods available" : "Only browser sign-in is available here")
    return available
  } catch {
    // The browser flow rediscovers the same metadata moments later and reports the
    // failure with its own request id, so this stays a downgrade, not an error.
    spinner.stop("Could not check for QR sign-in; continuing with browser sign-in")
    return false
  }
}

/**
 * `cz-cli login` is the adaptive front door for authentication, dispatching by
 * argv:
 *   --credential <b64>       → new-user credential provisioning
 *   --username+password      → non-interactive setup flow (CI/agents)
 *   --login-method / --login → portal-discovery setup flow
 *   --pat (alone)            → refused: a PAT is a profile credential, not a
 *                              sign-in, and no flow here consumes it
 *   (default, no credential) → browser OAuth: first login provisions profiles +
 *                              token + LLM; a re-login refreshes only the token
 *                              (see {@link OAuthProvisionInput.relogin})
 *
 * The non-OAuth branches delegate to the shared {@link runAuthConfigure} so
 * `login` and the deprecated `setup` alias run one implementation. Browser
 * OAuth never echoes the access_token / refresh_token, and on failure persists
 * nothing (requirement 11.3/11.4).
 */
export async function runLogin(argv: LoginArgs, deps: RunLoginDeps = {}): Promise<void> {
  const authConfigure = deps.runAuthConfigure ?? runAuthConfigure

  // The two --pat checks come FIRST so every branch below is covered by one of them:
  // --credential returns without reaching the dispatch, so a `--credential … --pat …`
  // used to drop the PAT with neither the refusal nor the notice.
  if (patRefusedOrNoted(argv)) return

  // Ahead of --credential for the same reason the --pat guard is: that branch
  // returns without reaching the dispatch, so a conflict checked later would miss
  // it entirely.
  if (providerConflictRefused(argv)) return

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
  // shared setup flow (covers --username/--password, --login-method, --login,
  // and the non-TTY step protocol).
  if (argv.username || argv.password || argv["login-method"] || argv.login) {
    // Default the profile name like the deprecated `setup` alias does (its --name
    // carries `default: "default"`). Without this the setup flow keys the profile
    // by `undefined`, writing a literal "undefined" profile and making it the
    // default_profile — the credential branch above already defaults the same way.
    // Applies to every flag in the condition above, not just --username/--password: with
    // `--login-method`/`--login` and no [name], the profile used to be keyed by the literal
    // string "undefined" (the bug) and now resolves to `default`. Consequence worth naming:
    // on a machine that already has a `default` profile, such a run now fails at the end of
    // the step protocol with PROFILE_EXISTS from saveProfile, where before it "succeeded"
    // by writing the garbage-named row. The fast-fail in runAuthConfigure deliberately does
    // not cover this shape — an incomplete credential set is mid-protocol and must keep
    // getting its SETUP_INPUT_REQUIRED steps — so the failure stays at the end.
    const name = argv.name ?? "default"
    // The collision this name can hit (a `default` profile already existing) is checked
    // inside runAuthConfigure, which both this command and the `setup` alias reach — see
    // the non-TTY fast-fail there. Duplicating it here would have covered only one of the
    // two entry points and keyed it on the literal "default" rather than on the name the
    // flow actually uses.
    await authConfigure({ ...argv, name } as AuthConfigureArgs)
    return
  }

  // Default: OAuth. --provider selects QR/device flow, otherwise the browser.
  await runOAuthLogin(argv, deps)
}


/**
 * Refuse `--provider` alongside a flag that routes to a different login flow.
 * Returns true when the caller should stop.
 *
 * The dispatch below is ordered, so a `--provider` passed with `--username` or
 * `--credential` never reaches OAuth: it is dropped, and the user gets whatever
 * error the OTHER flow produces (typically `SETUP_INPUT_REQUIRED` asking for an
 * account name), with no hint that the flag they cared about was ignored.
 *
 * `--provider password` makes this a likely mistake rather than a rare one — the
 * value shares its name with the `--password` flag while meaning the opposite:
 * the credentials are typed into the gateway's verification page, never handed to
 * this CLI. Naming the conflict is the only way the user learns which of the two
 * they actually invoked.
 *
 * The provider is echoed back only when it looks like one of the advertised
 * spellings: the message reads as a runnable command line, and `runLogin` is
 * reachable without yargs' `choices` (tests, the MCP surface). Same concern as
 * `profileNameForHint` in pat-guard.ts.
 */
function providerConflictRefused(argv: LoginArgs): boolean {
  if (!argv.provider) return false
  const conflicts = (
    [
      ["--credential", argv.credential],
      ["--username", argv.username],
      ["--password", argv.password],
      ["--login-method", argv["login-method"]],
      ["--login", argv.login],
    ] as const
  )
    .filter(([, value]) => value)
    .map(([flag]) => flag)
  if (conflicts.length === 0) return false

  error(
    "LOGIN_FLOW_CONFLICT",
    `--provider selects the device flow, which cannot be combined with ${conflicts.join(", ")}. `
    + `Device sign-in sends you to the gateway's own page and the CLI never sees a credential — `
    + `drop --provider to sign in with the flags above, or drop them to use `
    + `--provider ${/^[a-z]+$/.test(argv.provider) ? argv.provider : "<provider>"}.`,
    { format: argv.format, exitCode: EXIT_USAGE_ERROR },
  )
  return true
}

/**
 * Default OAuth path, in either of its two flavours. The login target (which
 * central OAuth entry to hit) is resolved WITHOUT reading any profile — see
 * {@link resolveLoginTarget}. OAuth runs against the region-independent central
 * host; the region-specific business `service` is then read back from userinfo
 * (gatewayMapping) and written into the profile, so the profile reflects what was
 * actually authenticated rather than driving where login went. The success payload
 * never echoes tokens; on failure nothing is persisted and a non-zero exit code is
 * set.
 *
 * `--provider` swaps ONLY how the authorization is obtained (QR scan instead of a
 * browser redirect). Everything downstream — instance/workspace enumeration,
 * profile provisioning, LLM config, warnings, the success payload — is shared, so
 * a device login and a browser login of the same account provision identically.
 */
async function runOAuthLogin(argv: LoginArgs, deps: RunLoginDeps): Promise<void> {
  const resolveTarget = deps.resolveLoginTarget ?? resolveLoginTarget
  const doBrowserLogin = deps.loginWithBrowser ?? loginWithBrowser
  const doDeviceLogin = deps.loginWithDevice ?? loginWithDevice
  const enumerate = deps.enumerateOAuthCombos ?? enumerateOAuthCombos
  const promptProvider = deps.promptProvider ?? defaultPromptProvider
  const probeDeviceFlow = deps.deviceFlowAvailable ?? defaultDeviceFlowAvailable

  // Session name is required — it names the shared [oauth.<name>] token and the
  // <name>_<workspace>_<instance> profile prefix, so multiple accounts don't overwrite
  // each other.
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

  const oauthId = sanitizeOAuthId(sessionName)

  // Declared outside the try so the catch can tell which flow actually ran. It is
  // not the same question as `argv.provider`: the interactive menu sets this while
  // argv stays empty, and a failure there is a device failure to report.
  let provider: DeviceProvider | undefined

  try {
    // Validated before anything touches the network so a typo'd platform costs
    // one line of output rather than a discovery round trip.
    provider = argv.provider ? normalizeProvider(argv.provider) : undefined

    // Every device provider needs a human at the keyboard: a phone to scan with,
    // or a browser to open the password page in, plus the interactive choice in
    // the multi-account case. Refuse up front rather than printing a code into a
    // log file nobody is watching and then hanging until it expires.
    if (provider && !process.stdin.isTTY) {
      throw new Error(
        "DEVICE_LOGIN_REQUIRES_TTY: device sign-in needs an interactive terminal (a human opens the page this prints)",
      )
    }

    const target = await resolveTarget({
      oauthUrl: argv["oauth-url"],
      partition: argv.partition,
      // A re-login signs back in where this session already lives, so it asks no region
      // question. Keyed by the session name the user typed, and read from the session's
      // own token section — not from a profile's `service`, which login-target.ts refuses
      // for good reason (readSessionIssuer spells out why they are different facts).
      // undefined on a first login, and also when `logout --keep-profiles` removed the
      // section while leaving the rows: `relogin` is true there but there is no recorded
      // issuer, and falling back to the prompt is the honest answer.
      recordedIssuer: readSessionIssuer(oauthId),
    })

    // The resolved entry host IS the OAuth issuer: every endpoint (authorize,
    // token, userinfo) is discovered from it, so no accounts/sign-in host is
    // derived here — the server's own metadata decides where the browser goes.
    // This is why `--partition` resolves to a REGION host: only those declare a
    // self-referential issuer, which RFC 8414 requires (login-target.ts).
    const baseUrl = toServiceUrl(target.entryHost, target.protocol)

    // No --provider, but a human is watching: offer the choice instead of silently
    // assuming the browser. Gated on the entry actually advertising device
    // authorization, so the menu never lists scan options that all end in
    // DEVICE_FLOW_UNSUPPORTED — an entry without the endpoint has one usable flow
    // and nothing to ask about.
    //
    // Non-TTY is deliberately untouched: a pipeline keeps resolving to the browser
    // flow rather than blocking on a menu nobody can answer. And the check is on
    // `argv.provider`, not on `provider`, so an explicit flag always skips the menu.
    if (!argv.provider && process.stdin.isTTY && (await probeDeviceFlow(baseUrl))) {
      // Which routes the menu lists is PROVIDER_WIRE's `offerInMenu`, not its `scan`
      // flag: see login-device.ts for why those are two decisions. `password` is off
      // it because it reads and behaves like the browser option from the user's side
      // — see defaultPromptProvider — and stays available as `--provider password`.
      const chosen = await promptProvider(
        deviceProviderChoices().filter((choice) => choice.offerInMenu),
        readLastProvider(sanitizeOAuthId(sessionName)),
      )
      // Abort is NOT "chose the browser". Falling through here would sign the user
      // in through the flow they just backed out of, which is worse than any error.
      if (chosen === undefined) {
        error("LOGIN_CANCELLED", "Sign-in cancelled at the provider choice. Nothing was written.", {
          format: argv.format,
          aiMessage:
            `The user aborted the interactive provider menu; no token or profile was written. Re-run \`cz-cli auth login <name>\`, or pass --provider <${DEVICE_PROVIDERS.join("|")}> to skip the menu.`,
        })
        return
      }
      if (chosen !== "browser") provider = chosen
    }

    const { token, userInfo, instances } = provider
      ? await doDeviceLogin({ baseUrl, provider })
      : await doBrowserLogin({ baseUrl })

    // Prefer the region-specific business service userinfo reports (via
    // gatewayMapping). Fall back to the login entry host ONLY so a profile is
    // still written, and flag it: the fallback means the account has no resolved
    // region, so the profile is not known to be able to run SQL even though the
    // entry host is itself a region host. We surface this at login rather than
    // let it manifest as an opaque runtime error.
    const regionService = userInfo?.service
    const finalService = regionService ?? target.entryHost
    const serviceIsEntryFallback = !regionService

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

    // Profiles are named `<sessionName>_<workspace>_<instance>` and all share the
    // [oauth.<sessionName>] token. The global --profile selects which profile to READ and
    // must not name what login WRITES. When enumeration yields nothing, provisioning falls
    // back to a single profile from userinfo alone.
    const { profiles, cookiePinned, defaultProfile, relogin, llmConfigured, llmAction, created, renamed, stale } = provisionProfilesFromOAuthCombos(
      sessionName,
      combos,
      {
        refreshLlm: Boolean(argv["refresh-llm"]),
        serviceIsEntryFallback,
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

    // Remember the route for the next re-login's menu. Only on the success path: a
    // route that failed is not one to preselect. Must run AFTER provisioning:
    // provisionProfilesFromOAuthCombos replaces `[oauth.<id>]` wholesale without
    // going through writeOAuthEntry, so a hint saved before it would be erased.
    saveLastProvider(sanitizeOAuthId(sessionName), provider ?? "browser")

    // Warn when the provisioned profile may not be able to run SQL, so success
    // isn't silently misleading (login reported OK but the profile is unusable).
    const warnings: string[] = []
    // The same session name was pointed at a different OAuth host than the one it was last
    // minted against. The flag wins — it is the more explicit intent — but the consequence
    // is not local to the token: `[oauth.<id>]` is ONE section, so the new token replaces
    // the old one under every `<name>_*` profile row, whose `service`/instance/workspace
    // still describe the old environment. Rows this login's enumeration does not reach keep
    // pointing at the old region with a token minted by the new one.
    if (target.supersededIssuer) {
      warnings.push(
        `Session '${sessionName}' was last signed in to '${target.supersededIssuer}', but this login went to '${target.entryHost}'. They share one token section, so the profiles under this session now carry a token from a different environment than the one their 'service' names. Use a separate session name per environment (\`cz-cli auth login <name-for-this-env>\`), or \`cz-cli auth logout ${sessionName}\` first to start clean.`,
      )
    }
    if (serviceIsEntryFallback) {
      warnings.push(
        `Could not resolve a region service host from your account (no gatewayMapping); the profile's service falls back to the login entry host '${finalService}'. That entry serves OAuth, but it is not confirmed to be your account's data region, so queries may fail. Re-run login after your account has a provisioned instance.`,
      )
    }
    if (!userInfo?.instanceName && combos.length === 0) {
      warnings.push(
        "Your account has no accessible instance yet, so the profile has no instance set. Provision an instance, then re-run `cz-cli auth login`.",
      )
    }
    // A re-login writes no llm.json — that is the point (its api_key may be a
    // gateway virtual key the quota flow swapped in). But then a session whose
    // FIRST login had no apiKey to write, or that predates LLM auto-config, would
    // silently stay without an entry forever, and the omitted `llm_configured`
    // hides it. Say so instead: the write is skipped by design, the missing entry
    // is not.
    // A row pinned to cookie auth ignores the token this login just minted: the pin keeps
    // the Cookie header and withholds the OAuth token store. Both fields are the user's,
    // so say the login was a no-op for those rows instead of overwriting either.
    // A rename is silent from the user's side otherwise: `default_profile` follows the row
    // (provisioning carries it), but a `--profile <old>` in their own script or shell alias
    // does not, and it will fail with a name that simply no longer exists.
    if (renamed.length > 0) {
      warnings.push(
        `Renamed ${renamed.length === 1 ? "a profile" : `${renamed.length} profiles`} to follow a workspace or instance renamed on the server: ${renamed
          .map((r) => `${r.from} → ${r.to}`)
          .join(", ")}. Profile names are derived from the connection, so the old names are gone; default_profile was updated for you, but update any script or alias that passes --profile.`,
      )
    }
    // Not deleted, because "the server did not list it" cannot be told apart from "that
    // instance's workspace listing failed this time" — oauth-enumerate.ts swallows the
    // latter per instance. Saying nothing was the old behavior, and it meant a renamed
    // workspace quietly left a second row behind forever.
    if (stale.length > 0) {
      warnings.push(
        `These profiles belong to this session but describe no connection this login found: ${stale.join(", ")}. A workspace or instance may have been renamed or removed, that instance may simply have failed to list this time, or the row may be the instance-less '${sessionName}' one written back when the account had no instance yet. They are left untouched — a transient listing failure looks identical from here — so remove one with \`cz-cli profile delete <name>\` once you know it is really gone.`,
      )
    }
    if (cookiePinned.length > 0) {
      warnings.push(
        `These profiles pin auth_type = "cookie", so they keep authenticating with their stored cookie and will not use the token this login refreshed: ${cookiePinned.join(", ")}. Clear the pin (\`cz-cli profile set <name> auth_type ""\`) or remove their header.Cookie to switch them to OAuth.`,
      )
    }
    // The session name is stored sanitized ([A-Za-z0-9_-]), so two names differing only in
    // punctuation share one token section while keeping separate profile prefixes — and
    // the second one is then classified as a re-login of the first. Say so rather than
    // silently treating a new session as an old one.
    if (sanitizeOAuthId(sessionName) !== sessionName) {
      warnings.push(
        `Session name '${sessionName}' is stored as '${sanitizeOAuthId(sessionName)}' in the token section (only letters, digits, _ and - are kept), so a name differing from it only in punctuation would share this login's token and be treated as the same session. Prefer a name that needs no rewriting.`,
      )
    }
    const llmEntryId = sanitizeOAuthId(sessionName)
    const llmEntries = readLlmEntries().llm
    // The legacy key too: `configureClickzettaLlm`'s legacyName migration renames a
    // `<base>_0`-keyed entry to the session id, and it only runs on a first login —
    // so a user still holding the pre-rename entry has a working LLM and must not be
    // told otherwise on every future re-login. A warning that cannot be acted on
    // teaches people to ignore warnings.
    // Three keys a working entry can sit under: this session's id, the `<base>_0`
    // key the combos path renamed from, and the RAW session name the zero-combos
    // fallback used before it was sanitized (`my.prod`, not `my_prod`). Both legacy
    // shapes only migrate inside configureClickzettaLlm, which a re-login skips, so
    // checking just the current key would warn forever at a user whose LLM works.
    const llmEntryExists = Boolean(llmEntries[llmEntryId] ?? llmEntries[`${sessionName}_0`] ?? llmEntries[sessionName])
    // Gated on what the provisioner DID, not on `relogin`: with --refresh-llm and no
    // apiKey in userinfo the write was attempted at the user's request and failed for
    // an unrelated reason, and this message's "a re-login deliberately does not write
    // it" would contradict the `no_api_key` in the same payload.
    if (llmAction === "skipped_relogin" && !llmEntryExists) {
      warnings.push(
        `No LLM entry named '${llmEntryId}' in llm.json, and a re-login deliberately does not write it (an existing api_key may be a gateway key you provisioned). If the agent reports NO_LLM_CONFIGURED, add one with \`cz-cli agent llm add\` or \`cz-cli ai-gateway key create\`, or re-run this login with --refresh-llm to write it from the account's key.`,
      )
    }

    success(
      {
        logged_in: true,
        // Which flow proved the identity. An agent reading this back can tell a
        // QR sign-in from a browser one without re-deriving it from argv.
        login_method: provider ? "device" : "browser",
        relogin,
        // Unchanged meaning: what profiles.toml says, i.e. the profile bare commands
        // will use. A re-login normally does not write it, so it can name another
        // session's profile — which is why the session-scoped answer is a separate key
        // rather than a redefinition of this one.
        default_profile: getDefaultProfileName() ?? defaultProfile,
        session_default_profile: defaultProfile,
        profiles,
        profile_count: profiles.length,
        // Which profiles this run actually created — on a re-login the interesting
        // number, since the rest were left as the user had them.
        profiles_created: created,
        // Old → new for every row this login moved. A caller that stored a profile name
        // (or a human with an alias) needs the mapping, not just the new list.
        profiles_renamed: renamed,
        // Owned rows this run's enumeration did not reach. Reported, never auto-deleted.
        profiles_stale: stale,
        user_id: token.userId || null,
        // Stays a plain boolean: a truthy third value ("not_attempted") would make
        // every `jq -e .llm_configured` / `if payload["llm_configured"]` written
        // against the old shape answer "LLM ready" for a run that never looked, and
        // omitting the key moves the ambiguity onto the parser. `false` at least
        // fails safe. Which KIND of false it is goes in its own key, so no existing
        // reader changes answer.
        llm_configured: llmConfigured,
        // Reported by the provisioner, not re-derived here: the same rule expressed
        // twice drifted the moment a provisioning path (the zero-combos early return)
        // answered differently from what argv alone predicts.
        llm_configuration: llmAction,

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
    // `provider`, not `argv.provider`: a route chosen from the menu leaves argv
    // empty, and blaming a browser window that never opened sends the user looking
    // for the wrong thing. Matches `login_method` in the success payload.
    const { code, aiMessage } = classifyLoginError(msg, provider ? "device" : "browser")
    error(code, msg, { format: argv.format, debug: argv.debug, aiMessage })
  }
}

/** Shared by the three codes that all mean "the gateway answered in a shape we do not handle". */
const SERVER_SHAPE_ADVICE =
  "The gateway's device sign-in endpoints answered in a shape this CLI does not handle, so retrying will not help. Report the error text; meanwhile drop --provider and use browser sign-in."

/**
 * Failure-message prefixes that ARE their own error code, each mapped to the
 * advice that code needs.
 *
 * A table rather than a run of near-identical `if (msg.startsWith(X)) return { code:
 * X, … }` branches: the code and the prefix are the same string, so the branch form
 * spelled every one of them twice and invited a third spelling to drift in. The
 * throwers (`login-device.ts`, `device-account-select.ts`, `resolveLoginTarget`)
 * document these prefixes as their contract with this function.
 *
 * Matched in insertion order by `startsWith`; no key is a prefix of another, so the
 * order is not load-bearing today — keep it that way when adding one.
 */
const LOGIN_ERROR_ADVICE: Record<string, string> = {
  DEVICE_PROVIDER_INVALID: `Unknown --provider. Use one of: ${DEVICE_PROVIDERS.join(", ")}. Omit --provider entirely for browser sign-in.`,
  DEVICE_LOGIN_REQUIRES_TTY:
    "Device sign-in cannot run non-interactively — it prints a page for a human to open. In CI/agent contexts use `cz-cli auth login <name> --credential <base64>` or `--username/--password/--account-name` instead.",
  DEVICE_FLOW_UNSUPPORTED:
    `That OAuth entry does not advertise the endpoints QR sign-in needs, so it is unavailable there and retrying will not help — ${DEVICE_FLOW_ENVIRONMENTS}, so a custom --oauth-url host is the likely cause (e.g. use \`--partition cn\`). Drop --provider and use browser sign-in there.`,
  DEVICE_CODE_EXPIRED: "The sign-in code expired before the scan completed. Re-run the same command to get a fresh code.",
  DEVICE_AUTHORIZATION_DENIED: "The sign-in was declined on the phone. Re-run the command and approve the request to continue.",
  // Endpoint derivation and unrecognised device states are server-shape problems,
  // not user input: say so instead of advising a retry that will fail identically.
  DEVICE_ENDPOINT_UNDERIVABLE: SERVER_SHAPE_ADVICE,
  DEVICE_STATUS_UNEXPECTED: SERVER_SHAPE_ADVICE,
  // An OK response that is not a JSON object at all — `null`, a bare string, an
  // array. Its own code rather than folded into UNEXPECTED: that one names a device
  // state the server reported, and claiming a state was reported by a response we
  // could not read is how this used to be misdiagnosed.
  DEVICE_STATUS_UNREADABLE: SERVER_SHAPE_ADVICE,
  // NOT the shape advice, which it used to share: this code means the gateway
  // answered and refused, and the message carries the server's own reason. Whether
  // a retry helps depends on that reason, so quote it rather than ruling one out.
  DEVICE_STATUS_FAILED:
    "The gateway refused the device sign-in and its reason is in the error text — quote that reason to the user rather than a generic retry. A rejected account choice or a dropped device session both need a fresh `cz-cli auth login <name>`; a reason naming the identity (not yet bound, registration incomplete) has to be resolved on the gateway's own page first.",
  // A transient transport failure, kept apart from DEVICE_STATUS_FAILED precisely
  // because the advice is the opposite one. The poll loop already waits these out
  // for as long as the device code lives, so reaching here means it outlasted the
  // code or the failure hit the one-shot account commit.
  DEVICE_STATUS_UNAVAILABLE:
    "The gateway was unreachable or erroring (5xx/network), which is temporary and unrelated to the sign-in itself. Re-run `cz-cli auth login <name>` — a fresh code will be issued. If it keeps failing, check network/proxy reachability of the OAuth host before changing anything about the command.",
  LOGIN_TARGET_REQUIRED:
    "No sign-in target. Re-run with a region — `cz-cli auth login <name> --partition cn` (or intl) — or `--oauth-url <host>` for internal/self-hosted. See `cz-cli auth login --help`.",
  LOGIN_CANCELLED: "Sign-in was cancelled before completing. Re-run `cz-cli auth login <name>` to try again.",
}

/**
 * Map a login failure message to a precise error code + an agent-actionable
 * `aiMessage`. Expected input errors (target/cancel) keep their own code so
 * callers don't have to string-match; genuine runtime failures fall through to
 * LOGIN_FAILED with retry guidance.
 *
 * `flow` only shapes the generic fallback advice: telling someone whose QR scan
 * timed out to re-open a browser sends them looking for a window that never
 * opened. The codes in LOGIN_ERROR_ADVICE are recognised regardless. It has no
 * default — the single caller knows which flow ran, and a default would silently
 * answer "browser" for a device failure if a second caller ever forgot it.
 */
function classifyLoginError(msg: string, flow: "browser" | "device"): { code: string; aiMessage: string } {
  for (const [code, aiMessage] of Object.entries(LOGIN_ERROR_ADVICE)) {
    if (msg.startsWith(code)) return { code, aiMessage }
  }
  // A callback timeout is not a generic failure: the browser could not reach our
  // loopback listener, which in practice means something is intercepting local
  // traffic. Naming the usual culprits saves the user a blind retry loop.
  if (msg.includes("timed out waiting for authorization callback")) {
    return {
      code: "LOGIN_CALLBACK_TIMEOUT",
      aiMessage:
        "The browser never delivered the redirect to the local callback. Common causes: a proxy in TUN/enhanced mode (Clash, Surge, sing-box), a VPN, or a firewall intercepting 127.0.0.1. Add 127.0.0.1 to the proxy's bypass rules or disable the proxy, then re-run `cz-cli auth login <name>`. If you completed sign-in in the browser, re-run and paste the address-bar URL when prompted.",
    }
  }
  // Discovery/transport failures are NOT "the user didn't finish signing in", and
  // telling them to retry is actively wrong — a host that doesn't resolve, or a
  // metadata document that names someone else as issuer, will fail identically
  // forever. These reach us as `oauth_error` with the reason pulled out of the
  // error's cause chain (oauth-error.ts:causeDetail).
  if (msg.includes("ENOTFOUND") || msg.includes("EAI_AGAIN")) {
    return {
      code: "LOGIN_ENTRY_UNREACHABLE",
      aiMessage:
        "The OAuth host could not be resolved by DNS, so no sign-in request was made. Retrying will not help. Check network/DNS, or pass a reachable host with `--oauth-url <host>`.",
    }
  }
  if (msg.includes("ECONNREFUSED") || msg.includes("UND_ERR_CONNECT_TIMEOUT") || msg.includes("ECONNRESET")) {
    return {
      code: "LOGIN_ENTRY_UNREACHABLE",
      aiMessage:
        "The OAuth host resolved but the connection failed (refused, reset, or timed out) — often a proxy or firewall. Verify the host is reachable, then re-run; for internal environments pass `--oauth-url <host>`.",
    }
  }
  if (msg.includes("issuer mismatch")) {
    return {
      code: "LOGIN_ISSUER_MISMATCH",
      aiMessage:
        "The host served an OAuth metadata document that declares a DIFFERENT issuer, which RFC 8414 forbids and the client rejects. This host cannot be used as a sign-in entry — use the issuer the document names (or `--partition cn|intl`, which pins hosts known to be valid).",
    }
  }
  return {
    code: "LOGIN_FAILED",
    aiMessage:
      flow === "device"
        ? "QR sign-in did not complete (network, an expired code, or the scan was not finished). Re-run `cz-cli auth login <name> --provider <platform>`; for internal environments pass `--oauth-url <host>`. See `cz-cli auth login --help`."
        : "Browser sign-in did not complete (network, timeout, or the authorization was not finished). Re-run `cz-cli auth login <name>`; for internal environments pass `--oauth-url <host>`. See `cz-cli auth login --help`.",
  }
}

/**
 * Help text for the session name, shared by the `[name]` positional and its
 * `--name` flag spelling — see the comment at the `.option("name")` call below
 * for why they cannot differ.
 */
const SESSION_NAME_DESCRIBE =
  "Session name — required for browser OAuth (prompted in a TTY if omitted), and 'default' when omitted with --credential/--username. Labels this login: names the shared OAuth token [oauth.<name>] and the profile prefix <name>_<workspace>_<instance>, like an AWS SSO session name. Accepted as the positional or as --name."

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
        .positional("name", { type: "string", describe: SESSION_NAME_DESCRIBE })
        .option("browser", {
          // Browser OAuth is now the default; kept as a hidden no-op so existing
          // `login --browser` scripts keep working.
          type: "boolean",
          hidden: true,
          describe: "Deprecated no-op: browser OAuth is the default",
        })
        .option("credential", { type: "string", describe: "Base64-encoded registration credential (new-user path)" })
        // `--name` is the flag spelling of the positional. It MUST share the
        // positional's describe: yargs keys help text by name, so whichever of the
        // two is registered last wins the Positionals entry, and a hidden option
        // here would hide the positional as well. Same string on both = no drift.
        .option("name", { type: "string", describe: SESSION_NAME_DESCRIBE })
        .option("oauth-url", { type: "string", describe: "OAuth issuer host (internal envs / custom domains), e.g. uat-api.clickzetta.com, used verbatim. Endpoints are discovered from it; distinct from the business --service. Alternative to --partition." })
        .option("partition", { type: "string", choices: ["cn", "intl"], describe: "Region to sign in to: cn (clickzetta.com) or intl (singdata.com). Prompted in a TTY; non-interactively either this or --oauth-url is required" })
        .option("provider", {
          type: "string",
          describe: `Sign in through the device flow instead of the browser loopback: ${TERMINAL_QR_PROVIDER_LIST} prints a QR code to scan, ${BROWSER_QR_PROVIDER_LIST} opens a page with its own QR code (on another computer when this one has no browser, e.g. over SSH), password opens a ClickZetta username/password page. Passing it selects the device flow; requires an interactive terminal, and an OAuth entry that advertises device authorization. Omit it in a terminal to pick browser sign-in or a scan platform from a menu (password is flag-only); omit it non-interactively for the browser loopback`,
        })
        // Validated here instead of with `choices`, which would reject the aliases
        // and case variants normalizeProvider accepts (see there).
        .check((argv) => {
          if (argv.provider !== undefined) normalizeProvider(argv.provider)
          return true
        })
        .option("login-method", {
          type: "string",
          choices: SETUP_LOGIN_METHODS.map((option) => option.value),
          describe: "Non-OAuth flow: choose ClickZetta, Singdata, or a custom setup",
        })
        .option("login", { type: "string", describe: "Non-OAuth flow: custom login page URL or JDBC connection string" })
        .option("account-name", { type: "string", describe: "Account name for existing ClickZetta users" })
        .option("refresh-llm", {
          type: "boolean",
          default: false,
          describe: "On a re-login, also rewrite this session's llm.json entry from the account's key. Off by default: an existing api_key may be a gateway key you provisioned (`ai-gateway key create`), which login must not overwrite",
        })
        // Accepted for compatibility (real scripts pass it) but there is nothing to
        // skip: every non-OAuth flow here authenticates against the server to get a
        // token, and OAuth is a sign-in by definition. Only `profile create` has a
        // separate verification step that this flag can turn off.
        .option("skip-verify", { type: "boolean", default: false, describe: "Accepted for compatibility, ignored: these flows always authenticate. See `profile create --skip-verify`" })
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
        // username/password ARE login inputs — re-show them (the auth group hides
        // them by default). --pat stays hidden: no login flow consumes it, and
        // passing it is answered by an explicit PAT_NOT_A_LOGIN redirect to
        // `profile create`, so advertising it here would promise a flow we do
        // not have.
        .option("pat", { type: "string", hidden: true })
        .option("username", { type: "string", hidden: false, describe: "Non-OAuth flow: username (with --password)" })
        .option("password", { type: "string", hidden: false, describe: "Non-OAuth flow: password (with --username)" })
        .example("cz-cli auth login company-prod", "Browser OAuth (recommended), interactive: prompts for the region. 'company-prod' names the session; creates a profile per instance×workspace")
        .example("cz-cli auth login company-prod --partition cn", "Same, non-interactive: OAuth against China (clickzetta.com), no region prompt")
        .example("cz-cli auth login internal --oauth-url uat-api.clickzetta.com", "OAuth against an internal/self-hosted entry")
        .example("cz-cli auth login company-prod --provider alipay --oauth-url uat-api.clickzetta.com", "QR sign-in: scan with Alipay instead of opening a browser (needs a TTY)")
        .example("cz-cli auth login company-prod --provider password --oauth-url uat-api.clickzetta.com", "Device sign-in with a ClickZetta username/password typed into the gateway's own page, never onto argv (needs a TTY)")
        .example("cz-cli auth login my-profile --credential <base64>", "New user: provision a single profile from a registration credential")
        .example("cz-cli auth login my-profile --username <u> --password <p> --account-name <acct>", "Existing account, non-interactive (CI/scripts)")
        .epilogue(
          "Three ways to sign in, each independent:\n" +
          "  OAuth (default):      opens a browser. <name> is the SESSION name — cz-cli\n" +
          "    discovers your instances/workspaces and creates one profile per\n" +
          "    combination (<name>_<workspace>_<instance>), all sharing the [oauth.<name>] token.\n" +
          "    Needs a region: prompted in a TTY, else pass --partition or --oauth-url.\n" +
          "    --provider switches to the device flow, which provisions exactly the same\n" +
          `    profiles: ${TERMINAL_QR_PROVIDER_LIST} prints a QR code to scan;\n` +
          `    ${BROWSER_QR_PROVIDER_LIST} opens a browser page showing its own QR code; password\n` +
          "    opens a page where you type a ClickZetta username and password (they go\n" +
          "    to the gateway, never onto argv or into shell history). With no local\n" +
          "    browser (SSH, no display) the page URL is printed to open on another\n" +
          "    device -- a computer for the QR page, any device for password. Needs a TTY, and\n" +
          "    an entry whose OAuth metadata advertises device authorization\n" +
          `    (${DEVICE_FLOW_ENVIRONMENTS}).\n` +
          "    Omit it and a terminal offers a menu: browser sign-in first, then the four\n" +
          "    scan platforms. password is not on it -- from your side it is the same act\n" +
          "    as browser sign-in (a page on this machine, your ClickZetta credentials),\n" +
          "    so it stays a flag for the case that wants it: nothing to scan with AND a\n" +
          "    local callback your network breaks. Non-interactively no menu appears and\n" +
          "    the browser loopback is used, so scripts are unaffected.\n" +
          "    An identity not yet bound to a ClickZetta account is not an error: the\n" +
          "    verification page walks the user through binding or registration, and\n" +
          "    this CLI just waits for it -- it never sees a password, a captcha or an\n" +
          "    SMS code.\n" +
          "  --credential <b64>:   provision a single profile named <name> from a\n" +
          "    registration token. Without <name> the profile is named 'default'.\n" +
          "  --username/--password: existing account (also needs --account-name),\n" +
          "    single profile named <name>; cz-cli prompts for any missing step.\n" +
          "    Without <name> the profile is named 'default' here too.\n" +
          "  Neither non-OAuth flow sends OAuth parameters or mints a refresh\n" +
          "  token; only browser OAuth does.\n\n" +
          "Note: <name> is a session name only for OAuth (it backs multiple profiles).\n" +
          "For --credential / --username it is just the single profile name.\n\n" +
          "Not logins, they write a profile credential directly:\n" +
          "  PAT:    cz-cli profile create <name> --pat <token> --service <host> …\n" +
          "  Cookie: set header.Cookie in a profile (profile create --header Cookie=…).\n\n" +
          "Re-login (same name) refreshes the token and adds newly-appeared workspaces; it\n" +
          "leaves your llm.json, edited profile fields and default_profile alone. Use\n" +
          "--refresh-llm if this account's LLM key itself needs rewriting. The JSON output\n" +
          "reports default_profile (what profiles.toml says) and session_default_profile\n" +
          "(this session's) separately — a re-login does not change the former.",
        ),
    async (argv) => {
      await runLogin(argv as unknown as LoginArgs)
    },
  )
}
