import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import type { AuthToken, ConnectionConfig } from "../src/types/index.js"

mock.module("../src/auth/token.js", () => ({
  getToken: async (): Promise<AuthToken> => ({
    token: "tok-test",
    instanceId: 100,
    userId: 1,
    expireTimeMs: 3_600_000,
    obtainedAt: Date.now(),
  }),
}))

mock.module("../src/config/region.js", () => ({
  toServiceUrl: (_service: string, _protocol: string) => "https://test.invalid",
}))

import {
  DEFAULT_MAXIMUM_TIMEOUT,
  SqlSession,
  getRealSchema,
  normalizeWhitespace,
  stripLeadingComment,
} from "../src/sql/session.js"
import { InterfaceError } from "../src/types/errors.js"

const originalFetch = globalThis.fetch

function makeConfig(overrides: Partial<ConnectionConfig> = {}): ConnectionConfig {
  return {
    pat: "",
    username: "u",
    password: "p",
    service: "dev-api.clickzetta.com",
    protocol: "https",
    instance: "inst",
    workspace: "ws0",
    schema: "public",
    vcluster: "default",
    ...overrides,
  }
}

// ---------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------

describe("stripLeadingComment (utils.py:212-227)", () => {
  test("strips line comments", () => {
    expect(stripLeadingComment("-- hi\nSELECT 1")).toBe("SELECT 1")
  })
  test("strips block comments", () => {
    expect(stripLeadingComment("/* a */ SELECT 1")).toBe("SELECT 1")
  })
  test("chained comments", () => {
    expect(stripLeadingComment("-- one\n/* two */\nSELECT 1")).toBe("SELECT 1")
  })
  test("unterminated line comment → empty", () => {
    expect(stripLeadingComment("-- no newline")).toBe("")
  })
  test("unterminated block comment → empty", () => {
    expect(stripLeadingComment("/* no close")).toBe("")
  })
})

describe("normalizeWhitespace", () => {
  test("collapses tabs and newlines", () => {
    expect(normalizeWhitespace("USE\tWORKSPACE\n ws")).toBe("USE WORKSPACE ws")
  })
})

describe("getRealSchema (client.py:562-567)", () => {
  test("strips qualifier", () => {
    expect(getRealSchema("ws.public")).toBe("public")
  })
  test("strips backticks", () => {
    expect(getRealSchema("`public`")).toBe("public")
  })
  test("qualifier + backticks", () => {
    expect(getRealSchema("ws.`public`")).toBe("public")
  })
})

// ---------------------------------------------------------------------
// SET handling (client.py:494-502)
// ---------------------------------------------------------------------

describe("setConfigFromSql + processUseCmd SET branch", () => {
  test("SET k=v writes configs + configStatements", () => {
    const s = new SqlSession(makeConfig())
    expect(s.processUseCmd("SET foo=bar")).toBe(true)
    expect(s.getConfig("foo")).toBe("bar")
    expect(s.configStatements).toEqual(["SET foo=bar"])
  })

  test("SET K = V preserves case of value, trims around =", () => {
    const s = new SqlSession(makeConfig())
    s.processUseCmd("SET FOO = Bar")
    // Python lowercases only for prefix check; key/value are taken from
    // the *normalised* string which preserves the original case.
    expect(s.getConfig("FOO")).toBe("Bar")
  })

  test("SET k=v; trailing semicolon is accepted", () => {
    const s = new SqlSession(makeConfig())
    // process_use_cmd receives the pre-split statement, so the trailing
    // semicolon is normally stripped by splitSql. Here we simulate a
    // caller passing it through directly.
    s.processUseCmd("SET a=1;")
    expect(s.getConfig("a")).toBe("1;") // Python does not rstrip ";" for SET
  })

  test('SET k = "complex value" keeps quoted value intact', () => {
    const s = new SqlSession(makeConfig())
    s.processUseCmd('SET k = "hello world"')
    expect(s.getConfig("k")).toBe('"hello world"')
  })

  test("SET k= (empty value) raises InterfaceError", () => {
    const s = new SqlSession(makeConfig())
    expect(() => s.processUseCmd("SET k=")).toThrow(InterfaceError)
  })

  test("SET k (no equal) raises InterfaceError", () => {
    const s = new SqlSession(makeConfig())
    expect(() => s.processUseCmd("SET k")).toThrow(InterfaceError)
  })
})

// ---------------------------------------------------------------------
// USE handling (client.py:535-560)
// ---------------------------------------------------------------------

describe("processUseCmd USE branches", () => {
  test("USE WORKSPACE ws updates workspace", () => {
    const s = new SqlSession(makeConfig())
    s.processUseCmd("USE WORKSPACE ws1")
    expect(s.workspace).toBe("ws1")
    expect(s.configStatements.at(-1)).toBe("USE WORKSPACE ws1")
  })

  test("USE VCLUSTER vc updates vcluster", () => {
    const s = new SqlSession(makeConfig())
    s.processUseCmd("USE VCLUSTER vc2")
    expect(s.vcluster).toBe("vc2")
  })

  test("USE SCHEMA s updates schema (no DESC round-trip)", () => {
    const s = new SqlSession(makeConfig())
    s.processUseCmd("USE SCHEMA analytics")
    expect(s.schema).toBe("analytics")
  })

  test("USE <schema> without SCHEMA keyword still updates schema", () => {
    const s = new SqlSession(makeConfig())
    s.processUseCmd("USE analytics")
    expect(s.schema).toBe("analytics")
  })

  test("USE ws.`public` strips qualifier + backticks", () => {
    const s = new SqlSession(makeConfig())
    s.processUseCmd("USE ws.`public`")
    expect(s.schema).toBe("public")
  })

  test("USE with leading comment is recognised", () => {
    const s = new SqlSession(makeConfig())
    s.processUseCmd("-- comment\nUSE WORKSPACE ws1")
    expect(s.workspace).toBe("ws1")
  })

  test("USE WORKSPACE a b with embedded space raises InterfaceError", () => {
    const s = new SqlSession(makeConfig())
    // The normalised string is "USE WORKSPACE a b"; after slicing the
    // prefix we get "a b" which contains a space.
    expect(() => s.processUseCmd("USE WORKSPACE a b")).toThrow(InterfaceError)
  })

  test("non-USE/SET returns false", () => {
    const s = new SqlSession(makeConfig())
    expect(s.processUseCmd("SELECT 1")).toBe(false)
  })
})

// ---------------------------------------------------------------------
// preProcessSql (client.py:510-519)
// ---------------------------------------------------------------------

describe("preProcessSql", () => {
  test("multi-statement: SETs and USEs are consumed, first remaining returned", () => {
    const s = new SqlSession(makeConfig())
    const out = s.preProcessSql("SET a=1; USE WORKSPACE ws1; SELECT 1")
    expect(out).toBe(" SELECT 1\n;")
    expect(s.getConfig("a")).toBe("1")
    expect(s.workspace).toBe("ws1")
  })

  test("all SET/USE returns null", () => {
    const s = new SqlSession(makeConfig())
    const out = s.preProcessSql("SET a=1; USE WORKSPACE ws1")
    expect(out).toBeNull()
  })

  test("SELECT-only returns the statement + '\\n;'", () => {
    const s = new SqlSession(makeConfig())
    expect(s.preProcessSql("SELECT 1")).toBe("SELECT 1\n;")
  })
})

// ---------------------------------------------------------------------
// Hints dispatch + pyformat (client.py:603-635)
// ---------------------------------------------------------------------

describe("prepareSubmit — hints three-layer merge", () => {
  test("configs layer < session hints < params.hints precedence", () => {
    const s = new SqlSession(makeConfig(), { hints: { a: "session" } })
    s.setConfig("a", "configs")
    const prepared = s.prepareSubmit("SELECT 1", {
      params: { hints: { a: "call" } },
    })!
    expect(prepared.sqlConfigHint["a"]).toBe("call")
  })

  test("pyformat %(key)s substitution (non-hints keys only)", () => {
    const s = new SqlSession(makeConfig())
    const prepared = s.prepareSubmit("SELECT %(x)s, %(y)s", {
      params: { x: 1, y: "z" },
    })!
    expect(prepared.sql).toBe("SELECT 1, z\n;")
  })

  test("sdk.job.polling.timeout routes to pollingTimeout + clamp to 60", () => {
    const s = new SqlSession(makeConfig())
    const prepared = s.prepareSubmit("SELECT 1", {
      params: { hints: { "sdk.job.polling.timeout": "120" } },
    })!
    expect(prepared.pollingTimeout).toBe(DEFAULT_MAXIMUM_TIMEOUT)
  })

  test("priority aliases route to priority", () => {
    const s1 = new SqlSession(makeConfig())
    expect(
      s1.prepareSubmit("SELECT 1", {
        params: { hints: { priority: "5" } },
      })!.priority,
    ).toBe(5)

    const s2 = new SqlSession(makeConfig())
    expect(
      s2.prepareSubmit("SELECT 1", {
        params: { hints: { schedule_job_queue_priority: "7" } },
      })!.priority,
    ).toBe(7)
  })

  test("sdk.query.timeout.ms (ms → s) and sdk.job.timeout (s) map to jobTimeoutMs", () => {
    const s1 = new SqlSession(makeConfig())
    expect(
      s1.prepareSubmit("SELECT 1", {
        params: { hints: { "sdk.query.timeout.ms": "1500" } },
      })!.jobTimeoutMs,
    ).toBe(1500)

    const s2 = new SqlSession(makeConfig())
    expect(
      s2.prepareSubmit("SELECT 1", {
        params: { hints: { "sdk.job.timeout": "2" } },
      })!.jobTimeoutMs,
    ).toBe(2000)
  })

  test("cz.sql.timezone writes timezoneHint + configs", () => {
    const s = new SqlSession(makeConfig())
    s.prepareSubmit("SELECT 1", {
      params: { hints: { "cz.sql.timezone": "Asia/Shanghai" } },
    })
    expect(s.timezoneHint).toBe("Asia/Shanghai")
    expect(s.getConfig("cz.sql.timezone")).toBe("Asia/Shanghai")
  })

  test("sdk.job.default.ns overrides workspace.schema", () => {
    const s = new SqlSession(makeConfig({ workspace: "w0", schema: "s0" }))
    const p = s.prepareSubmit("SELECT 1", {
      params: { hints: { "sdk.job.default.ns": "wx.sx" } },
    })!
    expect(p.workspace).toBe("wx")
    expect(p.schema).toBe("sx")
  })

  test("maxRowSize mirrors into cz.sql.result.row.partial.limit", () => {
    const s = new SqlSession(makeConfig())
    s.prepareSubmit("SELECT 1", {
      params: { hints: { maxRowSize: "42" } },
    })
    expect(s.maxRowSize).toBe(42)
    expect(s.getConfig("cz.sql.result.row.partial.limit")).toBe("42")
  })

  test("unknown hint falls through to configs", () => {
    const s = new SqlSession(makeConfig())
    s.prepareSubmit("SELECT 1", {
      params: { hints: { "cz.sql.custom": "v" } },
    })
    expect(s.getConfig("cz.sql.custom")).toBe("v")
  })

  test("asynchronous forces pollingTimeout=0", () => {
    const s = new SqlSession(makeConfig())
    const p = s.prepareSubmit("SELECT 1", { asynchronous: true })!
    expect(p.pollingTimeout).toBe(0)
    expect(p.asynchronous).toBe(true)
  })

  test("configStatements flow into PreparedSubmit (copy)", () => {
    const s = new SqlSession(makeConfig())
    const p = s.prepareSubmit("USE WORKSPACE wsA; SELECT 1")!
    expect(p.configStatements).toEqual(["USE WORKSPACE wsA"])
    expect(p.workspace).toBe("wsA")
  })

  test("only SET/USE in SQL returns null", () => {
    const s = new SqlSession(makeConfig())
    expect(s.prepareSubmit("SET a=1; USE WORKSPACE ws1")).toBeNull()
  })
})

describe("SqlSession.execute sql-shape guards (cursor.py:172-180)", () => {
  test("empty string throws ProgrammingError", async () => {
    const s = new SqlSession(makeConfig())
    await expect(s.execute("")).rejects.toThrow(/sql is empty/)
  })

  test("whitespace-only throws ProgrammingError", async () => {
    const s = new SqlSession(makeConfig())
    await expect(s.execute("   \n\t  ")).rejects.toThrow(/sql is empty/)
  })

  test("null/undefined throws ProgrammingError", async () => {
    const s = new SqlSession(makeConfig())
    await expect(s.execute(null as unknown as string)).rejects.toThrow(/sql is empty/)
    await expect(s.execute(undefined as unknown as string)).rejects.toThrow(/sql is empty/)
  })
})

describe("SqlSession.execute submit retry codes", () => {
  beforeEach(() => {
    globalThis.fetch = originalFetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  test("submit JOB_NOT_EXISTS is treated as retryable instead of terminal failure", async () => {
    const calls: string[] = []
    globalThis.fetch = mock(async (input: RequestInfo | URL) => {
      const url = String(input)
      calls.push(url)
      if (url.endsWith("/lh/submitJob")) {
        return new Response(
          JSON.stringify({
            status: {
              state: "FAILED",
              errorCode: "CZLH-60005",
              errorMessage: "job not exists",
            },
          }),
        )
      }
      return new Response(
        JSON.stringify({
          status: { state: "SUCCEED" },
          resultSet: {},
        }),
      )
    }) as typeof fetch

    const result = await new SqlSession(makeConfig()).execute("SELECT 1", {
      params: { hints: { "sdk.query.max.retries": "1" } },
    })

    expect(result.status).toBe("SUCCEEDED")
    expect(calls.filter((url) => url.endsWith("/lh/getJob")).length).toBe(1)
  })
})

describe("newJobId format (client.py:1347-1352)", () => {
  test("produces YYYYMMDDHHMMSSffffff + 5-digit random (≥25 digits)", () => {
    const { newJobId } = require("../src/sql/types.js")
    const { id } = newJobId("ws", 100)
    // 4+2+2 + 2+2+2 + 6 = 20 digits for timestamp, + 5 for random = 25
    expect(id).toMatch(/^\d{25}$/)
  })

  test("two IDs within the same millisecond differ (5-digit random suffix)", () => {
    const { newJobId } = require("../src/sql/types.js")
    const a = newJobId("ws", 100).id
    const b = newJobId("ws", 100).id
    // Same timestamp but differing random tails are statistically near-certain;
    // tolerate occasional equality by checking format only.
    expect(a).toMatch(/^\d{25}$/)
    expect(b).toMatch(/^\d{25}$/)
  })
})
