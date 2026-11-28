import { afterEach, describe, expect, test } from "bun:test"

import {
  privateDeviceEndpoint,
  resolveAccountSelection,
  type DeviceAccountCandidate,
} from "../src/commands/device-account-select"
import { jsonResponse, restoreFetch, stubGlobalFetch } from "./support/oauth-stub"

afterEach(restoreFetch)

const TOKEN_ENDPOINT = "https://uat-api.example.com/clickzetta-hornhub/oauth2/token"
const STATUS_URL = "https://uat-api.example.com/clickzetta-hornhub/api/v1/third-party/device/token"
const SELECT_URL = "https://uat-api.example.com/clickzetta-hornhub/api/v1/third-party/device/select-user"

const DEVICE_CODE = "dc_secret_value"

interface Call {
  url: string
  body: Record<string, unknown>
}

/**
 * Stub fetch for the two private endpoints. `statuses` is consumed one entry per
 * status poll, so a test spells out the exact sequence the server would return.
 */
function stubDeviceFetch(statuses: unknown[], opts: { selectResponse?: () => Response } = {}): Call[] {
  const calls: Call[] = []
  const queue = [...statuses]
  stubGlobalFetch(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    calls.push({ url, body: JSON.parse(String(init?.body)) as Record<string, unknown> })
    if (url === STATUS_URL) {
      const next = queue.shift()
      if (next === undefined) throw new Error("status endpoint polled more times than the test scripted")
      return next instanceof Response ? next : jsonResponse({ code: 0, data: next })
    }
    if (url === SELECT_URL) return opts.selectResponse ? opts.selectResponse() : jsonResponse({ code: 0, data: {} })
    throw new Error(`unexpected fetch to ${url}`)
  })
  return calls
}

function httpError(status: number, message: string): Response {
  return jsonResponse({ code: status, message }, status)
}

function baseOptions() {
  const slept: number[] = []
  return {
    slept,
    opts: {
      tokenEndpoint: TOKEN_ENDPOINT,
      deviceCode: DEVICE_CODE,
      intervalSeconds: 5,
      expiresInSeconds: 600,
      requestId: "tssdk-oauth-test",
      sleep: async (ms: number) => {
        slept.push(ms)
      },
    },
  }
}

const TWO_CANDIDATES = {
  deviceStatus: "NEED_SELECT_USER",
  result: {
    userSelectTicket: "ticket-abc",
    users: [
      { accountId: 112407, userId: 110000011361, accountDisplayName: "acme-prod", displayName: "zhang" },
      { accountId: 112408, userId: 110000011362, accountDisplayName: "acme-dev", displayName: "zhang" },
    ],
  },
}

describe("privateDeviceEndpoint", () => {
  test("derives the private routes from the discovered token endpoint", () => {
    expect(privateDeviceEndpoint(TOKEN_ENDPOINT, "/api/v1/third-party/device/token").href).toBe(STATUS_URL)
    expect(privateDeviceEndpoint(TOKEN_ENDPOINT, "/api/v1/third-party/device/select-user").href).toBe(SELECT_URL)
  })

  test("keeps whatever service prefix the gateway uses rather than hardcoding one", () => {
    expect(privateDeviceEndpoint("https://h.example.com/other-svc/oauth2/token", "/api/v1/third-party/device/token").href).toBe(
      "https://h.example.com/other-svc/api/v1/third-party/device/token",
    )
  })

  test("throws instead of guessing when the token endpoint has an unexpected path", () => {
    expect(() => privateDeviceEndpoint("https://h.example.com/oauth/tok", "/api/v1/x")).toThrow(
      /DEVICE_ENDPOINT_UNDERIVABLE/,
    )
  })

  test("drops any query string from the derived URL", () => {
    expect(privateDeviceEndpoint(`${TOKEN_ENDPOINT}?x=1`, "/api/v1/third-party/device/token").href).toBe(STATUS_URL)
  })
})

describe("resolveAccountSelection", () => {
  test("polls at the server's interval until the device is authorized", async () => {
    const calls = stubDeviceFetch([
      { deviceStatus: "AUTHORIZATION_PENDING" },
      { deviceStatus: "AUTHORIZATION_PENDING" },
      { deviceStatus: "SUCCESS" },
    ])
    const { slept, opts } = baseOptions()

    await resolveAccountSelection(opts)

    expect(calls.map((c) => c.url)).toEqual([STATUS_URL, STATUS_URL, STATUS_URL])
    expect(slept).toEqual([5000, 5000])
    // The device code travels in the body of the status call and nowhere else.
    expect(calls[0]?.body).toEqual({ deviceCode: DEVICE_CODE })
  })

  test("a straight SUCCESS needs no selection call", async () => {
    const calls = stubDeviceFetch([{ deviceStatus: "SUCCESS" }])
    await resolveAccountSelection(baseOptions().opts)
    expect(calls.some((c) => c.url === SELECT_URL)).toBe(false)
  })

  // The gateway sends NEED_SELECT_USER whenever a choice must be COMMITTED, which
  // includes an identity bound to exactly ONE account. Prompting there asks a
  // question with one possible answer, under a message claiming "several" — so
  // the choice is auto-committed instead. Regression guard for a live UAT login
  // that showed a one-option picker.
  test("a lone NEED_SELECT_USER candidate is committed without prompting", async () => {
    const calls = stubDeviceFetch([
      {
        deviceStatus: "NEED_SELECT_USER",
        result: {
          userSelectTicket: "ticket-1",
          users: [{ accountId: 10, userId: 129000010002, accountDisplayName: "lpujtsqu", displayName: "weiliu" }],
        },
      },
    ])

    let prompted = false
    await resolveAccountSelection({
      ...baseOptions().opts,
      promptAccount: async () => {
        prompted = true
        return undefined
      },
    })

    expect(prompted).toBe(false)
    // The POST still happens — the server needs the choice committed either way.
    const select = calls.find((c) => c.url === SELECT_URL)
    expect(select?.body).toEqual({
      deviceCode: DEVICE_CODE,
      userSelectTicket: "ticket-1",
      accountId: 10,
      userId: 129000010002,
    })
  })

  test("commits the chosen account with its ticket when several are bound", async () => {
    const calls = stubDeviceFetch([TWO_CANDIDATES])
    const seen: DeviceAccountCandidate[][] = []
    const { opts } = baseOptions()

    await resolveAccountSelection({
      ...opts,
      promptAccount: async (users) => {
        seen.push(users)
        return users[1]
      },
    })

    expect(seen[0]?.map((u) => u.accountId)).toEqual([112407, 112408])
    const select = calls.find((c) => c.url === SELECT_URL)
    expect(select?.body).toEqual({
      deviceCode: DEVICE_CODE,
      userSelectTicket: "ticket-abc",
      accountId: 112408,
      userId: 110000011362,
    })
  })

  // A 503 on the commit used to fail the login right after the user had scanned and
  // chosen. It is now waited out by re-reading the status, and the pick is reused
  // rather than asked again.
  test("a transient failure committing the choice is waited out without asking again", async () => {
    let selectCalls = 0
    const calls = stubDeviceFetch([TWO_CANDIDATES, TWO_CANDIDATES], {
      selectResponse: () => {
        selectCalls += 1
        return selectCalls === 1 ? httpError(503, "busy") : jsonResponse({ code: 0, data: {} })
      },
    })
    let asked = 0
    const { opts } = baseOptions()

    await resolveAccountSelection({
      ...opts,
      print: () => {},
      promptAccount: async (users) => {
        asked += 1
        return users[1]
      },
    })

    expect(asked).toBe(1)
    const commits = calls.filter((c) => c.url === SELECT_URL)
    expect(commits).toHaveLength(2)
    expect(commits.every((c) => c.body.accountId === 112408)).toBe(true)
  })

  test("a rejected commit still fails at once", async () => {
    stubDeviceFetch([TWO_CANDIDATES], { selectResponse: () => httpError(400, "bad ticket") })
    await expect(
      resolveAccountSelection({ ...baseOptions().opts, promptAccount: async (users) => users[0] }),
    ).rejects.toThrow(/DEVICE_STATUS_FAILED.*bad ticket/)
  })

  test("waits through pending polls before asking which account", async () => {
    stubDeviceFetch([{ deviceStatus: "AUTHORIZATION_PENDING" }, TWO_CANDIDATES])
    const { slept, opts } = baseOptions()
    let asked = 0

    await resolveAccountSelection({
      ...opts,
      promptAccount: async (users) => {
        asked += 1
        return users[0]
      },
    })

    expect(slept).toEqual([5000])
    expect(asked).toBe(1)
  })

  test("a cancelled selection aborts the login rather than picking for the user", async () => {
    stubDeviceFetch([TWO_CANDIDATES])
    const { opts } = baseOptions()
    await expect(
      resolveAccountSelection({ ...opts, promptAccount: async () => undefined }),
    ).rejects.toThrow(/LOGIN_CANCELLED/)
  })

  test("drops candidates missing an accountId or userId", async () => {
    stubDeviceFetch([
      {
        deviceStatus: "NEED_SELECT_USER",
        result: {
          userSelectTicket: "ticket-abc",
          // Two survivors on purpose: with one, the auto-commit path skips the
          // prompt entirely and this test would stop observing the filter.
          users: [
            { accountId: 112407, userId: 110000011361 },
            { accountDisplayName: "no-ids" },
            { accountId: 10, userId: 129000010002 },
            { accountId: 999 },
          ],
        },
      },
    ])
    const { opts } = baseOptions()
    let offered: DeviceAccountCandidate[] = []

    await resolveAccountSelection({
      ...opts,
      promptAccount: async (users) => {
        offered = users
        return users[0]
      },
    })

    expect(offered).toHaveLength(2)
    expect(offered.map((u) => u.accountId)).toEqual([112407, 10])
  })

  test("fails when a selection is demanded with no usable candidates", async () => {
    stubDeviceFetch([{ deviceStatus: "NEED_SELECT_USER", result: { users: [] } }])
    const { opts } = baseOptions()
    await expect(resolveAccountSelection(opts)).rejects.toThrow(/DEVICE_STATUS_FAILED/)
  })
})

// The gateway maps all five of its third-party login outcomes onto device
// statuses, so these states are reachable on a live poll — NEED_REGISTER on every
// `scene=register` session, NEED_MFA and NEED_BIND on ordinary sign-ins. They
// used to abort the login as DEVICE_STATUS_UNEXPECTED, which throws away a
// session the browser is actively completing.
describe("resolveAccountSelection while the browser is mid-flow", () => {
  test.each(["AUTHORIZED", "NEED_MFA", "NEED_BIND", "NEED_REGISTER", "OAUTH_TOKEN_PROCESSING"])(
    "keeps waiting through %s instead of failing",
    async (state) => {
      stubDeviceFetch([{ deviceStatus: state }, { deviceStatus: "SUCCESS" }])
      const { slept, opts } = baseOptions()

      await resolveAccountSelection({ ...opts, print: () => {} })

      expect(slept).toEqual([5000])
    },
  )

  test("reports what the page is waiting for, once per step and not once per poll", async () => {
    stubDeviceFetch([
      { deviceStatus: "AUTHORIZATION_PENDING" },
      { deviceStatus: "NEED_REGISTER" },
      { deviceStatus: "NEED_REGISTER" },
      { deviceStatus: "OAUTH_TOKEN_PROCESSING" },
      { deviceStatus: "SUCCESS" },
    ])
    const printed: string[] = []

    await resolveAccountSelection({ ...baseOptions().opts, print: (m) => printed.push(m) })

    expect(printed).toHaveLength(2)
    expect(printed[0]).toContain("registration form")
    expect(printed[1]).toContain("issuing the token")
    // AUTHORIZATION_PENDING has nothing worth saying, and no line may leak the
    // bearer-equivalent device code.
    expect(printed.join("\n")).not.toContain(DEVICE_CODE)
  })

  test("a settled token that was already consumed still counts as authorized", async () => {
    stubDeviceFetch([{ deviceStatus: "OAUTH_TOKEN_CONSUMED" }])
    await resolveAccountSelection({ ...baseOptions().opts, print: () => {} })
  })

  test("the wait is still bounded by expires_in, not unbounded by the new states", async () => {
    stubDeviceFetch([{ deviceStatus: "NEED_REGISTER" }, { deviceStatus: "NEED_REGISTER" }])
    let clock = 0
    await expect(
      resolveAccountSelection({
        ...baseOptions().opts,
        expiresInSeconds: 10,
        print: () => {},
        now: () => {
          const value = clock
          clock += 6000
          return value
        },
      }),
    ).rejects.toThrow(/DEVICE_CODE_EXPIRED/)
  })
})

describe("resolveAccountSelection terminal states", () => {
  // FAILED is the gateway's only real failure state, and it is the one the CLI
  // used to answer with DEVICE_STATUS_UNEXPECTED.
  test("maps FAILED to DEVICE_STATUS_FAILED and keeps the server's error name", async () => {
    stubDeviceFetch([{ deviceStatus: "FAILED", error: "THIRD_PARTY_LOGIN_STATE_EXPIRED" }])
    await expect(resolveAccountSelection(baseOptions().opts)).rejects.toThrow(
      /DEVICE_STATUS_FAILED.*server reason: THIRD_PARTY_LOGIN_STATE_EXPIRED/,
    )
  })

  test("stops at the server's own expires_in instead of polling forever", async () => {
    // Every poll answers pending; the injected clock jumps past expires_in so the
    // loop must give up on its own rather than trusting the server to stop it.
    stubDeviceFetch([{ deviceStatus: "AUTHORIZATION_PENDING" }, { deviceStatus: "AUTHORIZATION_PENDING" }])
    const { opts } = baseOptions()
    let clock = 0
    await expect(
      resolveAccountSelection({
        ...opts,
        expiresInSeconds: 10,
        now: () => {
          const value = clock
          clock += 6000
          return value
        },
      }),
    ).rejects.toThrow(/DEVICE_CODE_EXPIRED/)
  })

  test("maps an expired device state to DEVICE_CODE_EXPIRED", async () => {
    stubDeviceFetch([{ deviceStatus: "EXPIRED" }])
    await expect(resolveAccountSelection(baseOptions().opts)).rejects.toThrow(/DEVICE_CODE_EXPIRED/)
  })

  test("maps a declined authorization to DEVICE_AUTHORIZATION_DENIED", async () => {
    stubDeviceFetch([{ deviceStatus: "ACCESS_DENIED" }])
    await expect(resolveAccountSelection(baseOptions().opts)).rejects.toThrow(/DEVICE_AUTHORIZATION_DENIED/)
  })

  // The live gateway carries a `data.error` alongside the terminal state (it sits
  // there as `null` while pending). Whatever diagnosis the server offers beats
  // our own state mapping, so it must reach the message.
  test("carries the server's own reason into a terminal error", async () => {
    stubDeviceFetch([{ deviceStatus: "ACCESS_DENIED", error: "user_cancelled_on_device" }])
    await expect(resolveAccountSelection(baseOptions().opts)).rejects.toThrow(
      /DEVICE_AUTHORIZATION_DENIED.*server reason: user_cancelled_on_device/,
    )
  })

  // The waiting-state lookup is keyed on a server-supplied string. Held in a Map
  // precisely so an inherited property name cannot be mistaken for a known state
  // and polled until the code expires.
  test.each(["toString", "constructor", "hasOwnProperty"])(
    "does not mistake the inherited name %s for a waiting state",
    async (state) => {
      stubDeviceFetch([{ deviceStatus: state }])
      await expect(resolveAccountSelection(baseOptions().opts)).rejects.toThrow(
        /DEVICE_STATUS_UNEXPECTED/,
      )
    },
  )

  test("names an unrecognised state rather than retrying it", async () => {
    stubDeviceFetch([{ deviceStatus: "SOMETHING_NEW" }])
    await expect(resolveAccountSelection(baseOptions().opts)).rejects.toThrow(
      /DEVICE_STATUS_UNEXPECTED.*SOMETHING_NEW/,
    )
  })

  test.each([400, 401, 403, 404, 405, 409, 422])(
    "aborts on HTTP %i, which says the request itself was wrong",
    async (status) => {
      stubDeviceFetch([httpError(status, "no such device session")])
      await expect(resolveAccountSelection(baseOptions().opts)).rejects.toThrow(
        new RegExp(`DEVICE_STATUS_FAILED.*${status}.*no such device session`),
      )
    },
  )

  test("accepts a flat (un-enveloped) status body", async () => {
    // The gateway wraps responses in `{ code, data }`, but the demo tolerated a
    // flat body too; keep both working so a shape change is not an outage.
    stubGlobalFetch(async () => jsonResponse({ deviceStatus: "SUCCESS" }))
    await resolveAccountSelection(baseOptions().opts)
  })
})

describe("resolveAccountSelection when the gateway answers badly", () => {
  // The private routes report a rejected request as HTTP 200 with a non-zero
  // `code`. Trusting the status alone left `data` undefined, so the loop read the
  // absent state and blamed an unhandled device state — hiding the reason the
  // server had actually put in `message`.
  test("a non-zero envelope code is a failure, and it names the server's reason", async () => {
    stubDeviceFetch([jsonResponse({ code: 5001, message: "device session not found" })])
    await expect(resolveAccountSelection(baseOptions().opts)).rejects.toThrow(
      /DEVICE_STATUS_FAILED.*code 5001.*device session not found/,
    )
  })

  test("the status poll does not report a rejection as an unhandled device state", async () => {
    stubDeviceFetch([jsonResponse({ code: 5001, message: "device session not found" })])
    await expect(resolveAccountSelection(baseOptions().opts)).rejects.not.toThrow(/DEVICE_STATUS_UNEXPECTED/)
  })

  // The commit's response body is not inspected, so before the code check a
  // rejected choice looked exactly like an accepted one: the login went on to the
  // token poll and hung there until the device code expired.
  test("a rejected account commit fails instead of being taken for a success", async () => {
    stubDeviceFetch([TWO_CANDIDATES], {
      selectResponse: () => jsonResponse({ code: 4003, message: "ticket already used" }),
    })
    await expect(
      resolveAccountSelection({
        ...baseOptions().opts,
        promptAccount: async (users) => users[1],
      }),
    ).rejects.toThrow(/DEVICE_STATUS_FAILED.*committing the account choice.*ticket already used/)
  })

  test("accepts the other spellings of a success code", async () => {
    for (const code of [0, "0", 200, "200"]) {
      stubDeviceFetch([jsonResponse({ code, data: { deviceStatus: "SUCCESS" } })])
      await resolveAccountSelection(baseOptions().opts)
    }
  })
})

describe("resolveAccountSelection through a flaky gateway", () => {
  // A 5xx mid-poll says nothing about this sign-in: the user may be finishing on
  // the verification page at that very moment. Failing here aborted a login that
  // was about to succeed, and the advice attached to the error told the user that
  // retrying would not help — wrong twice over.
  test("waits out a transient server error instead of failing the login", async () => {
    const calls = stubDeviceFetch([
      httpError(503, "upstream unavailable"),
      httpError(502, "bad gateway"),
      { deviceStatus: "SUCCESS" },
    ])
    const printed: string[] = []
    await resolveAccountSelection({ ...baseOptions().opts, print: (line) => printed.push(line) })

    expect(calls.map((call) => call.url)).toEqual([STATUS_URL, STATUS_URL, STATUS_URL])
    // Said once, not once per failed poll.
    expect(printed.filter((line) => line.includes("not answering"))).toHaveLength(1)
  })

  test("waits out a request that never got an answer at all", async () => {
    const queue: unknown[] = [new Error("socket hang up"), { deviceStatus: "SUCCESS" }]
    stubGlobalFetch(async () => {
      const next = queue.shift()
      if (next instanceof Error) throw next
      return jsonResponse({ code: 0, data: next })
    })
    await resolveAccountSelection({ ...baseOptions().opts, print: () => {} })
    expect(queue).toHaveLength(0)
  })

  // The tolerance must not become an unbounded wait: the device code still dies
  // on the server's own schedule, so a gateway that never recovers has to end the
  // login rather than poll until the process is killed.
  test("a gateway that never recovers still ends at expires_in", async () => {
    stubGlobalFetch(async () => httpError(503, "still down"))
    let clock = 0
    await expect(
      resolveAccountSelection({
        ...baseOptions().opts,
        expiresInSeconds: 10,
        print: () => {},
        now: () => {
          const value = clock
          clock += 6000
          return value
        },
      }),
    ).rejects.toThrow(/DEVICE_CODE_EXPIRED/)
  })
})

describe("resolveAccountSelection when the body is not a JSON object", () => {
  // `null` is valid JSON, so it parses and then every field read on it throws a
  // TypeError — which is neither a DeviceRequestError nor a `DEVICE_*` prefix, so
  // the poll loop rethrew it and login.ts's whole advice table was skipped for a
  // generic LOGIN_FAILED.
  test.each([
    ["null", "null"],
    ["a bare string", '"boom"'],
    ["a number", "7"],
    ["an array", "[]"],
    ["an empty body", ""],
  ])("a 200 whose body is %s is classified, not a TypeError", async (_label, raw) => {
    stubGlobalFetch(async () => new Response(raw, { status: 200, headers: { "Content-Type": "application/json" } }))
    const error = await resolveAccountSelection(baseOptions().opts).catch((err: unknown) => err as Error)
    expect(error).toBeInstanceOf(Error)
    expect(error.constructor.name).not.toBe("TypeError")
    expect(error.message).toMatch(/^DEVICE_STATUS_UNREADABLE:/)
    // Not a claim about the server's state machine, which is what an unreadable
    // body used to be reported as.
    expect(error.message).not.toMatch(/device state/)
  })

  // The same body on a 502 additionally lost the retryable tag, so a transient
  // failure stopped being waited out.
  test("a 502 with a null body keeps its transient classification", async () => {
    const bodies = ["null", "null", '{"code":0,"data":{"deviceStatus":"SUCCESS"}}']
    const statuses = [502, 502, 200]
    let call = 0
    stubGlobalFetch(async () => {
      const index = call++
      return new Response(bodies[index], {
        status: statuses[index],
        headers: { "Content-Type": "application/json" },
      })
    })
    await resolveAccountSelection({ ...baseOptions().opts, print: () => {} })
    expect(call).toBe(3)
  })

  test("a non-retryable status with a null body still names the status", async () => {
    stubGlobalFetch(async () => new Response("null", { status: 400, headers: { "Content-Type": "application/json" } }))
    await expect(resolveAccountSelection(baseOptions().opts)).rejects.toThrow(/DEVICE_STATUS_FAILED.*400/)
  })

  test("an unreadable body on the account commit fails the commit, not the poll", async () => {
    stubDeviceFetch([TWO_CANDIDATES], { selectResponse: () => new Response("null", { status: 200 }) })
    await expect(
      resolveAccountSelection({ ...baseOptions().opts, promptAccount: async (users) => users[0] }),
    ).rejects.toThrow(/DEVICE_STATUS_UNREADABLE: committing the account choice/)
  })
})

// A gateway that accepts the connection and then goes quiet must not hold the
// login past `expires_in`: the bound has to reach inside each request, not just
// sit between polls. Real sockets rather than a fetch stub, because the property
// under test is how fetch and its body read behave when the peer stalls.
describe("resolveAccountSelection against a gateway that stops answering", () => {
  // Never settles; `server.stop(true)` tears the connection down afterwards.
  const stall = () => new Promise<Response>(() => {})

  async function withGateway(
    handle: (path: string) => Response | Promise<Response>,
    run: (tokenEndpoint: string) => Promise<void>,
  ) {
    const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: (request) => handle(new URL(request.url).pathname) })
    try {
      await run(`http://127.0.0.1:${server.port}/clickzetta-hornhub/oauth2/token`)
    } finally {
      server.stop(true)
    }
  }

  async function expectExpiry(tokenEndpoint: string) {
    const started = Date.now()
    await expect(
      resolveAccountSelection({ ...baseOptions().opts, tokenEndpoint, expiresInSeconds: 0.3, print: () => {} }),
    ).rejects.toThrow(/DEVICE_CODE_EXPIRED/)
    // Ends at the deadline, not whenever the server lets go (it never does here).
    expect(Date.now() - started).toBeLessThan(2000)
  }

  test("a status request that never gets headers ends at expires_in", async () => {
    await withGateway(stall, expectExpiry)
  })

  test("a status response whose body stalls ends at expires_in", async () => {
    await withGateway(
      () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode('{"code":0,'))
            },
          }),
          { headers: { "Content-Type": "application/json" } },
        ),
      expectExpiry,
    )
  })

  test("an account commit that never answers ends at expires_in", async () => {
    await withGateway(
      (path) =>
        path.endsWith("/select-user")
          ? stall()
          : Response.json({
              code: 0,
              data: {
                deviceStatus: "NEED_SELECT_USER",
                result: { userSelectTicket: "t", users: [{ accountId: 1, userId: 2 }] },
              },
            }),
      expectExpiry,
    )
  })
})
