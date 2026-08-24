import { describe, expect, test } from "bun:test"
import { renderOutput } from "../src/output/index.ts"

/**
 * Row-shape projection for the row-oriented formats (table/csv/text/jsonl).
 *
 * The regression this locks down: `auth list` returned `{ sessions: [...] }`,
 * and because the projection only flattened when `data` WAS the list, every row
 * format printed a single row whose first cell was the whole list as JSON. The
 * shape decision now lives in exactly one place (`projectRows`), so the tests
 * below assert all four formats agree — that agreement is the actual guarantee.
 */

const ROW_FORMATS = ["table", "csv", "text", "jsonl"] as const

/** How many data rows a rendering has, per format (header lines excluded). */
function rowCount(output: string, format: string): number {
  if (output === "") return 0
  const lines = output.split("\n")
  if (format === "table") return lines.length - 2 // header + separator
  if (format === "csv") return lines.length - 1 // header
  return lines.length
}

describe("data IS the list (the plain list command)", () => {
  const payload = {
    data: [
      { session: "a", active: true },
      { session: "b", active: false },
    ],
    count: 2,
  }

  test("table renders a header plus one row per item", () => {
    expect(renderOutput(payload, "table")).toBe(
      ["session | active", "--------+-------", "a       | true  ", "b       | false "].join("\n"),
    )
  })

  test("csv renders a header plus one row per item", () => {
    expect(renderOutput(payload, "csv")).toBe("session,active\na,true\nb,false")
  })

  test("text renders tab-separated rows with no header", () => {
    expect(renderOutput(payload, "text")).toBe("a\ttrue\nb\tfalse")
  })

  test("jsonl renders one object per item", () => {
    expect(renderOutput(payload, "jsonl")).toBe('{"session":"a","active":true}\n{"session":"b","active":false}')
  })

  test("every row format sees two rows", () => {
    for (const format of ROW_FORMATS) expect(rowCount(renderOutput(payload, format), format)).toBe(2)
  })
})

describe("a list wrapped in an object is a list once the command says so", () => {
  // The exact shape of the reported bug: one array of records, scalar siblings.
  const payload = {
    data: {
      sessions: [
        { session: "robert-uat", profile_count: 1 },
        { session: "robert-cn-saas", profile_count: 4 },
      ],
      active_session: null,
      active_profile: "aigw",
    },
  }

  test("declaring the key makes every row format render rows, not one JSON cell", () => {
    for (const format of ROW_FORMATS) {
      const out = renderOutput(payload, format, undefined, "sessions")
      expect(out).not.toContain('[{"session"')
      expect(rowCount(out, format)).toBe(2)
    }
  })

  test("without the declaration the payload keeps its single-row rendering", () => {
    // Projecting on shape alone changed commands nobody had reviewed — `datasource
    // check` lost `ready` that way — so an undeclared payload is left as it was.
    expect(rowCount(renderOutput(payload, "csv"), "csv")).toBe(1)
    expect(renderOutput(payload, "csv").split("\n")[0]).toBe("sessions,active_session,active_profile")
  })

  test("text rows come from the list, not from the wrapper's keys", () => {
    expect(renderOutput(payload, "text", undefined, "sessions")).toBe("robert-uat\t1\nrobert-cn-saas\t4")
  })

  test("csv column names come from the records", () => {
    expect(renderOutput(payload, "csv", undefined, "sessions").split("\n")[0]).toBe("session,profile_count")
  })

  test("json keeps the wrapper untouched", () => {
    expect(renderOutput(payload, "json")).toBe(
      '{"data":{"sessions":[{"session":"robert-uat","profile_count":1},{"session":"robert-cn-saas","profile_count":4}],"active_session":null,"active_profile":"aigw"}}',
    )
  })

  test("--field still reaches a scalar sibling that the rows dropped", () => {
    expect(renderOutput(payload, "text", "active_profile", "sessions")).toBe("aigw")
  })
})

describe("a single result that merely contains a list stays one row", () => {
  test("array of plain values is not mistaken for the rows (auth logout)", () => {
    const payload = {
      data: { logged_out: true, session: "uat", token_removed: true, profiles_removed: ["uat_0", "uat_1"] },
    }
    expect(renderOutput(payload, "text")).toBe('true\tuat\ttrue\t["uat_0","uat_1"]')
    for (const format of ROW_FORMATS) expect(rowCount(renderOutput(payload, format), format)).toBe(1)
  })

  test("two candidate lists are ambiguous, so neither wins", () => {
    const payload = { data: { outputs: [{ a: 1 }], dependencies: [{ b: 2 }] } }
    expect(renderOutput(payload, "csv").split("\n")[0]).toBe("outputs,dependencies")
    expect(rowCount(renderOutput(payload, "csv"), "csv")).toBe(1)
  })

  test("a nested object sibling means this is a detail payload", () => {
    const payload = { data: { task_id: 7, source: { datasource: "ds" }, dependencies: [{ b: 2 }] } }
    expect(renderOutput(payload, "csv").split("\n")[0]).toBe("task_id,source,dependencies")
    expect(rowCount(renderOutput(payload, "csv"), "csv")).toBe(1)
  })

  test("an empty list is not evidence of a list payload", () => {
    const payload = { data: { name: "s", tables: [] } }
    expect(renderOutput(payload, "text")).toBe("s\t[]")
  })
})

describe("a payload that merely CONTAINS a grid is not the grid", () => {
  // `sql --batch` writes one record per statement, carrying the identity of that
  // statement alongside its result. Claiming it as the table dropped index/sql/time_ms
  // and rendered a DDL statement (no columns) as a blank line.
  const batchLine = { index: 1, sql: "select 1", columns: ["v"], rows: [[1]], count: 1, time_ms: 5 }

  test("a batch record keeps the fields that say which statement it is", () => {
    for (const format of ["csv", "table", "text"] as const) {
      const out = renderOutput(batchLine, format)
      expect(out).toContain("select 1")
      expect(out).toContain("index")
    }
  })

  test("a DDL batch record does not render as an empty line", () => {
    const ddl = { index: 2, sql: "create table t(a int)", columns: [], rows: [], count: 0, time_ms: 7 }
    expect(renderOutput(ddl, "csv")).not.toBe("")
    expect(renderOutput(ddl, "csv")).toContain("create table")
  })

  test("the bare successRows envelope is still projected", () => {
    expect(renderOutput({ columns: ["a"], rows: [[1]], count: 1, time_ms: 3 }, "csv")).toBe("a\n1")
  })

  test("an ai_message rides along without disqualifying the envelope", () => {
    expect(renderOutput({ columns: ["a"], rows: [[1]], ai_message: "hi" }, "csv")).toBe("a\n1")
  })
})

describe("scalar lists keep every value addressable", () => {
  // schema describe's `tables` and task cron-preview's `next_runs` are lists of plain
  // values; the cell grammar quotes what would otherwise read as another type.
  test("null becomes NULL and ambiguous strings are quoted, per cell grammar", () => {
    expect(renderOutput({ data: { name: "s", tables: ["t1", null, "123", ""] } }, "text", undefined, "tables"))
      .toBe('t1\nNULL\n"123"\n""')
  })

  test("csv names the column after the declared key", () => {
    expect(renderOutput({ data: { cron: "x", next_runs: ["2026-08-22"] } }, "csv", undefined, "next_runs"))
      .toBe("next_runs\n2026-08-22")
  })
})

describe("rowsKey: the command declares which field holds the list", () => {
  test("records under the declared key become the rows", () => {
    const payload = { data: { task_id: 9, tables: [{ id: 1, name: "t1" }, { id: 2, name: "t2" }] } }
    expect(renderOutput(payload, "csv", undefined, "tables")).toBe("id,name\n1,t1\n2,t2")
  })

  test("plain values under the declared key become a column named after it", () => {
    const payload = { data: { cron: "0 0 * * *", next_runs: ["2026-08-22", "2026-08-23"], count: 2 } }
    expect(renderOutput(payload, "csv", undefined, "next_runs")).toBe("next_runs\n2026-08-22\n2026-08-23")
    expect(renderOutput(payload, "text", undefined, "next_runs")).toBe("2026-08-22\n2026-08-23")
  })

  test("scalar siblings are not part of the projected table", () => {
    const payload = { data: { region: "cn", instances: [{ id: 1 }], count: 1 } }
    expect(renderOutput(payload, "csv", undefined, "instances")).toBe("id\n1")
  })

  test("a declared key that is absent leaves the single-row rendering", () => {
    const payload = { data: { region: "cn", instances: [{ id: 1 }] } }
    expect(renderOutput(payload, "csv", undefined, "missing").split("\n")[0]).toBe("region,instances")
  })

  test("a declared key that is not a list leaves the single-row rendering", () => {
    const payload = { data: { region: "cn", instances: { id: 1 } } }
    expect(renderOutput(payload, "csv", undefined, "region")).toBe("region,instances\ncn,\"{\"\"id\"\":1}\"")
  })

  test("a declared key holding an empty list renders nothing", () => {
    const payload = { data: { task_id: 9, tables: [] } }
    for (const format of ROW_FORMATS) expect(renderOutput(payload, format, undefined, "tables")).toBe("")
  })

  test("json output ignores rowsKey entirely", () => {
    const payload = { data: { task_id: 9, tables: [{ id: 1 }] } }
    expect(renderOutput(payload, "json", undefined, "tables")).toBe('{"data":{"task_id":9,"tables":[{"id":1}]}}')
  })
})

describe("ragged records", () => {
  const payload = { data: [{ a: 1 }, { b: 2 }] }

  test("columns are the union of all keys, in first-appearance order", () => {
    expect(renderOutput(payload, "csv")).toBe("a,b\n1,NULL\nNULL,2")
  })

  test("jsonl emits the original objects rather than padded reconstructions", () => {
    expect(renderOutput(payload, "jsonl")).toBe('{"a":1}\n{"b":2}')
  })
})

describe("lists of plain values", () => {
  const payload = { data: ["one", "two"], count: 2 }

  test("csv names the single column 'value'", () => {
    expect(renderOutput(payload, "csv")).toBe("value\none\ntwo")
  })

  test("text prints one value per line", () => {
    expect(renderOutput(payload, "text")).toBe("one\ntwo")
  })

  test("text quotes values that would otherwise read as another type", () => {
    // Same rule as any other cell: "NULL" the string must not look like NULL.
    expect(renderOutput({ data: ["NULL", "1", "x"] }, "text")).toBe('"NULL"\n"1"\nx')
  })

  test("jsonl emits one value per line", () => {
    expect(renderOutput(payload, "jsonl")).toBe('"one"\n"two"')
  })
})

describe("empty and non-tabular payloads", () => {
  test("an empty list renders nothing in every row format", () => {
    for (const format of ROW_FORMATS) expect(renderOutput({ data: [], count: 0 }, format)).toBe("")
  })

  test("an empty result object renders an empty single row", () => {
    expect(renderOutput({ data: {} }, "text")).toBe("")
  })

  test("a payload with no data key falls back to JSON, per format's own habit", () => {
    // text/jsonl are machine-facing and stay on one line; table/csv are read by
    // people and indent. e2e-routing parses the text fallback as JSON.
    expect(renderOutput({ note: "hi" }, "text")).toBe('{"note":"hi"}')
    expect(renderOutput({ note: "hi" }, "jsonl")).toBe('{"note":"hi"}')
    expect(renderOutput({ note: "hi" }, "table")).toBe('{\n  "note": "hi"\n}')
    expect(renderOutput({ note: "hi" }, "csv")).toBe('{\n  "note": "hi"\n}')
  })

  test("a scalar data value falls back the same way", () => {
    expect(renderOutput({ data: "hi" }, "text")).toBe('{"data":"hi"}')
  })

  test("an error envelope in a row format is left to the error renderer", () => {
    // error() routes through renderErrorOutput, which prints the ERROR line; a
    // raw renderOutput call (the startup gates in run-cli.ts) still gets JSON.
    expect(renderOutput({ error: { code: "NO_LLM_CONFIGURED", message: "none" } }, "text")).toBe(
      '{"error":{"code":"NO_LLM_CONFIGURED","message":"none"}}',
    )
  })
})

describe("the SQL envelope (columns + rows) is already a table", () => {
  const payload = { columns: ["id", "name"], rows: [[1, "a"], [2, "b"]], count: 2 }

  test("all four row formats project it identically", () => {
    expect(renderOutput(payload, "csv")).toBe("id,name\n1,a\n2,b")
    expect(renderOutput(payload, "text")).toBe("1\ta\n2\tb")
    expect(renderOutput(payload, "jsonl")).toBe('{"id":1,"name":"a"}\n{"id":2,"name":"b"}')
    expect(rowCount(renderOutput(payload, "table"), "table")).toBe(2)
  })

  test("zero rows still print the header for table and csv", () => {
    const empty = { columns: ["id"], rows: [], count: 0 }
    expect(renderOutput(empty, "csv")).toBe("id")
    expect(renderOutput(empty, "table")).toBe("id\n--")
    expect(renderOutput(empty, "text")).toBe("")
  })
})

/**
 * The shapes real commands actually emit, mirrored by hand from their `success()`
 * call sites (path:line in each case). These are fixtures, not introspection: if
 * a command's payload changes, its entry here has to change with it. What they
 * buy is a single place that answers "does every list-shaped payload in this CLI
 * still render as rows, and does every single-result payload still render as one
 * row" — the audit that found the `auth list` bug, frozen as a test.
 */
describe("catalog of real command payload shapes", () => {
  const cases: {
    site: string
    payload: Record<string, unknown>
    rowsKey?: string
    rows: number
    /** Set where a JSON-in-a-cell rendering is the honest answer, with the reason. */
    jsonCells?: string
  }[] = [
    {
      site: "auth.ts:207 — auth list (list is the payload)",
      payload: { data: [{ session: "uat", active: true, profiles: ["uat_0"] }], count: 1, active_session: "uat" },
      rows: 1,
    },
    {
      site: "auth.ts:167 — auth logout (single result)",
      payload: { data: { logged_out: true, session: "uat", token_removed: true, profiles_removed: ["uat_0"] } },
      rows: 1,
    },
    {
      site: "auth.ts:232 — auth status (single result)",
      payload: { data: { logged_in: true, active_profile: "uat_0", session: "uat", expired: false } },
      rows: 1,
    },
    {
      site: "profile.ts:222 — profile list (list is the payload)",
      payload: { data: [{ name: "a", is_default: true }, { name: "b", is_default: false }], count: 2 },
      rows: 2,
    },
    {
      site: "schema.ts:78 — schema describe",
      payload: { data: { name: "s", type: "MANAGED", table_count: 2, tables: [{ name: "t1" }, { name: "t2" }] } },
      rowsKey: "tables",
      rows: 2,
    },
    {
      site: "sql.ts:599 — sql --dry-run over multiple statements",
      payload: { data: { statements: [{ sql: "select 1", status: "ok" }, { sql: "select 2", status: "ok" }], count: 2 } },
      rowsKey: "statements",
      rows: 2,
    },
    {
      site: "analytics-agent.ts:1115 — batch enable/disable",
      payload: { data: { total: 2, succeeded: 1, failed: 1, skipped: 0, results: [{ id: 1, result: "ok" }, { id: 2, result: "failed" }] } },
      rowsKey: "results",
      rows: 2,
    },
    {
      site: "task.ts:509 — task cdc list",
      payload: { data: { tasks: [{ id: 1, name: "t" }] } },
      rowsKey: "tasks",
      rows: 1,
    },
    {
      site: "task.ts:538 — task cdc tables",
      payload: { data: { task_id: 7, tables: [{ id: 1, name: "t1" }, { id: 2, name: "t2" }] } },
      rowsKey: "tables",
      rows: 2,
    },
    {
      site: "task.ts:4204 — task cron-preview (list of plain values)",
      payload: { data: { cron: "0 0 * * *", next_runs: ["2026-08-22", "2026-08-23"], count: 2 } },
      rowsKey: "next_runs",
      rows: 2,
    },
    {
      site: "profile-bootstrap.ts:725 — profile list-workspaces (two lists, one declared)",
      payload: {
        data: {
          region: "cn",
          instances: [{ instance_name: "i1" }, { instance_name: "i2" }],
          workspaces_by_instance: { i1: ["ws"], i2: [] },
        },
      },
      rowsKey: "instances",
      rows: 2,
    },
    {
      site: "datasource.ts:581 — datasource check",
      payload: { data: { datasource: "ds", ds_type: 3, checks: [{ check: "binlog", ok: true }], ready: true } },
      rowsKey: "checks",
      rows: 1,
    },
    {
      site: "task.ts:473 — task cdc table op (ids are not rows)",
      payload: { data: { task_id: 7, action: "start", table_ids: [1, 2, 3], result: true } },
      rows: 1,
    },
    {
      site: "dqc.ts:288 — dqc update (changed field names are not rows)",
      payload: { data: { rule_id: 5, updated: ["sql", "checker"] } },
      rows: 1,
    },
    {
      site: "task.ts:2620 — task lineage (two candidate lists, so one row)",
      payload: { data: { task_id: 7, outputs: [{ table: "a" }], dependencies: [{ task: "b" }] } },
      rows: 1,
      jsonCells: "upstream and downstream are two tables; a row format can only pick one, so it picks neither. Declare rowsKey to choose.",
    },
    {
      site: "integration.ts:1188 — sync detail (no rowsKey, so one row)",
      payload: { data: { task_id: 7, sync_type: "single", column_mapping: [{ src: "a", dst: "b" }, { src: "c", dst: "d" }] } },
      rows: 1,
      jsonCells: "the mapping is one field of a task-creation result, not the result; it renders as a cell until a maintainer decides otherwise",
    },
    {
      site: "status.ts:35 — status (flat single result)",
      payload: { data: { connected: true, workspace: "ws", schema: "public", cli_version: "1.0.0" } },
      rows: 1,
    },
  ]

  for (const { site, payload, rowsKey, rows, jsonCells } of cases) {
    test(site, () => {
      for (const format of ROW_FORMATS) {
        const out = renderOutput(payload, format, undefined, rowsKey)
        expect(rowCount(out, format), `${format} row count`).toBe(rows)
        // No row format may hide a list of records inside a single cell, except
        // where the payload itself is genuinely ambiguous (see jsonCells).
        if (!jsonCells) expect(out, `${format} has a JSON list in a cell`).not.toMatch(/\[\{|\[\\?"\{/)
      }
    })
  }
})
