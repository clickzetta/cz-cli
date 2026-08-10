import { afterEach, beforeEach, expect, test } from "bun:test"
import { onFetch, stubStudioContext, sqlSuccess, requireTestHome } from "./support/cz-fixtures.js"
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"

// Network-boundary test for the `sql_split` switch in ~/.clickzetta/czcli.json: the
// real sql command runs and only /lh/submitJob is stubbed, so what is asserted is
// HOW MANY statements reached the backend and with what text.
//
// COMPOUND stands in for the server-side syntax whose ';' live INSIDE one statement
// — outside any string literal, quoted identifier, or comment, so splitSql's state
// machine cannot tell them from separators and chops the statement into three.

const { execute } = await import("../src/execute.ts")

const COMPOUND = "BEGIN SELECT 1; SELECT 2; END;"

let submitted: string[] = []
let savedXdg: string | undefined

function configFile(name = "czcli.json"): string {
  return join(requireTestHome(), ".clickzetta", name)
}

function writeConfig(content: string, name?: string): void {
  writeFileSync(configFile(name), content)
}

beforeEach(() => {
  submitted = []
  // czConfigCandidates also looks under XDG_CONFIG_HOME, which is NOT redirected to
  // the test home — leaving a developer's real value set would let their machine's
  // config decide this test's outcome.
  savedXdg = process.env.XDG_CONFIG_HOME
  delete process.env.XDG_CONFIG_HOME
  mkdirSync(join(requireTestHome(), ".clickzetta"), { recursive: true })
  rmSync(configFile(), { force: true })
  rmSync(configFile("czcli.jsonc"), { force: true })
  writeFileSync(
    join(requireTestHome(), ".clickzetta", "profiles.toml"),
    "[profiles.test]\npat = 'pat'\nworkspace = 'ws0'\ninstance = 'inst'\n",
  )
  stubStudioContext()
  onFetch({
    match: (url) => url.includes("/lh/submitJob"),
    respond: (_url, _m, body) => {
      submitted.push(((body as { jobDesc?: { sqlJob?: { query?: string[] } } })?.jobDesc?.sqlJob?.query?.[0] ?? "").trim())
      return sqlSuccess(["v"], [[1]])
    },
  })
})

afterEach(() => {
  if (savedXdg === undefined) delete process.env.XDG_CONFIG_HOME
  else process.env.XDG_CONFIG_HOME = savedXdg
})

test("splits on ';' with no config, chopping a compound statement into fragments", async () => {
  const result = await execute(`sql "${COMPOUND}" --sync`)
  expect(result.exitCode).toBe(0)
  expect(submitted).toEqual(["BEGIN SELECT 1\n;", "SELECT 2\n;", "END\n;"])
})

test('czcli.json {"sql_split": false} submits the statement verbatim', async () => {
  writeConfig('{ "sql_split": false }')
  const result = await execute(`sql "${COMPOUND}" --sync`)
  expect(result.exitCode).toBe(0)
  // One job, and the trailing ';' is not doubled by execSql's own terminator.
  expect(submitted).toEqual(["BEGIN SELECT 1; SELECT 2; END\n;"])
})

test("czcli.jsonc with comments is honoured too", async () => {
  writeConfig('{\n  // one statement carries its own ;\n  "sql_split": false,\n}', "czcli.jsonc")
  const result = await execute(`sql "${COMPOUND}" --sync`)
  expect(result.exitCode).toBe(0)
  expect(submitted).toEqual(["BEGIN SELECT 1; SELECT 2; END\n;"])
})

test("an explicit true keeps splitting on", async () => {
  writeConfig('{ "sql_split": true }')
  const result = await execute(`sql "${COMPOUND}" --sync`)
  expect(result.exitCode).toBe(0)
  expect(submitted).toHaveLength(3)
})

test("an unparseable value keeps splitting on", async () => {
  writeConfig('{ "sql_split": "flase" }')
  const result = await execute(`sql "${COMPOUND}" --sync`)
  expect(result.exitCode).toBe(0)
  expect(submitted).toHaveLength(3)
})

test("a broken config file does not break the command", async () => {
  writeConfig("{ this is not json")
  const result = await execute(`sql "SELECT 1" --sync`)
  expect(result.exitCode).toBe(0)
  expect(submitted).toEqual(["SELECT 1 LIMIT 101\n;"])
})

// The client-side USE/SET interception assumes ONE statement. With splitting off the
// input is the whole text, so a `USE …; …` prefix must reach the server instead of
// being reported as a successful context switch with the rest silently dropped.
test("a USE prefix followed by more SQL is submitted, not intercepted", async () => {
  writeConfig('{ "sql_split": false }')
  const result = await execute(`sql "USE SCHEMA public; SELECT 1 AS v" --sync`)
  expect(submitted).toEqual(["USE SCHEMA public; SELECT 1 AS v\n;"])
  expect(result.exitCode).toBe(0)
})

test("a plain USE is still handled client-side with splitting off", async () => {
  writeConfig('{ "sql_split": false }')
  const result = await execute(`sql "USE SCHEMA public;" --sync`)
  expect(result.exitCode).toBe(0)
  // applyUseStatement validates via DESC SCHEMA — the USE text itself is never a job.
  expect(submitted).toEqual(["DESC SCHEMA public\n;"])
  expect(JSON.parse(result.output.trim().split("\n")[0]!).data?.use).toBe("USE SCHEMA public")
})

test("comment-only input is still rejected with splitting off", async () => {
  writeConfig('{ "sql_split": false }')
  const result = await execute(`sql "-- nothing here" --sync`)
  expect(result.exitCode).toBe(2)
  expect(JSON.parse(result.output.trim().split("\n")[0]!).error?.code).toBe("USAGE_ERROR")
  expect(submitted).toEqual([])
})
