/**
 * Tier B of the history regression suite: for the highest-usage commands, assert
 * the parameter value actually reaches the outbound request.
 *
 * Tier A proves a flag still parses. That is not the same as the flag still doing
 * something: an option can survive strict validation, land in argv, and be ignored
 * by a handler that no longer reads it. Only the wire shows the difference, so
 * these cases run the real handler against the fetch boundary and assert on the
 * request the command actually produced (query string or body).
 *
 * Command selection follows usage in matrix.json — the pairs at the top of the
 * distribution (sql ≈ 255k invocations, job result ≈ 29k, runs logs ≈ 6k,
 * task/table/analytics-agent families) rather than an even sample.
 *
 * Expectations are transcribed from observed payloads, not guessed, which is why
 * several assert a TRANSLATED value: `--status SUCCESS` becomes
 * `instanceStatusList:[1]`, `--limit N` becomes `pageSize:N`, `--type lakehouse`
 * becomes `dsType:1`. Those mappings are the parameter's real effect, and a
 * translation table that silently loses an entry is exactly the failure this tier
 * exists to catch.
 */
import { beforeEach, describe, expect, setDefaultTimeout, test } from "bun:test"
import { writeFileSync } from "node:fs"
import { join } from "node:path"
import { onFetch, sqlSuccess, stubStudioContext } from "./support/cz-fixtures.js"

const { execute } = await import("../src/execute.ts")

setDefaultTimeout(20_000)

interface Recorded {
  url: string
  method: string
  body: unknown
}

/** Auth/context plumbing every studio command drives first; not part of any assertion. */
const CONTEXT_PATHS = /loginSingle|getCurrentUser|serviceInstanceList|listUserWorkspaces/

let requests: Recorded[] = []

beforeEach(() => {
  writeFileSync(
    join(process.env.CLICKZETTA_TEST_HOME!, ".clickzetta", "profiles.toml"),
    [
      "[profiles.test]",
      "pat = 'pat'",
      "workspace = 'ws'",
      "instance = 'inst'",
      "service = 'uat-api.clickzetta.com'",
      "vcluster = 'default'",
      "schema = 'public'",
      "analysis_agent_endpoint = 'https://example.clickzetta.com'",
      "",
    ].join("\n"),
  )
  requests = []
  stubStudioContext({ workspaceName: "ws" })
  // One catch-all responder: these assertions are about the REQUEST, so the reply
  // only has to be well-formed enough to keep the handler moving. The top-level job
  // shape terminates lakehouse polling immediately instead of sleeping.
  onFetch({
    match: () => true,
    respond: (url, method, body) => {
      requests.push({ url, method, body })
      return {
        code: 0,
        ...(sqlSuccess(["c"], [[1]]) as Record<string, unknown>),
        data: {
          id: 1,
          fileId: 1,
          jobId: "j1",
          total: 1,
          list: [{ id: 1, fileId: 1, dataFileName: "x", name: "x" }],
          items: [{ id: 1 }],
          records: [{ id: 1 }],
          status: { state: "SUCCEED" },
        },
      }
    },
  })
})

async function run(command: string): Promise<{ exitCode: number; wire: string[] }> {
  const result = await execute(`${command} --profile test --format json`)
  const wire = requests
    .filter((request) => !CONTEXT_PATHS.test(request.url))
    .map((request) => `${request.url} ${request.body === undefined ? "" : JSON.stringify(request.body)}`)
  return { exitCode: result.exitCode, wire }
}

/** [command, what the outbound request must contain, note] */
type Case = [command: string, expected: string, note?: string]

const CASES: Case[] = [
  // sql — 255k recorded invocations, the single busiest command
  ['sql "select 1" --limit 7', "LIMIT 8", "row cap is pushed into the SQL as limit+1 (the extra row detects truncation)"],
  ['sql "select 1" --set cz.sql.timezone=UTC', '"cz.sql.timezone":"UTC"', "query hint"],
  ['sql "select 1" --vcluster czprobe1', '"virtualCluster":"czprobe1"'],
  ['sql "select 1" --schema czprobe1', '"defaultNamespace":["ws","czprobe1"]'],
  ['sql "select 1" --async', '"hybridPollingTimeout":0', "async drops the sync polling window"],
  ['sql "select ${t}" --variable t=czprobe1', "select czprobe1", "substitution happens before submit"],
  ['sql "insert into t values(1)" --write', "insert into t values(1)", "--write releases the write guard"],
  // job — `job result` alone is ~29k invocations
  ["job result 20260101abc --timeout 2", '"id":"20260101abc"'],
  ["job status 20260101abc", '"id":"20260101abc"'],
  ["job profile 20260101abc", "jobId=20260101abc", "id goes in the query string here, not a body"],
  // runs / attempts
  ["runs list --page-size 7", '"pageSize":7'],
  ["runs list --limit 7", '"pageSize":7', "--limit is an alias of --page-size on the wire"],
  ["runs list --status SUCCESS", '"instanceStatusList":[1]', "enum mapped to the backend status code"],
  ["runs list --run-type SCHEDULE", '"instanceType":1', "enum mapped to the backend type code"],
  ["runs detail 4242", '"taskInstanceId":4242'],
  ["runs logs 4242", '"taskInstanceId":4242'],
  ["attempts list 4242", '"taskInstanceId":4242'],
  // task
  ["task list --like czprobe1", '"fileName":"czprobe1"'],
  ["task list --page-size 7", '"pageSize":7'],
  ["task list --page 3", '"page":3'],
  ["task list --limit 7", '"pageSize":7'],
  ["task search --name czprobe1", '"fileName":"czprobe1"'],
  ["task status czprobe1", '"fileName":"czprobe1"', "name resolves to an id through listFiles"],
  ["task content czprobe1", '"fileName":"czprobe1"'],
  ["task schedule-info czprobe1", '"fileName":"czprobe1"'],
  // table / schema / workspace — these compile to SQL
  ["table describe czprobe1", "DESC EXTENDED czprobe1"],
  ["table list --like czprobe1", "SHOW TABLES LIKE 'czprobe1'"],
  ["schema list", "SHOW SCHEMAS"],
  ["workspace list", "SHOW WORKSPACES"],
  // analytics-agent
  ["analytics-agent domain list", "/analytics-agent/domains"],
  ["analytics-agent metric list --domain-id 9", '"domainIds":[9]'],
  ["analytics-agent session list --domain-id 3", '"domainId":3'],
  // datasource / dqc
  ["datasource list --type lakehouse", '"dsType":1', "enum mapped to the backend datasource type"],
  ["dqc list", "/clickzetta-dqc/api/v1/rule/list"],
]

describe("history regression: parameters reach the wire", () => {
  for (const [command, expected, note] of CASES) {
    test(`${command} → ${expected}${note ? ` (${note})` : ""}`, async () => {
      const { exitCode, wire } = await run(command)
      const joined = wire.join("\n")
      if (!joined.includes(expected)) {
        throw new Error(
          [
            `cz-cli ${command}`,
            `  expected the outbound request to contain: ${expected}`,
            note ? `  (${note})` : "",
            `  exit code: ${exitCode}`,
            wire.length === 0
              ? "  no request was sent at all"
              : `  requests sent:\n${wire.map((line) => `    ${line.slice(0, 400)}`).join("\n")}`,
          ]
            .filter(Boolean)
            .join("\n"),
        )
      }
    })
  }

  test("sql refuses a write without --write, before reaching the network", async () => {
    // The write guard is client-side, so its regression signature is a request that
    // SHOULD NOT exist. Tier A cannot see this: `--write` parses either way.
    const { exitCode, wire } = await run('sql "insert into t values(1)"')
    expect(exitCode).not.toBe(0)
    expect(wire.filter((line) => line.includes("insert into t"))).toEqual([])
  })
})
