import { afterEach, describe, expect, test } from "bun:test"

import {
  DEVICE_PROVIDERS,
  deviceFlowSupported,
  deviceProviderChoices,
  loginWithDevice,
  normalizeProvider,
} from "../src/commands/login-device"
import { canOpenBrowser } from "../src/util/browser"
import { jsonResponse, restoreFetch, stubGlobalFetch, TOKEN_RESPONSE } from "./support/oauth-stub"

afterEach(restoreFetch)

const ISSUER = "https://uat-api.example.com"
const DISCOVERY_URL = `${ISSUER}/.well-known/oauth-authorization-server`
const PREFIX = `${ISSUER}/clickzetta-hornhub`

const DISCOVERY_DOC = {
  issuer: ISSUER,
  authorization_endpoint: `${PREFIX}/oauth2/authorize`,
  device_authorization_endpoint: `${PREFIX}/oauth2/device_authorization`,
  token_endpoint: `${PREFIX}/oauth2/token`,
  userinfo_endpoint: `${PREFIX}/oauth2/userinfo`,
  response_types_supported: ["code"],
  grant_types_supported: ["authorization_code", "refresh_token", "urn:ietf:params:oauth:grant-type:device_code"],
  token_endpoint_auth_methods_supported: ["none"],
  code_challenge_methods_supported: ["S256"],
  scopes_supported: ["openid", "profile", "offline_access"],
}

// Discovery for an entry that has NOT rolled out device flow — the shape the
// cn/intl partitions served before they enabled it.
const DISCOVERY_NO_DEVICE = (() => {
  const { device_authorization_endpoint: _omitted, ...rest } = DISCOVERY_DOC
  return { ...rest, grant_types_supported: ["authorization_code", "refresh_token"] }
})()

const STATUS_URL = `${PREFIX}/api/v1/third-party/device/token`
const SELECT_URL = `${PREFIX}/api/v1/third-party/device/select-user`

const DEVICE_CODE = "dc_secret_do_not_print"
const USER_CODE = "AWLP-48YK"

const DEVICE_AUTH_RESPONSE = {
  device_code: DEVICE_CODE,
  user_code: USER_CODE,
  verification_uri: `${PREFIX}/api/v1/third-party/device/start`,
  verification_uri_complete: `${PREFIX}/api/v1/third-party/device/start?user_code=${USER_CODE}`,
  expires_in: 600,
  interval: 5,
}

const SAMPLE_USERINFO = {
  userId: 110000011361,
  accountName: "wynptmks",
  gatewayMapping: '{"1-1":"https://uat-api.clickzetta.com"}',
  instanceList: [{ cspId: 1, regionId: 1, serviceId: 1, id: 159973, name: "89b94150" }],
  instanceName: "89b94150",
  workspaceName: "quick_start",
  sub: "110000011361",
  account_id: 112407,
}

interface StubOptions {
  discovery?: unknown
  deviceAuth?: (body: URLSearchParams) => Response
  statuses?: unknown[]
  userinfo?: () => Response
}

/** Stub the whole device flow: discovery, device authorization, private status, token, userinfo. */
function stubFetch(opts: StubOptions = {}): { requests: string[]; deviceAuthBody: () => URLSearchParams } {
  const requests: string[] = []
  const statuses = [...(opts.statuses ?? [{ deviceStatus: "SUCCESS" }])]
  let deviceAuthBody = new URLSearchParams()
  stubGlobalFetch(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    requests.push(url)
    if (url === DISCOVERY_URL) return jsonResponse(opts.discovery ?? DISCOVERY_DOC)
    if (url === DISCOVERY_DOC.device_authorization_endpoint) {
      deviceAuthBody = new URLSearchParams(String(init?.body))
      return opts.deviceAuth ? opts.deviceAuth(deviceAuthBody) : jsonResponse(DEVICE_AUTH_RESPONSE)
    }
    if (url === STATUS_URL) {
      const next = statuses.shift()
      if (next === undefined) throw new Error("status endpoint polled more times than the test scripted")
      return next instanceof Response ? next : jsonResponse({ code: 0, data: next })
    }
    if (url === SELECT_URL) return jsonResponse({ code: 0, data: {} })
    if (url === DISCOVERY_DOC.token_endpoint) return jsonResponse(TOKEN_RESPONSE)
    if (url === DISCOVERY_DOC.userinfo_endpoint) return opts.userinfo ? opts.userinfo() : jsonResponse(SAMPLE_USERINFO)
    throw new Error(`unexpected fetch to ${url}`)
  })
  return { requests, deviceAuthBody: () => deviceAuthBody }
}

/** Collect the terminal instructions instead of printing them during tests. */
function makeOptions(overrides: Record<string, unknown> = {}) {
  const printed: string[] = []
  const qrUrls: string[] = []
  const opened: string[] = []
  return {
    printed,
    qrUrls,
    opened,
    opts: {
      baseUrl: ISSUER,
      provider: "ALIPAY" as const,
      print: (message: string) => printed.push(message),
      renderQrCode: async (url: string) => {
        qrUrls.push(url)
        return "[qr]"
      },
      // Never launch a real browser from a test; each test that cares sets this.
      browserAvailable: false,
      openBrowser: (url: string) => opened.push(url),
      sleep: async () => {},
      ...overrides,
    },
  }
}

describe("normalizeProvider", () => {
  test("upper-cases the spellings the CLI advertises", () => {
    expect(DEVICE_PROVIDERS.map(normalizeProvider)).toEqual(["WECHAT", "ALIPAY", "PASSWORD"])
  })

  test("accepts letter case", () => {
    expect(normalizeProvider("  alipay ")).toBe("ALIPAY")
    expect(normalizeProvider("  WeChat ")).toBe("WECHAT")
  })

  // `password` is not a third-party app: the gateway's verification page serves a
  // ClickZetta username/password form. It travels as `auth_method`, not `provider`,
  // but it is still a `--provider` value and must survive normalization.
  test("accepts the credential provider", () => {
    expect(normalizeProvider("password")).toBe("PASSWORD")
    expect(normalizeProvider(" PASSWORD ")).toBe("PASSWORD")
  })

  test("rejects anything else with the supported list", () => {
    expect(() => normalizeProvider("qq")).toThrow(/DEVICE_PROVIDER_INVALID.*alipay/)
  })
})

// The interactive menu in `login.ts` renders these. They exist here so a platform's
// display name lives in one place — the same label/scan pair the instruction line
// uses — rather than being spelled a second time next to the prompt.
describe("deviceProviderChoices", () => {
  test("follows the order --provider advertises", () => {
    expect(deviceProviderChoices().map((choice) => choice.value)).toEqual(
      DEVICE_PROVIDERS.map(normalizeProvider),
    )
  })

  test("tells a scan apart from a page you type into", () => {
    const menuChoices = deviceProviderChoices().filter((choice) => choice.offerInMenu)
    const labels = new Map(menuChoices.map((choice) => [choice.value, choice.label]))
    expect(labels.get("WECHAT")).toBe("Scan with WeChat")
    expect(labels.get("ALIPAY")).toBe("Scan with Alipay")
    // PASSWORD is not offered in the menu, so it should not appear in the filtered list.
    expect(labels.has("PASSWORD")).toBe(false)
  })

  // `offerInMenu` is a separate question from `scan` (see PROVIDER_WIRE), so it
  // gets its own assertion: the credential route is reachable as
  // `--provider password` but must not be listed next to the browser option,
  // which from the user's side is the same act.
  test("hides only the credential route from the menu", () => {
    const hidden = deviceProviderChoices().filter((choice) => !choice.offerInMenu)
    expect(hidden.map((choice) => choice.value)).toEqual(["PASSWORD"])
  })

  // The browser loopback is not a device provider and its availability is the
  // caller's business, so it must not appear here.
  test("leaves the browser option to the caller", () => {
    const labels = deviceProviderChoices().map((choice) => choice.label.toLowerCase())
    expect(labels.some((label) => label.includes("browser"))).toBe(false)
  })
})

describe("loginWithDevice", () => {
  test("requests device authorization with the provider and the CLI's scope", async () => {
    const stub = stubFetch()
    await loginWithDevice(makeOptions().opts)

    const body = stub.deviceAuthBody()
    expect(body.get("provider")).toBe("ALIPAY")
    // The scan providers travel the other form; mixing the two is what the
    // gateway ignores silently, so keep them mutually exclusive on the wire.
    expect(body.get("auth_method")).toBeNull()
    expect(body.get("client_id")).toBe("official-cli")
    // Deliberately no `openid`: the CLI never consumes an id_token.
    expect(body.get("scope")).toBe("profile offline_access")
  })

  test("mints a token whose expiry is a DURATION, not a timestamp", async () => {
    stubFetch()
    const before = Date.now()
    const { token } = await loginWithDevice(makeOptions().opts)

    expect(token.token).toBe("access-xyz")
    expect(token.refreshToken).toBe("refresh-xyz")
    // 3600s expressed in ms. An absolute timestamp here would read as ~58,000
    // years of validity and the token would never be refreshed.
    expect(token.expireTimeMs).toBe(3600 * 1000)
    expect(token.obtainedAt).toBeGreaterThanOrEqual(before)
  })

  test("backfills identity and the region service from userinfo", async () => {
    stubFetch()
    const { token, userInfo, instances } = await loginWithDevice(makeOptions().opts)

    expect(token.userId).toBe(110000011361)
    expect(token.instanceId).toBe(159973)
    expect(userInfo?.accountName).toBe("wynptmks")
    expect(userInfo?.tenantId).toBe(112407)
    // Resolved through gatewayMapping["1-1"], stored without a protocol.
    expect(userInfo?.service).toBe("uat-api.clickzetta.com")
    expect(instances).toEqual([{ instanceId: 159973, instanceName: "89b94150", service: "uat-api.clickzetta.com" }])
  })

  test("prints the user code and URL but never the device code", async () => {
    stubFetch()
    const { printed, opts } = makeOptions()
    await loginWithDevice(opts)

    const output = printed.join("\n")
    expect(output).toContain(USER_CODE)
    expect(output).toContain(DEVICE_AUTH_RESPONSE.verification_uri_complete)
    expect(output).toContain("Alipay")
    // The device code is bearer-equivalent: it must never reach the terminal.
    expect(output).not.toContain(DEVICE_CODE)
  })

  test("renders the QR code for the complete verification URL", async () => {
    stubFetch()
    const { qrUrls, opts } = makeOptions()
    await loginWithDevice(opts)
    expect(qrUrls).toEqual([DEVICE_AUTH_RESPONSE.verification_uri_complete])
  })

  test("falls back to the bare verification_uri when the server omits the complete one", async () => {
    const { verification_uri_complete: _omitted, ...withoutComplete } = DEVICE_AUTH_RESPONSE
    stubFetch({ deviceAuth: () => jsonResponse(withoutComplete) })
    const { qrUrls, opts } = makeOptions()
    await loginWithDevice(opts)
    expect(qrUrls).toEqual([DEVICE_AUTH_RESPONSE.verification_uri])
  })

  test("a terminal that cannot draw the QR code still gets a usable login", async () => {
    stubFetch()
    const { printed, opts } = makeOptions({
      renderQrCode: async () => {
        throw new Error("no unicode here")
      },
    })

    const { token } = await loginWithDevice(opts)

    expect(token.token).toBe("access-xyz")
    const output = printed.join("\n")
    expect(output).toContain("could not draw the QR code")
    expect(output).toContain(USER_CODE)
  })
})

// `--provider password` reaches the same verification page mechanism, but nobody
// scans it — the URL is opened in a browser, usually on this very machine. A QR
// block there is noise, so it is skipped while the URL and code (the only things
// the user actually needs) are printed exactly as for a scan provider.
describe("loginWithDevice with the credential provider", () => {
  // The wire shape is NOT `provider=PASSWORD` — that is a 400. On this endpoint
  // `password` is an auth METHOD, carried in its own parameter, and the gateway
  // requires exactly one of the two forms. Pinned because the wrong guess fails
  // only against a live gateway, with a bare `invalid_request` that names nothing.
  test("travels as auth_method, not as a provider, and skips the QR code", async () => {
    const stub = stubFetch()
    const { printed, qrUrls, opts } = makeOptions({ provider: "PASSWORD" as const })

    const { token } = await loginWithDevice(opts)

    const body = stub.deviceAuthBody()
    expect(body.get("auth_method")).toBe("password")
    expect(body.get("provider")).toBeNull()
    expect(qrUrls).toEqual([])
    const output = printed.join("\n")
    expect(output).toContain(USER_CODE)
    expect(output).toContain(DEVICE_AUTH_RESPONSE.verification_uri_complete)
    expect(output).toContain("username and password")
    // No phone is involved, so nothing should tell the user to scan.
    expect(output).not.toContain("scanning")
    // Same secret discipline as every other provider.
    expect(output).not.toContain(DEVICE_CODE)
    expect(token.token).toBe("access-xyz")
  })

  // The CLI must not become a place where a password is typed: that is the entire
  // reason this is a device flow and not a credential grant. Nothing about the
  // password reaches the device authorization request.
  test("carries no credentials of its own in the device authorization request", async () => {
    const stub = stubFetch()
    await loginWithDevice(makeOptions({ provider: "PASSWORD" as const }).opts)

    const body = stub.deviceAuthBody()
    expect(body.get("auth_method")).toBe("password")
    expect(body.get("username")).toBeNull()
    expect(body.get("password")).toBeNull()
    expect(body.get("scope")).toBe("profile offline_access")
  })
})

// WeChat's verification page is its website-login page (qrconnect, snsapi_login):
// it shows WeChat's own QR code for a phone to scan, so it must be opened on a
// computer. A terminal QR would open that page ON the phone, a dead end.
describe("loginWithDevice with WeChat", () => {
  test("draws no terminal QR and opens the page in a local browser when one can reach the user", async () => {
    stubFetch()
    const { printed, qrUrls, opened, opts } = makeOptions({ provider: "WECHAT" as const, browserAvailable: true })

    const { token } = await loginWithDevice(opts)

    expect(qrUrls).toEqual([])
    expect(opened).toEqual([DEVICE_AUTH_RESPONSE.verification_uri_complete])
    const output = printed.join("\n")
    // The URL stays printed: the open is best-effort and may land nowhere.
    expect(output).toContain(DEVICE_AUTH_RESPONSE.verification_uri_complete)
    expect(output).toContain(USER_CODE)
    expect(output).toContain("WeChat")
    expect(token.token).toBe("access-xyz")
  })

  test("without a local browser, sends the user to a computer instead of opening one", async () => {
    stubFetch()
    const { printed, qrUrls, opened, opts } = makeOptions({ provider: "WECHAT" as const })

    await loginWithDevice(opts)

    expect(qrUrls).toEqual([])
    expect(opened).toEqual([])
    const output = printed.join("\n")
    expect(output).toContain("browser on your computer")
    expect(output).toContain(DEVICE_AUTH_RESPONSE.verification_uri_complete)
    expect(output).not.toContain(DEVICE_CODE)
  })
})

describe("loginWithDevice browser handling for the other providers", () => {
  // Alipay's page opens inside the Alipay app, so the terminal QR is the whole
  // flow; a local browser would be a second, useless window.
  test("Alipay keeps the terminal QR and never opens a browser", async () => {
    stubFetch()
    const { qrUrls, opened, opts } = makeOptions({ browserAvailable: true })
    await loginWithDevice(opts)
    expect(qrUrls).toEqual([DEVICE_AUTH_RESPONSE.verification_uri_complete])
    expect(opened).toEqual([])
  })

  test("the password page opens locally when it can", async () => {
    stubFetch()
    const { opened, opts } = makeOptions({ provider: "PASSWORD" as const, browserAvailable: true })
    await loginWithDevice(opts)
    expect(opened).toEqual([DEVICE_AUTH_RESPONSE.verification_uri_complete])
  })

  // The password page needs no phone and no QR, so unlike WeChat any device's
  // browser will do.
  test("without a local browser, the password page may be opened on any device", async () => {
    stubFetch()
    const { printed, opened, opts } = makeOptions({ provider: "PASSWORD" as const })
    await loginWithDevice(opts)
    expect(opened).toEqual([])
    expect(printed.join("\n")).toContain("any device")
  })
})

describe("canOpenBrowser", () => {
  // Over SSH `open`/`xdg-open` would put the browser on the remote screen and
  // still exit cleanly, so the session itself is the signal, display or not.
  test("is false over SSH even with a display", () => {
    expect(canOpenBrowser({ SSH_CONNECTION: "10.0.0.1 5000 10.0.0.2 22", DISPLAY: ":0" }, "linux")).toBe(false)
    expect(canOpenBrowser({ SSH_TTY: "/dev/pts/0" }, "darwin")).toBe(false)
    expect(canOpenBrowser({ SSH_CLIENT: "10.0.0.1 5000 22" }, "win32")).toBe(false)
  })

  test("needs a display server on Linux", () => {
    expect(canOpenBrowser({}, "linux")).toBe(false)
    expect(canOpenBrowser({ DISPLAY: ":0" }, "linux")).toBe(true)
    expect(canOpenBrowser({ WAYLAND_DISPLAY: "wayland-0" }, "linux")).toBe(true)
  })

  test("assumes a local desktop on macOS and Windows", () => {
    expect(canOpenBrowser({}, "darwin")).toBe(true)
    expect(canOpenBrowser({}, "win32")).toBe(true)
  })
})

describe("deviceFlowSupported", () => {
  const meta = (extra: Record<string, unknown>) =>
    ({ issuer: ISSUER, ...extra }) as Parameters<typeof deviceFlowSupported>[0]

  // BOTH endpoints, because login.ts asks this to decide whether offering the scan
  // menu is honest and loginWithDevice asks it again before the first POST. While
  // those were two separate checks they had already diverged: an entry advertising
  // device authorization without a token endpoint got the scan options offered and
  // then failed DEVICE_FLOW_UNSUPPORTED.
  test("requires the token endpoint too, not just the one the grant starts at", () => {
    expect(
      deviceFlowSupported(
        meta({
          device_authorization_endpoint: DISCOVERY_DOC.device_authorization_endpoint,
          token_endpoint: DISCOVERY_DOC.token_endpoint,
        }),
      ),
    ).toBe(true)
    expect(
      deviceFlowSupported(meta({ device_authorization_endpoint: DISCOVERY_DOC.device_authorization_endpoint })),
    ).toBe(false)
    expect(deviceFlowSupported(meta({ token_endpoint: DISCOVERY_DOC.token_endpoint }))).toBe(false)
    expect(deviceFlowSupported(meta({}))).toBe(false)
  })
})

describe("loginWithDevice on entries without device flow", () => {
  test("refuses before requesting anything when discovery omits the device endpoint", async () => {
    const stub = stubFetch({ discovery: DISCOVERY_NO_DEVICE })
    const { printed, opts } = makeOptions()

    await expect(loginWithDevice(opts)).rejects.toThrow(/DEVICE_FLOW_UNSUPPORTED/)

    // Only discovery was attempted: no device authorization POST, and nothing was
    // printed that would suggest the user should start scanning.
    expect(stub.requests).toEqual([DISCOVERY_URL])
    expect(printed).toEqual([])
  })

  test("names the issuer that lacks the endpoint", async () => {
    stubFetch({ discovery: DISCOVERY_NO_DEVICE })
    await expect(loginWithDevice(makeOptions().opts)).rejects.toThrow(new RegExp(ISSUER))
  })
})

describe("loginWithDevice with several bound accounts", () => {
  test("asks which account, commits it, then collects the token", async () => {
    const stub = stubFetch({
      statuses: [
        { deviceStatus: "AUTHORIZATION_PENDING" },
        {
          deviceStatus: "NEED_SELECT_USER",
          result: {
            userSelectTicket: "ticket-abc",
            users: [
              { accountId: 112407, userId: 110000011361, accountDisplayName: "acme-prod" },
              { accountId: 112408, userId: 110000011362, accountDisplayName: "acme-dev" },
            ],
          },
        },
      ],
    })
    let offered = 0
    const { opts } = makeOptions({
      promptAccount: async (users: Array<{ accountId: number }>) => {
        offered = users.length
        return users[1]
      },
    })

    const { token } = await loginWithDevice(opts)

    expect(offered).toBe(2)
    expect(stub.requests).toContain(SELECT_URL)
    // The standard token request runs only after the choice is committed.
    expect(stub.requests.indexOf(SELECT_URL)).toBeLessThan(stub.requests.indexOf(DISCOVERY_DOC.token_endpoint))
    expect(token.token).toBe("access-xyz")
  })
})

describe("loginWithDevice when userinfo fails", () => {
  test("keeps the token and reports no context rather than failing the login", async () => {
    stubFetch({ userinfo: () => jsonResponse({ error: "server_error" }, 500) })

    const { token, userInfo, instances } = await loginWithDevice(makeOptions().opts)

    expect(token.token).toBe("access-xyz")
    // Left at 0 so the token store and legacy consumers keep working.
    expect(token.userId).toBe(0)
    expect(token.instanceId).toBe(0)
    expect(userInfo).toBeUndefined()
    expect(instances).toBeUndefined()
  })
})
