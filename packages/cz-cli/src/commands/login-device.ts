import { spawn } from "node:child_process"

import * as client from "openid-client"

import { OAUTH_SCOPE, type AuthToken } from "@clickzetta/sdk"

import { resolveAccountSelection, type DeviceAccountCandidate } from "./device-account-select.js"
import { toInterfaceError } from "./oauth-error.js"
import { UsageError } from "../usage-error.js"
import {
  collectUserInfo,
  discoverOAuthConfig,
  generateRequestId,
  tokenFromResponse,
  type OAuthLoginResult,
} from "./oauth-userinfo.js"
import { browserOpenCommandForPlatform, canOpenBrowser } from "../util/browser.js"

/**
 * Device-flow OAuth login (RFC 8628) — the QR-scan sign-in.
 *
 * Despite being the standard device grant, this is NOT a headless/no-browser
 * fallback for the loopback flow: the gateway requires either a `provider` naming
 * a third-party identity platform or `auth_method=password` (with neither,
 * `/oauth2/device_authorization` answers `invalid_request`), and the
 * `verification_uri` it returns lives under `/api/v1/third-party/device/start`.
 * So the flow is "sign in with WeChat / Alipay, or on the gateway's password
 * page", and it needs a human at a page or a phone — which is why `runLogin`
 * refuses it on a non-TTY.
 *
 * Everything after the token is shared with the browser flow via
 * `oauth-userinfo.ts`, so a device login provisions exactly the same profiles as
 * a browser login of the same account.
 *
 * An identity that is not yet bound to a ClickZetta account is NOT a failure here:
 * the gateway parks the session in a waiting state and the verification page walks
 * the user through binding or registration (see `device-account-select.ts`). This
 * file only opens the page and waits either way, so no flag distinguishes the two.
 */

/**
 * Internal discriminant for the chosen sign-in route. Two of these are literal
 * `provider` values on the wire; `PASSWORD` is not — see PROVIDER_WIRE. Written
 * out rather than derived: it is the key type PROVIDER_WIRE is declared with.
 */
export type DeviceProvider = "WECHAT" | "ALIPAY" | "PASSWORD"

/**
 * Per-provider wire parameters and policy — the one table that owns everything
 * per-route, so adding a platform is a single edit here and nothing else.
 *
 * `params` is what the device authorization request carries, and the two shapes
 * are NOT interchangeable. The gateway wants either a `provider` naming one of
 * its third-party platforms, or `auth_method=password`; it rejects a request that
 * carries neither with a bare `invalid_request`, and it ignores whichever of the
 * two is not the one it acted on (a bogus `provider` alongside a good
 * `auth_method` still succeeds, and vice versa — verified against dev-api on
 * 2026-08-28). So `provider=PASSWORD` — the obvious guess — is a 400: `password`
 * is an auth METHOD on this endpoint, not a provider.
 *
 * `scan` is false for `password` because no phone is involved: the verification
 * page serves a ClickZetta username/password form instead of handing off to a
 * third-party app, so a QR block would be noise on the way to a browser on this
 * same machine. Nothing after the verification page differs — the private status
 * poll, the account choice, and the token exchange are identical for every
 * provider.
 *
 * `terminalQr` is a SEPARATE decision from `scan`: whether the CLI draws the
 * verification URL as a QR code, which only helps when the provider's page works
 * on a phone. Alipay's page (`publicAppAuthorize.htm`) opens inside the Alipay
 * app, so scanning the terminal QR with Alipay completes the sign-in. WeChat's
 * page is the website-login one (`qrconnect`, `snsapi_login`): it is meant for a
 * computer browser and shows WeChat's OWN QR code for the phone to scan. Opened
 * on the phone it just shows that QR on the phone, where nothing can scan it. So
 * WeChat is a scan from the user's side but gets no terminal QR; its URL goes to
 * a computer browser instead (see printVerificationInstructions).
 *
 * `offerInMenu` is a SEPARATE decision from `scan`, deliberately: one says what
 * the route is called, the other whether the interactive menu lists the route at
 * all. Collapsing them (filter the menu on `scan`) would make a future non-scan
 * route that should be offered unofferable, and a scan platform being rolled out
 * unhideable without turning its QR code off. `password` is false for the reason
 * `defaultPromptProvider` in login.ts spells out: from the user's side it is the
 * same act as the browser option, so offering both asks a question with two
 * identical answers. It stays reachable as `--provider password`.
 *
 * The credentials are typed into the gateway's own page, never into this CLI and
 * never onto its argv. That is the whole point of routing them through the device
 * flow, and it is why `--provider password` and `--username/--password` are
 * different commands rather than one.
 */
const PROVIDER_WIRE: Record<
  DeviceProvider,
  { label: string; scan: boolean; terminalQr: boolean; offerInMenu: boolean; params: Record<string, string> }
> = {
  WECHAT: { label: "WeChat", scan: true, terminalQr: false, offerInMenu: true, params: { provider: "WECHAT" } },
  ALIPAY: { label: "Alipay", scan: true, terminalQr: true, offerInMenu: true, params: { provider: "ALIPAY" } },
  PASSWORD: {
    label: "your ClickZetta username and password",
    scan: false,
    terminalQr: false,
    offerInMenu: false,
    params: { auth_method: "password" },
  },
}

const DEVICE_PROVIDER_VALUES = Object.keys(PROVIDER_WIRE) as DeviceProvider[]

/**
 * Sign-in routes `--provider` accepts — the CLI's vocabulary, not the gateway's:
 * the third-party platforms travel as a `provider` parameter while `password`
 * travels as `auth_method` (PROVIDER_WIRE holds the mapping).
 *
 * Lowercased from PROVIDER_WIRE rather than typed out again, so the flag's
 * `choices`, its error message and the menu cannot advertise a different set than
 * the table implements.
 */
export const DEVICE_PROVIDERS = DEVICE_PROVIDER_VALUES.map((value) => value.toLowerCase())

/** The scan platforms whose QR code the CLI draws in the terminal, for `--help`. */
export const TERMINAL_QR_PROVIDER_LIST = DEVICE_PROVIDER_VALUES.filter((value) => PROVIDER_WIRE[value].terminalQr)
  .map((value) => value.toLowerCase())
  .join("|")

/** The scan platforms whose own QR code is shown on a computer browser page, for `--help`. */
export const BROWSER_QR_PROVIDER_LIST = DEVICE_PROVIDER_VALUES.filter(
  (value) => PROVIDER_WIRE[value].scan && !PROVIDER_WIRE[value].terminalQr,
)
  .map((value) => value.toLowerCase())
  .join("|")

/**
 * Where the device grant is deployed, in one sentence.
 *
 * The fastest-moving fact in this feature — uat's private routes landed while the
 * change was in review — and two of its three readers are user-visible (`--help`
 * and the DEVICE_FLOW_UNSUPPORTED advice in login.ts). Written once so an
 * environment gaining the endpoint is one edit, not a hunt through two files.
 * Runtime behaviour never consults this: the gate below reads the discovery
 * document.
 */
export const DEVICE_FLOW_ENVIRONMENTS =
  "as of 2026-11-11 the cn and intl partitions, uat-api and dev-api all advertise it"

/**
 * Normalize a `--provider` value to its wire spelling.
 *
 * The single validator for `--provider`, not yargs' `choices`: `choices` is
 * case-sensitive, so it would reject `ALIPAY` before it got here (only lowercase
 * values would pass). The CLI runs this from a `.check()` so a bad value is a
 * USAGE_ERROR like any other; `runLogin` runs it again because
 * it is also called directly (tests, the MCP surface), and an unvalidated value
 * would reach the gateway as a bare `invalid_request` with no hint.
 */
export function normalizeProvider(value: string): DeviceProvider {
  const normalized = value.trim().toUpperCase()
  if (normalized === "WECHAT") return "WECHAT"
  if (normalized === "ALIPAY") return "ALIPAY"
  if (normalized === "PASSWORD") return "PASSWORD"
  throw new UsageError(
    `DEVICE_PROVIDER_INVALID: unknown --provider '${value}'. Supported: ${DEVICE_PROVIDERS.join(", ")}`,
  )
}

/**
 * Choices for the interactive provider menu `login.ts` shows when no `--provider`
 * was passed.
 *
 * Every field comes straight off PROVIDER_WIRE — order, wording (the same
 * `label`/`scan` pair `printVerificationInstructions` uses for its instruction
 * line), and menu membership — so a platform's display name and its policy each
 * exist in exactly one place, and adding a platform to that table extends the menu
 * with no edit here.
 *
 * `scan` is passed through rather than resolved away because it is what tells a
 * route apart from the browser loopback FROM THE USER'S SIDE: a scan happens on a
 * phone, everything else is "type into a page on this machine", which is what the
 * browser option already is. `offerInMenu` is what the caller filters on — see
 * PROVIDER_WIRE for why that is not the same question.
 *
 * The browser-loopback option is deliberately absent: it is not a device provider,
 * and only the caller knows whether it is even reachable.
 */
export function deviceProviderChoices(): Array<{
  label: string
  value: DeviceProvider
  scan: boolean
  offerInMenu: boolean
}> {
  return DEVICE_PROVIDER_VALUES.map((value) => {
    const { label, scan, offerInMenu } = PROVIDER_WIRE[value]
    return { label: scan ? `Scan with ${label}` : `Sign in with ${label}`, value, scan, offerInMenu }
  })
}

/**
 * Does this entry's OAuth metadata support the device grant?
 *
 * BOTH endpoints, in one predicate: the device authorization endpoint the grant
 * starts at, and the token endpoint it finishes at (and which the private status
 * routes are derived from). Exported because `login.ts` asks the same question to
 * decide whether offering the menu is honest, and asking it in two places had
 * already diverged — an entry advertising device authorization without a token
 * endpoint got the scan options offered and then failed DEVICE_FLOW_UNSUPPORTED,
 * the exact outcome that gate exists to prevent. A next precondition would have
 * landed in one spot and not the other.
 *
 * A type predicate so the caller below gets the narrowing the two separate `if`s
 * used to provide.
 */
export function deviceFlowSupported(
  meta: Readonly<client.ServerMetadata>,
): meta is Readonly<client.ServerMetadata> & { device_authorization_endpoint: string; token_endpoint: string } {
  return Boolean(meta.device_authorization_endpoint && meta.token_endpoint)
}

export interface LoginWithDeviceOptions {
  /**
   * OAuth issuer base URL (toServiceUrl(entryHost, protocol)). Every endpoint —
   * device authorization, token, userinfo — is discovered from it.
   */
  baseUrl: string
  /** Identity provider the verification page should use. Required by the gateway. */
  provider: DeviceProvider
  /** Injectable account picker for the multi-account case (tests / non-TTY). */
  promptAccount?: (users: DeviceAccountCandidate[]) => Promise<DeviceAccountCandidate | undefined>
  /** Injectable sleep so tests do not wait real poll intervals. */
  sleep?: (ms: number) => Promise<void>
  /** Injectable QR renderer; defaults to a terminal QR code. */
  renderQrCode?: (url: string) => Promise<string>
  /**
   * Whether a browser opened here is in front of the user. Defaults to
   * `canOpenBrowser` on the real environment; false over SSH or without a display.
   */
  browserAvailable?: boolean
  /** Injectable browser opener; defaults to the platform's opener, best-effort. */
  openBrowser?: (url: string) => void
  /** Injectable sink for the user-facing instructions (defaults to stdout). */
  print?: (message: string) => void
}

/**
 * Render a terminal QR code for the verification URL.
 *
 * `qrcode` is imported HERE rather than at the top of the file: this module is
 * reachable from `commands/auth.ts`, so a static import would pull pngjs,
 * dijkstrajs and the Reed-Solomon table setup into the startup path of every
 * `cz-cli` invocation — measured at 15-21ms — to serve one scan-only code path.
 */
async function renderTerminalQrCode(url: string): Promise<string> {
  const { default: QRCode } = await import("qrcode")
  return await QRCode.toString(url, { type: "terminal", small: true, errorCorrectionLevel: "M" })
}

/** Best-effort: the URL is already printed, so a failed spawn costs nothing. */
function openSystemBrowser(url: string): void {
  const opener = browserOpenCommandForPlatform(process.platform, url)
  try {
    spawn(opener.command, opener.args, { stdio: "ignore", detached: true })
      .once("error", () => {})
      .unref()
  } catch {
    // best-effort: the URL was already printed
  }
}

/**
 * Print the instructions for reaching the verification page.
 *
 * The URL and `user_code` are printed BEFORE the QR code is rendered, and a
 * rendering failure only warns: a terminal that cannot draw block characters, or
 * output piped to a file, must not cost the user their only way in. Neither value
 * is a secret — they are what the user is meant to carry to another device — but
 * the `device_code` is bearer-equivalent and is never printed.
 *
 * A provider with a terminal QR (see PROVIDER_WIRE) is scanned from here and never
 * opens a browser. Every other provider's page is opened in a local browser when
 * one can reach the user, and otherwise the user is told which device to open the
 * URL on: a computer for WeChat, whose page shows a QR for the phone, and any
 * device for the password page. Opening blindly over SSH would launch a browser
 * the user never sees, with no error to report.
 */
async function printVerificationInstructions(
  opts: LoginWithDeviceOptions,
  verificationUrl: string,
  userCode: string,
  expiresInSeconds: number,
): Promise<void> {
  const print = opts.print ?? ((message: string) => console.log(message))
  const wire = PROVIDER_WIRE[opts.provider]
  const browser = !wire.terminalQr && (opts.browserAvailable ?? canOpenBrowser(process.env, process.platform))
  print(
    `${verificationHeadline(wire, browser)}\n` +
      `  URL:  ${verificationUrl}\n` +
      `  Code: ${userCode}  (valid for ${expiresInSeconds}s)`,
  )
  if (browser) (opts.openBrowser ?? openSystemBrowser)(verificationUrl)
  if (!wire.terminalQr) return
  try {
    print(await (opts.renderQrCode ?? renderTerminalQrCode)(verificationUrl))
  } catch (err) {
    print(
      `(could not draw the QR code here: ${err instanceof Error ? err.message : String(err)} — open the URL above instead)`,
    )
  }
}

/** The first instruction line, worded for where the verification page will be opened. */
function verificationHeadline(wire: (typeof PROVIDER_WIRE)[DeviceProvider], browser: boolean): string {
  if (wire.terminalQr) return `Sign in by scanning with ${wire.label}.`
  const action = wire.scan ? `scan the QR code on it with ${wire.label}` : `sign in with ${wire.label}`
  if (browser) return `Opening the sign-in page in your browser; ${action}. If it does not open, use the URL below.`
  if (wire.scan) return `Open this URL in a browser on your computer, then ${action}.`
  return `Open this URL in a browser on any device (a phone works), then ${action}.`
}

/**
 * Device-flow login orchestration.
 *
 * Flow: RFC 8414 discovery → `POST /oauth2/device_authorization` with the
 * provider's wire parameters (see PROVIDER_WIRE) → print the verification URL +
 * `user_code` (plus a terminal QR, or a local browser, see
 * printVerificationInstructions) → poll the PRIVATE status
 * endpoint
 * (handling the multi-account choice, see `device-account-select.ts`) → standard
 * `pollDeviceAuthorizationGrant` to collect the token → best-effort userinfo.
 *
 * The private poll leads and the standard poll follows deliberately: while an
 * account choice is outstanding the standard token endpoint answers
 * `authorization_pending` indefinitely, so a standard-only client hangs. By the
 * time the standard poll runs the authorization is settled and it returns on its
 * first request.
 *
 * Never logs the `device_code` or any token.
 */
export async function loginWithDevice(opts: LoginWithDeviceOptions): Promise<OAuthLoginResult> {
  const requestId = generateRequestId()
  const config = await discoverOAuthConfig(opts.baseUrl, requestId)
  const meta = config.serverMetadata()

  // Checked against the discovery document rather than attempted blindly: the grant
  // is not deployed everywhere (see DEVICE_FLOW_ENVIRONMENTS), and a 404 from a POST
  // would read as a broken CLI. The message names which endpoint is missing —
  // `token_endpoint` alone means the grant is advertised but underivable, a server
  // shape problem rather than "not available here".
  if (!deviceFlowSupported(meta)) {
    const missing = [
      meta.device_authorization_endpoint ? undefined : "device_authorization_endpoint",
      meta.token_endpoint ? undefined : "token_endpoint",
    ]
      .filter(Boolean)
      .join(" and ")
    throw new Error(
      `DEVICE_FLOW_UNSUPPORTED: '${meta.issuer}' does not advertise ${missing}, so QR sign-in is not available there`,
    )
  }

  const authorization = await client
    .initiateDeviceAuthorization(config, { scope: OAUTH_SCOPE, ...PROVIDER_WIRE[opts.provider].params })
    .catch((err) => {
      throw toInterfaceError(err, requestId)
    })

  // RFC 8628 §3.3: `verification_uri_complete` is optional; fall back to the
  // bare URI, which the user completes by typing the `user_code` we also print.
  const verificationUrl = authorization.verification_uri_complete ?? authorization.verification_uri
  await printVerificationInstructions(opts, verificationUrl, authorization.user_code, authorization.expires_in)

  // RFC 8628 §3.5: a missing `interval` means 5 seconds.
  await resolveAccountSelection({
    tokenEndpoint: meta.token_endpoint,
    deviceCode: authorization.device_code,
    intervalSeconds: authorization.interval ?? 5,
    expiresInSeconds: authorization.expires_in,
    requestId,
    promptAccount: opts.promptAccount,
    sleep: opts.sleep,
    print: opts.print,
  })

  // `interval: 1` instead of the server's 5, deliberately.
  //
  // `pollDeviceAuthorizationGrant` sleeps a full interval BEFORE its first
  // request (openid-client index.js:653), so passing the server's value would add
  // 5s of dead time to every login AFTER the user has already scanned and we have
  // already confirmed the authorization is settled. By this point this is a single
  // token request, not a poll. It stays non-zero because it is still the retry
  // interval if the token endpoint has not caught up with the status endpoint yet
  // — 0 would turn that race into a hot loop until `expires_in`. A `slow_down`
  // from the server still self-corrects (the library adds 5).
  const tokens = await client
    .pollDeviceAuthorizationGrant(config, { ...authorization, interval: 1 })
    .catch((err) => {
      throw toInterfaceError(err, requestId)
    })

  const token: AuthToken = tokenFromResponse(tokens)
  const context = await collectUserInfo(config, meta.userinfo_endpoint, token, requestId)

  return { token, ...context }
}
