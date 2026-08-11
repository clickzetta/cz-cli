/**
 * Export the historical command/flag matrix from the OTel log table into
 * test/history-regression/matrix.json, the fixture the history-regression tests
 * replay.
 *
 * Run manually — it needs the `czcli` profile and network access, so it is NOT
 * part of `test:all` or CI:
 *
 *     bun script/export-history-matrix.ts            # rewrite the fixture
 *     bun script/export-history-matrix.ts --dry-run  # print the summary only
 *
 * Two things about the source data that are not obvious and that this script
 * depends on:
 *
 * 1. The command attribute cannot be grouped on directly. `parseTrackingArgs`
 *    builds its positional list with `filter(!startsWith("-"))`
 *    (src/telemetry.ts:37), so the VALUE of a leading `--profile X` lands in
 *    positional[0] and a profile name masquerades as the command name. The token
 *    stream [name, subcommand, _positional…] is therefore scanned for the first
 *    entry that is a real declared command.
 *
 * 2. Rows written before 2026-06-25 use unprefixed attribute keys
 *    (`command`/`subcommand`). They fall outside this scope, but they are counted
 *    and reported rather than silently dropped.
 *
 * Redaction is a hard requirement — the fixture is committed:
 *   - `_positional` is never persisted as text. Its tokens are only used to
 *     recover 3rd-level subcommands, and a token survives only when it is
 *     literally a command name declared in our own source (surface.commandTokens).
 *     Historical passwords and PATs cannot match one.
 *   - Flag values are persisted only for options that declare `choices` (closed,
 *     low-cardinality enums), and only when they pass a conservative shape check.
 *     Everything else records the key alone; the replay harness synthesizes a
 *     value from the declared type.
 *   - Positional VALUES are never persisted (they include customer table names,
 *     SQL text and task ids); the harness synthesizes them from the yargs
 *     declaration string.
 */
import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { execute } from "../src/execute.js"
import { SENSITIVE_KEYS } from "../src/telemetry.js"
import { buildSurface } from "../test/support/cli-surface.js"

const PROFILE = process.env.CZ_HISTORY_PROFILE ?? "czcli"
const OUT_PATH = join(import.meta.dir, "..", "test", "history-regression", "matrix.json")
const DRY_RUN = process.argv.includes("--dry-run")

/**
 * Version families that belong to this branch's lineage. `1.0.x` is deliberately
 * excluded: it is a PARALLEL, still-active lineage (748k invocations, last seen
 * 2026-08-10), not an older release of this tree. Including it here would mix two
 * code lines into one verdict. Its extra surface is reported as a differential
 * appendix instead — see queryTenDifferential(). To bring it into the asserted
 * scope, add "1.0.%" to this list and re-run.
 */
const SCOPE_VERSION_PATTERNS = ["1.17.%", "dev-v1.17%", "dev-v2.%"]

/** Top-level commands that exist only on the delegated/legacy paths, so the
 * registry walk cannot see them but the logs contain them. */
const EXTRA_TOP_COMMANDS = ["run", "llm", "serve", "exec", "logout", "version", "help", "unknown"]

const surface = buildSurface()
const TOP_COMMANDS = [
  ...new Set([...surface.commands.filter((c) => c.path.length === 1).map((c) => c.path[0]!), ...EXTRA_TOP_COMMANDS]),
].sort()
const COMMAND_TOKENS = [...surface.commandTokens].sort()
const CHOICE_KEYS = [...surface.choicesByKey.keys()].sort()

function sqlArray(values: string[]): string {
  return `array(${values.map((v) => `'${v.replace(/'/g, "''")}'`).join(",")})`
}

function versionFilter(patterns: string[], alias = "resourceattributes"): string {
  return `(${patterns.map((p) => `${alias}['service.version'] like '${p}'`).join(" or ")})`
}

interface SqlResult {
  columns: string[]
  rows: unknown[][]
}

let queryCount = 0

async function runSql(label: string, sql: string): Promise<SqlResult> {
  queryCount++
  const started = Date.now()
  const file = join(process.env.TMPDIR ?? "/tmp", `cz-history-q${queryCount}.sql`)
  writeFileSync(file, sql)
  // --no-limit: the default 100-row cap silently truncates the matrix (and a
  // limit-less query over that cap is rejected outright). --no-truncate keeps
  // long values intact.
  const result = await execute(`sql --profile ${PROFILE} --format json --no-limit --no-truncate -f ${file}`)
  if (result.exitCode !== 0) {
    throw new Error(`[${label}] query failed (exit ${result.exitCode}):\n${result.output.slice(0, 2000)}`)
  }
  const parsed = JSON.parse(result.output) as SqlResult
  console.error(`  ${label}: ${parsed.rows.length} rows in ${((Date.now() - started) / 1000).toFixed(1)}s`)
  return parsed
}

/** Column-name indexed row access, so query edits cannot silently shift fields. */
function rowReader(result: SqlResult) {
  const index = new Map(result.columns.map((c, i) => [c, i]))
  return (row: unknown[], column: string): unknown => {
    const i = index.get(column)
    if (i === undefined) throw new Error(`column '${column}' missing; got ${result.columns.join(",")}`)
    return row[i]
  }
}

/**
 * Shared CTE: one row per invocation, with the command path normalized out of the
 * positional token stream and non-command tokens discarded.
 */
function baseCte(patterns: string[]): string {
  return `
with raw as (
  select traceid, spanid, timestamp ts,
         logattributes la,
         resourceattributes['enduser.id'] uid,
         resourceattributes['service.version'] ver,
         array(
           logattributes['cz_cli.command.name'],
           logattributes['cz_cli.command.subcommand'],
           split(coalesce(logattributes['cz_cli.command.arg._positional'],''),' ')[0],
           split(coalesce(logattributes['cz_cli.command.arg._positional'],''),' ')[1],
           split(coalesce(logattributes['cz_cli.command.arg._positional'],''),' ')[2]
         ) toks
  from otel_logs
  where servicename='cz-cli'
    and logattributes['cz_cli.command.name'] is not null
    and ${versionFilter(patterns)}
    and ${PARSE_OK_PREDICATE}
),
idx as (
  select raw.*,
         case when array_contains(${sqlArray(TOP_COMMANDS)}, toks[0]) then 0
              when array_contains(${sqlArray(TOP_COMMANDS)}, toks[1]) then 1
              when array_contains(${sqlArray(TOP_COMMANDS)}, toks[2]) then 2
              when array_contains(${sqlArray(TOP_COMMANDS)}, toks[3]) then 3
              when array_contains(${sqlArray(TOP_COMMANDS)}, toks[4]) then 4
              else -1 end ci
  from raw
),
norm as (
  select traceid, spanid, ts, la, uid, ver, toks, ci,
         case when ci >= 0 then toks[ci] else '<unresolved>' end cmd,
         case when ci >= 0 and array_contains(${sqlArray(COMMAND_TOKENS)}, toks[ci+1]) then toks[ci+1] end sub,
         case when ci >= 0 and array_contains(${sqlArray(COMMAND_TOKENS)}, toks[ci+1])
                   and array_contains(${sqlArray(COMMAND_TOKENS)}, toks[ci+2]) then toks[ci+2] end sub2,
         size(filter(toks, t -> t is not null and t <> '')) npos,
         case when ver like '1.0.%' then 'ten' else 'scope' end fam
  from idx
)`
}

/**
 * Attribute keys that hold a real CLI flag name.
 *
 * The shape test is a redaction control, not tidiness. `parseTrackingArgs` keys
 * its flag map on any token starting with `-` (src/telemetry.ts:44-61), so a SQL
 * statement that opens with a `--` comment is recorded as a *flag name* — the
 * whole query, customer table names and all. Those keys also carry commas and
 * newlines, which would then fragment the joined signature into dozens of
 * pseudo-flags. A real flag name matches this pattern; anything else is a
 * telemetry artifact and is dropped before it can reach the committed fixture.
 */
const FLAG_KEY_FILTER =
  `k like 'cz_cli.command.arg.%' and k <> 'cz_cli.command.arg._positional'` +
  ` and replace(k,'cz_cli.command.arg.','') rlike '^[A-Za-z0-9][A-Za-z0-9_.-]{0,40}$'`

/**
 * Invocations that already failed at the parse layer when they were run.
 *
 * The table records failures as well as successes, so without this the matrix
 * would contain combinations that NEVER worked — `--json` instead of
 * `--format json`, `cz-cli sql query …`, a bare `mcp serve` typo — and replaying
 * them would report a regression for something that was always a user error.
 * Only yargs' own validation wording is excluded (anchored), so runtime failures
 * like a SQL syntax error or a permission denial still contribute their argv:
 * those parsed fine, which is all this suite asserts. The bare literal
 * "usage error" is in the list because cli.ts's fail handler falls back to it when
 * yargs reports no message (src/cli.ts:224) — that is how `cz-cli --update` and
 * other command-less invocations are recorded.
 */
const PARSE_OK_PREDICATE = `coalesce(logattributes['cz_cli.command.error'],'') not rlike '^(Unknown argument|Unknown arguments|Unknown command|Unknown commands|Not enough non-option arguments|Missing required argument|Invalid values|Missing subcommand for|exit_code=2|usage error)'`

/** Per-invocation flag key set, joined back to the normalized command path. */
const SIGNATURE_CTE = `,
fk as (
  select traceid, spanid, ts, replace(k,'cz_cli.command.arg.','') f
  from (select traceid, spanid, ts, la, explode(map_keys(la)) k from norm) z
  where ${FLAG_KEY_FILTER}
),
sig as (
  select traceid, spanid, ts, array_join(array_sort(collect_set(f)),',') s
  from fk group by 1,2,3
)`

/** Exploded (command, flag key, flag value) rows. */
const KV_CTE = `,
kv as (
  select cmd, sub, sub2, uid, ver, ts, fam, replace(k,'cz_cli.command.arg.','') fk, la[k] fv
  from (select cmd, sub, sub2, uid, ver, ts, fam, la, explode(map_keys(la)) k from norm) z
  where ${FLAG_KEY_FILTER}
)`

interface FlagFact {
  key: string
  hadValue: boolean
  usageCount: number
  users: number
  firstSeen: string
  lastSeen: string
}

interface Entry {
  cmd: string
  sub?: string
  sub2?: string
  flags: { key: string; hadValue: boolean }[]
  usageCount: number
  users: number
  firstSeen: string
  lastSeen: string
  positionalCountMin: number
  versions: string[]
}

interface ValueCase {
  cmd: string
  sub?: string
  sub2?: string
  key: string
  value: string
  usageCount: number
}

const iso = (value: unknown): string => (value == null ? "" : String(value).replace(" ", "T").slice(0, 19))
const str = (value: unknown): string | undefined => {
  const s = value == null ? "" : String(value)
  return s === "" ? undefined : s
}
const num = (value: unknown): number => Number(value ?? 0)
const pathKey = (cmd: string, sub?: string, sub2?: string) => [cmd, sub ?? "", sub2 ?? ""].join(" ")

async function queryScope() {
  const result = await runSql(
    "scope",
    `${baseCte(SCOPE_VERSION_PATTERNS)}
select count(*) invocations, count(distinct uid) users, min(ts) first_seen, max(ts) last_seen,
       count(distinct ver) versions, sum(case when ci < 0 then 1 else 0 end) unresolved
from norm`,
  )
  const get = rowReader(result)
  const row = result.rows[0]!
  return {
    invocations: num(get(row, "invocations")),
    users: num(get(row, "users")),
    firstSeen: iso(get(row, "first_seen")),
    lastSeen: iso(get(row, "last_seen")),
    versions: num(get(row, "versions")),
    unresolvedInvocations: num(get(row, "unresolved")),
  }
}

async function queryLegacySchemaRows() {
  const result = await runSql(
    "legacy-schema",
    `select count(*) c, max(timestamp) last_seen from otel_logs
     where servicename='cz-cli' and logattributes['command'] is not null`,
  )
  const get = rowReader(result)
  const row = result.rows[0]!
  return { rows: num(get(row, "c")), lastSeen: iso(get(row, "last_seen")) }
}

/** Attribute keys rejected by the FLAG_KEY_FILTER shape test, for the report. */
async function queryMalformedFlagKeys() {
  const result = await runSql(
    "malformed-flag-keys",
    `select count(distinct k) keys, count(*) occurrences
     from (select logattributes la, explode(map_keys(logattributes)) k from otel_logs
           where servicename='cz-cli' and ${versionFilter(SCOPE_VERSION_PATTERNS)}) z
     where k like 'cz_cli.command.arg.%' and k <> 'cz_cli.command.arg._positional'
       and not (replace(k,'cz_cli.command.arg.','') rlike '^[A-Za-z0-9][A-Za-z0-9_.-]{0,40}$')`,
  )
  const get = rowReader(result)
  const row = result.rows[0]!
  return { keys: num(get(row, "keys")), occurrences: num(get(row, "occurrences")) }
}

/** Invocations dropped by PARSE_OK_PREDICATE — they failed validation when run. */
async function queryExcludedUsageErrors() {
  const result = await runSql(
    "excluded-usage-errors",
    `select count(*) c, count(distinct logattributes['cz_cli.command.error']) distinct_messages
     from otel_logs
     where servicename='cz-cli' and logattributes['cz_cli.command.name'] is not null
       and ${versionFilter(SCOPE_VERSION_PATTERNS)} and not (${PARSE_OK_PREDICATE})`,
  )
  const get = rowReader(result)
  const row = result.rows[0]!
  return { invocations: num(get(row, "c")), distinctMessages: num(get(row, "distinct_messages")) }
}

/** One row per (command path, flag key): usage and whether a value was supplied. */
async function queryFlagFacts(): Promise<Map<string, Map<string, FlagFact>>> {
  const result = await runSql(
    "flag-facts",
    `${baseCte(SCOPE_VERSION_PATTERNS)}${KV_CTE}
select cmd, sub, sub2, fk, count(*) n_calls, count(distinct uid) users,
       min(ts) first_seen, max(ts) last_seen,
       max(case when fv is not null and fv <> 'true' then 1 else 0 end) had_value
from kv where cmd <> '<unresolved>' group by 1,2,3,4`,
  )
  const get = rowReader(result)
  const out = new Map<string, Map<string, FlagFact>>()
  for (const row of result.rows) {
    const key = pathKey(String(get(row, "cmd")), str(get(row, "sub")), str(get(row, "sub2")))
    const fact: FlagFact = {
      key: String(get(row, "fk")),
      hadValue: num(get(row, "had_value")) === 1,
      usageCount: num(get(row, "n_calls")),
      users: num(get(row, "users")),
      firstSeen: iso(get(row, "first_seen")),
      lastSeen: iso(get(row, "last_seen")),
    }
    const bucket = out.get(key) ?? new Map<string, FlagFact>()
    bucket.set(fact.key, fact)
    out.set(key, bucket)
  }
  return out
}

/**
 * Distinct values seen for options that declare `choices`. These are the only
 * historical values persisted verbatim: a closed enum is low-cardinality by
 * construction and cannot carry customer data. The shape check and the
 * SENSITIVE_KEYS exclusion run inside the query, so a value that fails them never
 * leaves the warehouse.
 */
async function queryValueCases(): Promise<ValueCase[]> {
  if (CHOICE_KEYS.length === 0) return []
  const result = await runSql(
    "choice-values",
    `${baseCte(SCOPE_VERSION_PATTERNS)}${KV_CTE}
select cmd, sub, sub2, fk, fv, count(*) n_calls
from kv
where cmd <> '<unresolved>'
  and array_contains(${sqlArray(CHOICE_KEYS)}, fk)
  and not array_contains(${sqlArray([...SENSITIVE_KEYS])}, lower(fk))
  and fv is not null and length(fv) <= 40 and fv rlike '^[A-Za-z0-9_.:+-]+$'
group by 1,2,3,4,5 order by n_calls desc`,
  )
  const get = rowReader(result)
  return result.rows.map((row) => ({
    cmd: String(get(row, "cmd")),
    sub: str(get(row, "sub")),
    sub2: str(get(row, "sub2")),
    key: String(get(row, "fk")),
    value: String(get(row, "fv")),
    usageCount: num(get(row, "n_calls")),
  }))
}

/**
 * Top command tokens that resolved to nothing. Most are profile names promoted
 * into positional[0] by the telemetry bug, but a token that looks like a command
 * and appears often is a candidate removed command, so the report lists them.
 * Restricted to a safe shape so instance/hostname-looking values are dropped.
 */
async function queryUnresolved() {
  const result = await runSql(
    "unresolved",
    `${baseCte(SCOPE_VERSION_PATTERNS)}
select toks[0] tok, count(*) c, count(distinct uid) users
from norm
where ci < 0 and toks[0] rlike '^[a-z][a-z0-9_-]{0,20}$'
group by 1 order by c desc limit 20`,
  )
  const get = rowReader(result)
  return result.rows.map((row) => ({
    token: String(get(row, "tok")),
    usageCount: num(get(row, "c")),
    users: num(get(row, "users")),
  }))
}

/**
 * Subcommand names used against a declared command GROUP that this tree does not
 * declare as a child of it.
 *
 * These are invisible to the matrix by construction: sub/sub2 are whitelisted
 * against this tree's own command names (the redaction control), so a subcommand
 * that exists only on the other lineage collapses into its parent and the entry
 * looks like a bare group invocation. `analytics-agent table columns` is the
 * clearest case — over a thousand successful invocations, and `Unknown commands:
 * columns` here.
 *
 * Reporting the raw token is safe precisely because the parent is a group with no
 * positionals: the only thing that can occupy that slot is a subcommand name, never
 * a table name or an id. Leaf commands are excluded for exactly that reason, and
 * every token reported comes from an invocation that parsed successfully on
 * whatever build ran it, so it named a real command somewhere.
 */
async function queryUndeclaredSubcommands() {
  const result = await runSql(
    "undeclared-subcommands",
    `${baseCte(SCOPE_VERSION_PATTERNS)}
select cmd, sub, tok, count(*) c, count(distinct uid) users, max(ts) last_seen
from (
  select cmd, sub, uid, ts, case when sub is null then toks[ci+1] else toks[ci+2] end tok
  from norm where ci >= 0 and cmd <> '<unresolved>'
) z
where tok rlike '^[a-z][a-z0-9-]{1,24}$'
group by 1,2,3 order by c desc`,
  )
  const get = rowReader(result)
  const out: { path: string; token: string; usageCount: number; users: number; lastSeen: string }[] = []
  for (const row of result.rows) {
    const cmd = String(get(row, "cmd"))
    const sub = str(get(row, "sub"))
    const token = String(get(row, "tok"))
    const parentPath = [cmd, sub].filter(Boolean) as string[]
    const parent = surface.byPath.get(parentPath.join(" "))
    // Only a group with no positionals can be trusted to hold a command name here.
    if (!parent || !parent.isGroup || parent.positionals.length > 0) continue
    // A group with a `$0` default child still takes positionals through it: `sql`
    // routes `sql <statement>` to `sql $0 [statement]`, so that slot holds SQL text
    // and profile names, not subcommand names. Verified necessary — without this,
    // `sql billinguat` (a workspace name, 67k invocations) was reported as a
    // subcommand.
    if (surface.byPath.has([...parentPath, "$0"].join(" "))) continue
    if (surface.byPath.has([...parentPath, token].join(" "))) continue
    out.push({
      path: parentPath.join(" "),
      token,
      usageCount: num(get(row, "c")),
      users: num(get(row, "users")),
      lastSeen: iso(get(row, "last_seen")),
    })
  }
  // Require corroboration across users and repetition. A one-off token in a
  // subcommand slot is noise (a `--format json` value that slid into the positional
  // stream, a workspace name from a malformed invocation) and, being one user's
  // typing, is the only thing here that could carry an identifier.
  return out
    .filter((item) => item.users >= 2 && item.usageCount >= 5)
    .sort((a, b) => b.usageCount - a.usageCount)
    .slice(0, 100)
}

/**
 * Surface that the parallel `1.0.x` lineage exercises and the asserted scope does
 * not. Reported, never asserted: 1.0.x is a different code line, so a flag it uses
 * says nothing about whether THIS tree regressed. Listing it keeps the exclusion
 * visible instead of silent.
 */
async function queryTenDifferential() {
  const both = [...SCOPE_VERSION_PATTERNS, "1.0.%"]
  const flags = await runSql(
    "differential-flags",
    `${baseCte(both)}${KV_CTE}
select fk, sum(case when fam='ten' then 1 else 0 end) ten_calls, count(distinct uid) users,
       max(ts) last_seen
from kv
group by 1
having max(case when fam='scope' then 1 else 0 end) = 0
order by ten_calls desc limit 200`,
  )
  const flagGet = rowReader(flags)
  const pairs = await runSql(
    "differential-commands",
    `${baseCte(both)}
select cmd, sub, sub2, sum(case when fam='ten' then 1 else 0 end) ten_calls, count(distinct uid) users,
       max(ts) last_seen
from norm
where cmd <> '<unresolved>'
group by 1,2,3
having max(case when fam='scope' then 1 else 0 end) = 0
order by ten_calls desc limit 200`,
  )
  const pairGet = rowReader(pairs)
  return {
    flags: flags.rows.map((row) => ({
      key: String(flagGet(row, "fk")),
      usageCount: num(flagGet(row, "ten_calls")),
      users: num(flagGet(row, "users")),
      lastSeen: iso(flagGet(row, "last_seen")),
    })),
    commands: pairs.rows.map((row) => ({
      path: [String(pairGet(row, "cmd")), str(pairGet(row, "sub")), str(pairGet(row, "sub2"))]
        .filter(Boolean)
        .join(" "),
      usageCount: num(pairGet(row, "ten_calls")),
      users: num(pairGet(row, "users")),
      lastSeen: iso(pairGet(row, "last_seen")),
    })),
  }
}

const SAFE_SHAPES: { test: RegExp; paths: RegExp }[] = [
  { paths: /\.(key|cmd|sub|sub2|token|path)$/, test: /^[A-Za-z0-9][A-Za-z0-9_. -]{0,60}$/ },
  { paths: /\.value$/, test: /^[A-Za-z0-9_.:+-]{1,40}$/ },
  { paths: /\.versions\[\]$/, test: /^[0-9A-Za-z.+-]{1,40}$/ },
  { paths: /\.(firstSeen|lastSeen|generatedAt)$/, test: /^[0-9T:.Z -]{1,32}$/ },
  { paths: /\.(versionPatterns\[\]|generatedBy)$/, test: /^[\w%.\-/]{1,60}$/ },
]

/**
 * Refuse to write a fixture containing a string that does not match the shape its
 * field is supposed to hold. The committed fixture is derived from logs that
 * demonstrably contain plaintext credentials and customer SQL, and the leak path
 * found while building this (SQL text arriving as a flag *name*) was not one
 * anybody predicted — so the writer validates rather than trusts the queries.
 */
function assertRedacted(matrix: unknown): void {
  const problems: string[] = []
  const walk = (node: unknown, path: string) => {
    if (Array.isArray(node)) return node.forEach((item) => walk(item, path + "[]"))
    if (node && typeof node === "object") {
      for (const [key, value] of Object.entries(node)) walk(value, `${path}.${key}`)
      return
    }
    if (typeof node !== "string") return
    const rule = SAFE_SHAPES.find((candidate) => candidate.paths.test(path))
    if (!rule) return problems.push(`${path}: no shape rule for a string field (${JSON.stringify(node).slice(0, 60)})`)
    if (!rule.test.test(node)) problems.push(`${path}: ${JSON.stringify(node).slice(0, 120)}`)
  }
  walk(matrix, "")
  if (problems.length > 0) {
    throw new Error(
      `refusing to write fixture — ${problems.length} field(s) failed the redaction shape check:\n  ` +
        problems.slice(0, 20).join("\n  "),
    )
  }
}

async function main() {
  console.error(`Exporting history matrix via profile '${PROFILE}' …`)
  console.error(`  scope: ${SCOPE_VERSION_PATTERNS.join(", ")}`)
  console.error(`  ${TOP_COMMANDS.length} top-level commands, ${COMMAND_TOKENS.length} command tokens, ${CHOICE_KEYS.length} choices-bearing options`)

  const scope = await queryScope()
  const excludedUsageErrors = await queryExcludedUsageErrors()
  const malformedFlagKeys = await queryMalformedFlagKeys()
  const legacy = await queryLegacySchemaRows()
  const facts = await queryFlagFacts()
  const entries = await querySignatures(facts)
  const valueCases = await queryValueCases()
  const unresolved = await queryUnresolved()
  const undeclaredSubcommands = await queryUndeclaredSubcommands()
  const differential = await queryTenDifferential()

  const flagKeys = new Set<string>()
  for (const bucket of facts.values()) for (const key of bucket.keys()) flagKeys.add(key)

  const matrix = {
    generatedAt: new Date().toISOString().slice(0, 19) + "Z",
    generatedBy: "script/export-history-matrix.ts",
    scope: {
      versionPatterns: SCOPE_VERSION_PATTERNS,
      ...scope,
      distinctFlagKeys: flagKeys.size,
      legacySchemaRows: legacy,
      excludedUsageErrors,
      malformedFlagKeys,
    },
    entries,
    valueCases,
    appendix: {
      unresolvedTokens: unresolved,
      undeclaredSubcommands,
      onlyInParallel10xLineage: differential,
    },
  }

  const summary = [
    `invocations in scope: ${scope.invocations.toLocaleString()} (${scope.users} users, ${scope.firstSeen} → ${scope.lastSeen})`,
    `signature entries:    ${entries.length}`,
    `value cases:          ${valueCases.length}`,
    `distinct flag keys:   ${flagKeys.size}`,
    `unresolved calls:     ${scope.unresolvedInvocations.toLocaleString()}`,
    `excluded usage errs:  ${excludedUsageErrors.invocations.toLocaleString()} (${excludedUsageErrors.distinctMessages} distinct messages)`,
    `dropped bogus keys:   ${malformedFlagKeys.keys} (${malformedFlagKeys.occurrences} occurrences)`,
    `undeclared subcmds:   ${undeclaredSubcommands.length} (top: ${undeclaredSubcommands.slice(0, 3).map((u) => `${u.path} ${u.token} ×${u.usageCount}`).join("; ") || "none"})`,
    `1.0x-only flags:      ${differential.flags.length}`,
    `1.0x-only commands:   ${differential.commands.length}`,
  ].join("\n  ")
  console.error(`\n  ${summary}\n`)

  assertRedacted(matrix)
  if (DRY_RUN) {
    console.error("--dry-run: fixture not written")
    return
  }
  mkdirSync(dirname(OUT_PATH), { recursive: true })
  writeFileSync(OUT_PATH, JSON.stringify(matrix, null, 2) + "\n")
  console.error(`wrote ${OUT_PATH}`)
}

await main()

/** One row per (command path, flag signature) — the replay matrix itself. */
async function querySignatures(facts: Map<string, Map<string, FlagFact>>): Promise<Entry[]> {
  const result = await runSql(
    "signatures",
    `${baseCte(SCOPE_VERSION_PATTERNS)}${SIGNATURE_CTE}
select n.cmd, n.sub, n.sub2, coalesce(g.s,'') sig, count(*) n_calls, count(distinct n.uid) users,
       min(n.ts) first_seen, max(n.ts) last_seen, min(n.npos) npos_min,
       array_join(array_sort(collect_set(n.ver)),',') vers
from norm n left join sig g on n.traceid=g.traceid and n.spanid=g.spanid and n.ts=g.ts
where n.cmd <> '<unresolved>'
group by 1,2,3,4 order by n_calls desc`,
  )
  const get = rowReader(result)
  const entries: Entry[] = []
  for (const row of result.rows) {
    const cmd = String(get(row, "cmd"))
    const sub = str(get(row, "sub"))
    const sub2 = str(get(row, "sub2"))
    const bucket = facts.get(pathKey(cmd, sub, sub2))
    const sig = String(get(row, "sig") ?? "")
    const keys = sig === "" ? [] : sig.split(",").filter(Boolean)
    entries.push({
      cmd,
      sub,
      sub2,
      flags: keys.map((key) => ({ key, hadValue: bucket?.get(key)?.hadValue ?? true })),
      usageCount: num(get(row, "n_calls")),
      users: num(get(row, "users")),
      firstSeen: iso(get(row, "first_seen")),
      lastSeen: iso(get(row, "last_seen")),
      positionalCountMin: num(get(row, "npos_min")),
      versions: String(get(row, "vers") ?? "").split(",").filter(Boolean).slice(0, 8),
    })
  }
  return entries
}
