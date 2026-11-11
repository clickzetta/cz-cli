import * as p from "@clack/prompts"

import { isOauthDebug } from "./oauth-userinfo.js"

/**
 * The ONE non-standard part of device-flow login, deliberately quarantined in
 * its own file.
 *
 * RFC 8628 assumes one authorization maps to one identity, so its token endpoint
 * has no way to say "this third-party account is bound to several ClickZetta
 * accounts — which one?". The gateway answers that with two private endpoints
 * alongside the standard ones:
 *
 *   POST <base>/api/v1/third-party/device/token        → the device's status
 *   POST <base>/api/v1/third-party/device/select-user  → commit an account choice
 *
 * While the choice is outstanding the STANDARD token endpoint keeps answering
 * `authorization_pending`, so a purely standard client waits forever. That is
 * why this runs as the primary poll loop and `pollDeviceAuthorizationGrant` only
 * runs once afterwards to pick the token up.
 *
 * When the server grows a standard way to express this, delete this file whole:
 * nothing else in the CLI knows these endpoints exist.
 */

/** A ClickZetta account/user pair the scanned third-party identity is bound to. */
export interface DeviceAccountCandidate {
  accountId: number
  userId: number
  accountDisplayName?: string
  displayName?: string
}

/**
 * Device status as reported by the private endpoint.
 *
 * The vocabulary is the gateway's own `ThirdPartyDeviceStatus` enum, and it is
 * wider than the three states this CLI first shipped with: the gateway maps every
 * one of its five third-party login outcomes onto a device status, so a poll can
 * legitimately answer `NEED_MFA`, `NEED_BIND` or `NEED_REGISTER` as well. See
 * WAITING_STATES for why those are waits rather than failures.
 */
interface DeviceStatusBody {
  deviceStatus?: string
  /**
   * Server-supplied reason, populated on `FAILED` (confirmed present as `null`
   * while pending on a live UAT gateway). Carried into our error messages
   * so a failure names the server's own diagnosis rather than only our state
   * mapping.
   */
  error?: string | null
  result?: {
    userSelectTicket?: string
    users?: Array<{
      accountId?: number
      accountDisplayName?: string
      userId?: number
      displayName?: string
    }>
  }
}

/**
 * Derive a private device endpoint from the DISCOVERED `token_endpoint`.
 *
 * The private routes are siblings of `/oauth2/*` under the same gateway service
 * prefix (`/clickzetta-hornhub` in every environment seen so far), so the token
 * endpoint is the only thing that needs to be known. Deriving beats hardcoding
 * the prefix — that string has already differed between the gateway root and the
 * service path once (see the SDK's OAUTH_PATH_PREFIX note).
 *
 * Throws rather than guessing when the token endpoint does not end in
 * `/oauth2/token`: a wrong URL here would be diagnosed as a mysterious HTTP 404
 * mid-login.
 */
export function privateDeviceEndpoint(tokenEndpoint: string, path: string): URL {
  const endpoint = new URL(tokenEndpoint)
  const oauthTokenPath = "/oauth2/token"
  if (!endpoint.pathname.endsWith(oauthTokenPath)) {
    throw new Error(
      `DEVICE_ENDPOINT_UNDERIVABLE: cannot derive the device status endpoint from token endpoint '${tokenEndpoint}' (expected a path ending in ${oauthTokenPath})`,
    )
  }
  endpoint.pathname = `${endpoint.pathname.slice(0, -oauthTokenPath.length)}${path}`
  endpoint.search = ""
  return endpoint
}

/**
 * HTTP statuses that mean the REQUEST was wrong, so repeating it cannot help.
 *
 * Starts from the SDK's NON_RETRYABLE_STATUS (clickzetta-sdk/src/client.ts) so the
 * two agree about what a gateway status means, plus 401 and 405, which the SDK
 * leaves out for reasons that do not apply here: it retries a 401 after refreshing
 * the bearer token, and these two routes carry no bearer token at all. A 401 or 405
 * from them is the gateway routing the path wrong — the dev-api deployment served
 * exactly that when its JWT exclusion list omitted a device route — and no amount
 * of waiting fixes it, whereas waiting is precisely what the poll loop below does
 * with a retryable status.
 *
 * Everything else — 5xx, 408, 429, a connection that never completed — is the
 * gateway or the path to it being briefly unwell, which says nothing about this
 * sign-in.
 */
const NON_RETRYABLE_STATUS = new Set([400, 401, 403, 404, 405, 409, 422])

/** A failed private-endpoint call, carrying whether waiting could still fix it. */
class DeviceRequestError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message)
    this.name = "DeviceRequestError"
  }
}

/**
 * Does this envelope's `code` say the gateway accepted the request?
 *
 * The four accepted spellings are the ones the rest of the codebase already
 * tolerates (the SDK's auth/user.ts, workspace/workspace.ts and studio/client.ts
 * all repeat this test): the gateway is inconsistent about 0 vs 200 and about
 * number vs string, so checking only `=== 0` would reject good responses.
 *
 * An ABSENT code counts as success — the value is only judged when the server
 * chose to send one, which keeps a bare non-enveloped response working the way
 * `data ?? payload` in postDeviceJson already assumes it might be.
 */
function isOkEnvelopeCode(code: unknown): boolean {
  if (code === undefined || code === null) return true
  return code === 0 || code === "0" || code === 200 || code === "200"
}

/**
 * POST JSON to a private device endpoint and unwrap the gateway's envelope.
 *
 * The private routes answer in ClickZetta's `{ code, message, data }` shape
 * rather than the bare OAuth JSON the standard endpoints use, so `data` is
 * unwrapped when present — and `code` is CHECKED, because these routes report a
 * rejected request as HTTP 200 with a non-zero code. Trusting the HTTP status
 * alone turned that into `data: undefined`, which the caller then read as the
 * absent-state case and reported as an unhandled device state, hiding the reason
 * the server had actually put in `message`. On the select-user call it was worse:
 * the result is not inspected, so a rejected commit looked like a successful one
 * and the login hung on the token poll until the code expired.
 *
 * The request body carries `deviceCode`, which is a bearer-equivalent secret: it
 * is never logged, and neither is any response body (a candidate list contains
 * account names).
 *
 * `what` names the call in the failure message. It is a parameter because both
 * private routes come through here, and a hardcoded "device status request" would
 * misreport a failed account commit as a failed poll.
 *
 * `signal` bounds the request AND the body read; the caller turns its abort into
 * the expiry error (see resolveAccountSelection).
 */
async function postDeviceJson<T>(
  url: URL,
  body: Record<string, unknown>,
  requestId: string,
  what: string,
  signal: AbortSignal,
): Promise<T> {
  let response: Response
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", requestId },
      body: JSON.stringify(body),
      signal,
    })
  } catch (err) {
    // The request never got an answer: DNS, TLS, a dropped connection. Nothing
    // about it is known to be wrong, so it is worth waiting out.
    throw new DeviceRequestError(
      `DEVICE_STATUS_UNAVAILABLE: ${what} could not reach the gateway (${err instanceof Error ? err.message : String(err)}) (request id: ${requestId})`,
      true,
    )
  }

  // Narrow to an object BEFORE reading anything off it.
  //
  // A body of `null` is valid JSON, so it parses fine and then every `.message` /
  // `.code` read on it throws a TypeError — which is neither a DeviceRequestError
  // nor a `DEVICE_*` prefix, so the poll loop rethrows it and classifyLoginError
  // skips its whole table and lands on the generic LOGIN_FAILED. That bypassed the
  // retryable classification too: a 502 whose body was `null` lost its
  // DEVICE_STATUS_UNAVAILABLE tag and stopped being waited out. A bare string,
  // number or array does not throw but is just as empty of an envelope, and
  // returning one as the status body got its missing `deviceStatus` reported as an
  // unhandled device STATE — a claim about the server's state machine made from a
  // response we could not read at all.
  //
  // An unparseable body (a gateway answering 502 with an HTML error page) lands
  // here the same way; the HTTP status is the whole diagnosis in that case.
  const parsed: unknown = await response.json().catch(() => undefined)
  const envelope =
    typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as { code?: unknown; data?: T; message?: string })
      : undefined
  const detail = envelope?.message ? `: ${envelope.message}` : ""

  if (!response.ok) {
    const retryable = !NON_RETRYABLE_STATUS.has(response.status)
    throw new DeviceRequestError(
      `${retryable ? "DEVICE_STATUS_UNAVAILABLE" : "DEVICE_STATUS_FAILED"}: ${what} failed (HTTP ${response.status}${detail}) (request id: ${requestId})`,
      retryable,
    )
  }

  // An OK response we cannot read is a server-shape problem, not an answer about
  // this sign-in, and not something a retry of the identical request improves —
  // so it gets the shape advice rather than being polled through to expiry.
  if (!envelope) {
    throw new DeviceRequestError(
      `DEVICE_STATUS_UNREADABLE: ${what} answered HTTP ${response.status} with a body that is not a JSON object, so it carries no device status (request id: ${requestId})`,
      false,
    )
  }

  if (!isOkEnvelopeCode(envelope.code)) {
    throw new DeviceRequestError(
      `DEVICE_STATUS_FAILED: ${what} was rejected by the gateway (code ${String(envelope.code)}${detail}) (request id: ${requestId})`,
      false,
    )
  }

  return (envelope.data ?? envelope) as T
}

/** Label one candidate for the selection prompt. */
function candidateLabel(user: DeviceAccountCandidate): string {
  const account = user.accountDisplayName ?? `account ${user.accountId}`
  const display = user.displayName ?? `user ${user.userId}`
  return `${account} / ${display} (accountId=${user.accountId}, userId=${user.userId})`
}

/**
 * Default TTY prompt for choosing among bound ClickZetta accounts.
 *
 * Non-TTY throws rather than picking one: silently signing into the wrong
 * account produces a working CLI pointed at the wrong data, which is worse than
 * a failed login. `runLogin` refuses device login on a non-TTY before any
 * network call, so reaching this is the stdin-changed-underneath case.
 */
async function defaultPromptAccount(
  users: DeviceAccountCandidate[],
): Promise<DeviceAccountCandidate | undefined> {
  if (!process.stdin.isTTY) {
    throw new Error(
      "DEVICE_LOGIN_REQUIRES_TTY: this third-party identity is bound to several ClickZetta accounts and choosing one needs an interactive terminal",
    )
  }
  const chosen = await p.select({
    message: "This account is bound to several ClickZetta accounts. Which one do you want to sign in to?",
    options: users.map((user) => ({ label: candidateLabel(user), value: user })),
  })
  if (p.isCancel(chosen)) return undefined
  return chosen as DeviceAccountCandidate
}

export interface ResolveAccountSelectionOptions {
  /** The DISCOVERED `token_endpoint`; the private endpoints are derived from it. */
  tokenEndpoint: string
  /** The device code from the device authorization response. Secret — never logged. */
  deviceCode: string
  /** Server-advertised poll interval in seconds (RFC 8628 `interval`). */
  intervalSeconds: number
  /** Server-advertised lifetime in seconds (RFC 8628 `expires_in`); bounds the loop. */
  expiresInSeconds: number
  /** Gateway log-correlation id, shared with the standard OAuth calls. */
  requestId: string
  /** Injectable account picker (tests / non-TTY). Returns undefined when cancelled. */
  promptAccount?: (users: DeviceAccountCandidate[]) => Promise<DeviceAccountCandidate | undefined>
  /** Injectable sleep so tests do not wait real poll intervals. */
  sleep?: (ms: number) => Promise<void>
  /** Injectable clock so tests can drive the expiry bound. */
  now?: () => number
  /**
   * Injectable sink for progress lines (defaults to stdout). Only state CHANGES
   * are reported, never the `device_code` and never one line per poll.
   */
  print?: (message: string) => void
}

/**
 * States that mean the authorization is still in flight, mapped to what the
 * person at the browser is being asked for.
 *
 * These are not failures. The gateway parks a device session in one of them while
 * the web page walks the user through a step the CLI is deliberately not part of
 * — an MFA code, a first-time account binding, or the whole registration form of
 * a `scene=register` session. Treating an unrecognised state as fatal (which this
 * loop used to do) aborts a session the browser is actively completing, so the
 * only bound on the wait is the server's own `expires_in`.
 *
 * A `undefined` message means there is nothing useful to say yet: the user has
 * not reached the page. Every other entry is printed once, when the state first
 * changes, so a long wait shows what it is waiting for instead of nothing at all.
 *
 * A Map rather than an object literal: the key is a server-supplied string, and
 * `in` on an object would also match inherited names like `toString`.
 */
const WAITING_STATES = new Map<string, string | undefined>([
  ["AUTHORIZATION_PENDING", undefined],
  ["AUTHORIZED", "signed in — the gateway is finishing up"],
  ["NEED_MFA", "waiting for the verification code on the page"],
  ["NEED_BIND", "waiting for this identity to be linked to a ClickZetta account on the page"],
  ["NEED_REGISTER", "waiting for the registration form on the page to be completed"],
  ["OAUTH_TOKEN_PROCESSING", "authorized — issuing the token"],
])

/**
 * States that mean the authorization is settled and the standard token poll can
 * run. `OAUTH_TOKEN_CONSUMED` is included because the token endpoint may have
 * already been reached on a retry; the standard poll then returns the same token.
 */
const SETTLED_STATES = new Set(["SUCCESS", "OAUTH_TOKEN_CONSUMED"])

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Candidates, with the ones missing an id dropped — they cannot be committed. */
function usableCandidates(body: DeviceStatusBody): DeviceAccountCandidate[] {
  return (body.result?.users ?? [])
    .filter((user) => typeof user.accountId === "number" && typeof user.userId === "number")
    .map((user) => ({
      accountId: user.accountId as number,
      userId: user.userId as number,
      accountDisplayName: user.accountDisplayName,
      displayName: user.displayName,
    }))
}

/**
 * Poll the private device-status endpoint until the authorization is settled,
 * handling the multi-account choice on the way.
 *
 * Returns normally once the device is authorized (`SUCCESS`, or a choice we just
 * committed) — the caller then runs the standard token poll, which succeeds on
 * its first request. Throws with a `DEVICE_*` / `LOGIN_CANCELLED` prefix that
 * `classifyLoginError` maps to an error code; the prefixes are the contract
 * between the two files.
 *
 * The loop is bounded by the server's own `expires_in` rather than by a timeout
 * of ours: past that point the device code is dead and further polling can only
 * mislead the user into waiting. The bound covers each request too, not just the
 * check between polls: a gateway that accepts the connection and never answers
 * (or stalls mid-body) would otherwise hold the login open past the deadline,
 * outside the retry handling, until the server let go.
 */
export async function resolveAccountSelection(opts: ResolveAccountSelectionOptions): Promise<void> {
  const statusEndpoint = privateDeviceEndpoint(opts.tokenEndpoint, "/api/v1/third-party/device/token")
  const selectEndpoint = privateDeviceEndpoint(opts.tokenEndpoint, "/api/v1/third-party/device/select-user")
  const sleep = opts.sleep ?? defaultSleep
  const now = opts.now ?? Date.now
  const prompt = opts.promptAccount ?? defaultPromptAccount
  const print = opts.print ?? ((message: string) => console.log(message))
  const deadline = now() + opts.expiresInSeconds * 1000
  // RFC 8628 §3.5: absent `interval` means 5 seconds. A zero/negative value from
  // the server would busy-loop the gateway, so floor it.
  const intervalMs = Math.max(opts.intervalSeconds, 1) * 1000
  // Last state whose message was printed, so a multi-minute wait produces one
  // line per step rather than one per poll.
  let reportedState: string | undefined
  // Whether the "gateway is not answering" line has been shown. Printed at most
  // once per login: a flapping gateway would otherwise add a line every interval
  // for as long as `expires_in` allows.
  let reportedOutage = false
  // The account the user picked, kept across a commit that has to be retried so a
  // gateway hiccup does not ask the same question twice.
  let picked: DeviceAccountCandidate | undefined
  const expired = () =>
    new Error(`DEVICE_CODE_EXPIRED: the sign-in code expired after ${opts.expiresInSeconds}s without being authorized`)
  // Each private call gets whatever is left of `expires_in`. An abort is reported
  // as the expiry it is, whichever stage it interrupted (connect, headers, body).
  const post = async <T>(url: URL, body: Record<string, unknown>, what: string): Promise<T> => {
    const remaining = deadline - now()
    if (remaining <= 0) throw expired()
    const signal = AbortSignal.timeout(remaining)
    return postDeviceJson<T>(url, body, opts.requestId, what, signal).catch((err: unknown) => {
      if (signal.aborted) throw expired()
      throw err
    })
  }

  while (true) {
    let status: DeviceStatusBody
    try {
      status = await post<DeviceStatusBody>(statusEndpoint, { deviceCode: opts.deviceCode }, "the device status request")
    } catch (err) {
      if (!(err instanceof DeviceRequestError) || !err.retryable) throw err
      // A 5xx or a dropped connection mid-poll is the gateway being briefly
      // unwell, not an answer about this sign-in — the authorization may well be
      // completing in the browser at that very moment. So wait it out: the
      // deadline above still bounds the wait, and failing here used to abort a
      // login that was about to succeed AND tell the user that retrying would not
      // help, which was wrong twice over.
      if (isOauthDebug()) console.error(`[oauth-device] tolerating: ${err.message}`)
      if (!reportedOutage) {
        print("  the gateway is not answering right now — still waiting")
        reportedOutage = true
      }
      await sleep(intervalMs)
      continue
    }
    const state = status.deviceStatus ?? "UNKNOWN"
    if (isOauthDebug()) console.error(`[oauth-device] status=${state}`)

    if (WAITING_STATES.has(state)) {
      const message = WAITING_STATES.get(state)
      if (message && state !== reportedState) print(`  ${message}`)
      reportedState = state
      await sleep(intervalMs)
      continue
    }

    // Settled: either a single bound account, or a registration the browser just
    // finished. Nothing left to choose, so hand back to the standard token poll.
    if (SETTLED_STATES.has(state)) return

    if (state === "NEED_SELECT_USER") {
      const ticket = status.result?.userSelectTicket
      const users = usableCandidates(status)
      if (!ticket || users.length === 0) {
        throw new Error(
          "DEVICE_STATUS_FAILED: the server asked for an account choice but returned no usable candidates (missing ticket or accountId/userId)",
        )
      }

      // A question with exactly one possible answer is not a question. The
      // gateway sends NEED_SELECT_USER whenever a choice must be COMMITTED, which
      // includes the single-binding case — so the select-user POST below is still
      // required, but asking the user (and telling them they are bound to
      // "several" accounts) would be both pointless and false.
      const remembered = users.find(
        (user) => user.accountId === picked?.accountId && user.userId === picked?.userId,
      )
      const selected = users.length === 1 ? users[0] : (remembered ?? (await prompt(users)))
      if (!selected) throw new Error("LOGIN_CANCELLED: account selection was cancelled")
      picked = selected

      // A transient failure here is waited out like one on the status poll: this is
      // the step right after the user scanned and chose, the worst place to lose
      // them. It does not resend the commit blindly — whether the gateway applied a
      // commit whose answer was lost is unknown, so the loop re-reads the status
      // instead: SUCCESS if it did, a fresh NEED_SELECT_USER (and ticket) if not,
      // answered with the account already picked.
      const committed = await post(
        selectEndpoint,
        {
          deviceCode: opts.deviceCode,
          userSelectTicket: ticket,
          accountId: selected.accountId,
          userId: selected.userId,
        },
        "committing the account choice",
      ).then(
        () => true,
        (err: unknown) => {
          if (!(err instanceof DeviceRequestError) || !err.retryable) throw err
          if (isOauthDebug()) console.error(`[oauth-device] tolerating: ${err.message}`)
          if (!reportedOutage) {
            print("  the gateway is not answering right now — still waiting")
            reportedOutage = true
          }
          return false
        },
      )
      if (committed) return
      await sleep(intervalMs)
      continue
    }

    // Terminal failures.
    //
    // `FAILED` is the gateway's only real failure state — it carries the server's
    // own error name in `error`, which is the most useful thing we can show. The
    // expiry/denial spellings below are NOT in the gateway's enum; they are kept
    // as tolerance in case another deployment reports failure that way, but
    // nothing depends on them, and an unlisted spelling still lands on the
    // DEVICE_STATUS_UNEXPECTED throw at the end with the server's state in it.
    // Expiry normally surfaces either as our own deadline above or as an HTTP
    // error, because the gateway drops the session record and answers
    // `THIRD_PARTY_LOGIN_STATE_EXPIRED`.
    const reason = typeof status.error === "string" && status.error ? `, server reason: ${status.error}` : ""
    if (state === "FAILED") {
      throw new Error(`DEVICE_STATUS_FAILED: the gateway failed the sign-in${reason}`)
    }
    // Not `DEVICE_CODE_EXPIRED`: that is OUR error-code prefix, not something a
    // server reports as a state.
    if (state === "EXPIRED" || state === "EXPIRED_TOKEN") {
      throw new Error(
        `DEVICE_CODE_EXPIRED: the sign-in code expired before it was authorized (server state ${state}${reason})`,
      )
    }
    if (state === "DENIED" || state === "ACCESS_DENIED" || state === "REJECTED") {
      throw new Error(
        `DEVICE_AUTHORIZATION_DENIED: the sign-in request was declined on the phone (server state ${state}${reason})`,
      )
    }
    throw new Error(
      `DEVICE_STATUS_UNEXPECTED: the server reported device state '${state}', which this CLI does not handle${reason}`,
    )
  }
}
