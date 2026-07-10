/**
 * Full regression test with a real compute-capable environment.
 * Run: bun test/e2e-full.ts
 */
import { execute, type ExecuteResult } from "../src/execute.ts"

const PASS = "\x1b[32m✓\x1b[0m"
const FAIL = "\x1b[31m✗\x1b[0m"

interface Test { name: string; cmd: string; check: (r: ExecuteResult) => string | null }

function ok(r: ExecuteResult) { const j = JSON.parse(r.output.trim().split("\n")[0]); return !j.error ? null : `error: ${j.error?.code} ${j.error?.message?.slice(0,60)}` }
function single(r: ExecuteResult) { return r.output.trim().split("\n").length === 1 ? null : `multi-line (${r.output.trim().split("\n").length})` }
function exitCode(n: number) { return (r: ExecuteResult) => r.exitCode === n ? null : `exit=${r.exitCode} want=${n}` }
function hasRows(r: ExecuteResult) { const j = JSON.parse(r.output.trim().split("\n")[0]); return j.rows?.length > 0 ? null : `no rows` }
function rowVal(key: string, expected: unknown) { return (r: ExecuteResult) => { const j = JSON.parse(r.output.trim().split("\n")[0]); const v = j.rows?.[0]?.[key]; return JSON.stringify(v) === JSON.stringify(expected) ? null : `${key}=${JSON.stringify(v)} want=${JSON.stringify(expected)}` }}
function all(...fns: ((r: ExecuteResult) => string | null)[]) { return (r: ExecuteResult) => { for (const f of fns) { const e = f(r); if (e) return e } return null }}

const tests: Test[] = [
  // === Connectivity ===
  { name: "status", cmd: "status", check: all(single, ok) },
  { name: "profile list", cmd: "profile list", check: all(single, ok) },

  // === Data Types (all need compute) ===
  { name: "INT", cmd: 'sql "SELECT 42 as v" --sync', check: all(single, ok, rowVal("v", 42)) },
  { name: "BIGINT", cmd: 'sql "SELECT 9999999999999 as v" --sync', check: all(single, ok, rowVal("v", 9999999999999)) },
  { name: "FLOAT 3.14", cmd: 'sql "SELECT 3.14 as v" --sync', check: all(single, ok, rowVal("v", "3.14")) },
  { name: "DECIMAL neg", cmd: 'sql "SELECT -99.99 as v" --sync', check: all(single, ok, rowVal("v", "-99.99")) },
  { name: "DECIMAL 0.001", cmd: 'sql "SELECT 0.001 as v" --sync', check: all(single, ok, rowVal("v", "0.001")) },
  { name: "BOOLEAN true", cmd: 'sql "SELECT true as v" --sync', check: all(single, ok, rowVal("v", true)) },
  { name: "BOOLEAN false", cmd: 'sql "SELECT false as v" --sync', check: all(single, ok, rowVal("v", false)) },
  { name: "NULL", cmd: 'sql "SELECT NULL as v" --sync', check: all(single, ok, rowVal("v", null)) },
  { name: "STRING", cmd: `sql "SELECT 'hello' as v" --sync`, check: all(single, ok, rowVal("v", "hello")) },
  { name: "ARITHMETIC", cmd: 'sql "SELECT 2+3 as v" --sync', check: all(single, ok, rowVal("v", 5)) },
  { name: "CAST DECIMAL", cmd: 'sql "SELECT CAST(3.14159 AS DECIMAL(10,5)) as v" --sync', check: all(single, ok, rowVal("v", "3.14159")) },
  { name: "CURRENT_TIMESTAMP", cmd: 'sql "SELECT CURRENT_TIMESTAMP() as v" --sync', check: all(single, ok, hasRows) },
  { name: "CURRENT_DATE", cmd: 'sql "SELECT CURRENT_DATE() as v" --sync', check: all(single, ok, hasRows) },
  { name: "COALESCE NULL", cmd: `sql "SELECT COALESCE(NULL, 'fallback') as v" --sync`, check: all(single, ok, rowVal("v", "fallback")) },
  { name: "ARRAY", cmd: 'sql "SELECT ARRAY(1,2,3) as v" --sync', check: all(single, ok, hasRows) },
  { name: "MAP", cmd: `sql "SELECT MAP('a',1,'b',2) as v" --sync`, check: all(single, ok, hasRows) },
  { name: "STRUCT", cmd: `sql "SELECT NAMED_STRUCT('x',1,'y',2) as v" --sync`, check: all(single, ok, hasRows) },
  { name: "UNICODE", cmd: `sql "SELECT '你好世界' as v" --sync`, check: all(single, ok, rowVal("v", "你好世界")) },
  { name: "EMPTY RESULT", cmd: 'sql "SELECT 1 WHERE 1=0" --sync', check: all(single, ok) },
  { name: "MULTI-COL", cmd: 'sql "SELECT 1 as a, 2.5 as b, true as c, NULL as d" --sync', check: all(single, ok, hasRows) },

  // === SQL Modes ===
  { name: "SYNC", cmd: 'sql "SELECT 1 as v" --sync', check: all(single, ok, hasRows) },
  { name: "ASYNC/HYBRID", cmd: 'sql "SELECT 1 as v"', check: all(single, ok) },
  { name: "MULTI-STMT", cmd: 'sql "SET cz.sql.timezone=UTC; SELECT 1 as v" --sync', check: all(single, ok) },
  { name: "VARIABLE", cmd: 'sql "SELECT ${x} as v" --variable x=99 --sync', check: all(single, ok, rowVal("v", 99)) },
  { name: "VARIABLE DOT", cmd: 'sql "SELECT ${env.var} as v" --variable env.var=99 --sync', check: all(single, ok, rowVal("v", 99)) },

  // === SQL Flags ===
  { name: "--no-truncate", cmd: 'sql "SELECT 1 as v" --sync --no-truncate', check: all(single, ok) },
  { name: "--no-header", cmd: 'sql "SELECT 1 as v" --sync --no-header', check: all(single, ok) },
  { name: "-N", cmd: 'sql "SELECT 1 as v" --sync -N', check: all(single, ok) },
  { name: "--no-limit", cmd: 'sql "SELECT 1 as v" --sync --no-limit', check: all(single, ok) },
  { name: "--batch", cmd: 'sql "SELECT 1 as v" --sync --batch', check: single },
  { name: "--with-schema", cmd: 'sql "SELECT 1 as v" --sync --with-schema', check: all(single, ok) },
  { name: "--set hint", cmd: 'sql "SELECT 1 as v" --sync --set cz.sql.timezone=UTC', check: all(single, ok) },
  { name: "--timeout", cmd: 'sql "SELECT 1 as v" --sync --timeout 30', check: all(single, ok) },
  { name: "--write allow", cmd: 'sql "SELECT 1 as v" --sync --write', check: all(single, ok) },

  // === Write Protection ===
  { name: "WRITE block", cmd: 'sql "INSERT INTO nonexist VALUES(1)"', check: all(single, exitCode(1)) },
  { name: "DANGEROUS DELETE", cmd: 'sql "DELETE FROM some_table" --write', check: all(single, exitCode(1)) },
  { name: "DANGEROUS UPDATE", cmd: 'sql "UPDATE some_table SET x=1" --write', check: all(single, exitCode(1)) },

  // === Schema/Table ===
  { name: "SCHEMA LIST", cmd: "schema list", check: all(single, ok) },
  { name: "SCHEMA LIST --like", cmd: "schema list --like 'ecommerce%'", check: all(single, ok) },
  { name: "TABLE LIST", cmd: "table list", check: all(single, ok) },
  { name: "TABLE LIST --schema", cmd: "table list --schema ecommerce_demo", check: all(single, ok) },
  { name: "TABLE DESCRIBE", cmd: "table describe orders", check: single },
  { name: "TABLE PREVIEW", cmd: "table preview orders --limit 3", check: single },

  // === Workspace ===
  { name: "WORKSPACE CURRENT", cmd: "workspace current", check: single },

  // === Output Formats ===
  { name: "JSON", cmd: "profile list --format json", check: single },
  { name: "PRETTY", cmd: "profile list --format pretty", check: ok },
  { name: "TABLE", cmd: "profile list --format table", check: (r) => r.output.trim() ? null : "empty" },
  { name: "CSV", cmd: "profile list --format csv", check: (r) => r.output.trim() ? null : "empty" },
  { name: "TOON", cmd: "profile list --format toon", check: (r) => r.output.trim() ? null : "empty" },
  { name: "JSONL", cmd: "profile list --format jsonl", check: (r) => r.output.trim() ? null : "empty" },
  { name: "--field", cmd: "status --field connected", check: (r) => r.output.trim() === "true" ? null : `got: ${r.output.trim()}` },

  // === Error Handling ===
  { name: "UNKNOWN CMD", cmd: "nonexistent", check: all(single, exitCode(2)) },
  { name: "INVALID SQL", cmd: 'sql "INVALID SYNTAX" --sync', check: all(single, exitCode(1)) },
  { name: "MISSING SQL", cmd: "sql", check: all(single, exitCode(2)) },

  // === Volume ===
  { name: "SHOW VOLUME", cmd: 'sql "SHOW USER VOLUME DIRECTORY" --sync --no-limit', check: all(single, ok) },

  // === Task/Runs ===
  { name: "TASK LIST", cmd: "task list", check: single },
  { name: "RUNS LIST", cmd: "runs list", check: single },
  { name: "ATTEMPTS LIST", cmd: "attempts list", check: single },

  // === Real Query on existing data ===
  { name: "REAL QUERY", cmd: 'sql "SELECT COUNT(*) as cnt FROM orders" --sync', check: all(single, ok, hasRows) },
  { name: "SHOW TABLES", cmd: 'sql "SHOW TABLES" --sync', check: all(single, ok) },
  { name: "SHOW SCHEMAS", cmd: 'sql "SHOW SCHEMAS" --sync', check: all(single, ok) },
  { name: "SHOW VCLUSTERS", cmd: 'sql "SHOW VCLUSTERS" --sync', check: all(single, ok, hasRows) },
  { name: "DESC TABLE", cmd: 'sql "DESC TABLE orders" --sync', check: all(single, ok, hasRows) },
]

// --- Parallel Runner ---
async function main() {
  console.log(`\nRunning ${tests.length} tests (concurrency=8)...\n`)
  const results: { name: string; ok: boolean; detail?: string; ms: number }[] = []
  const queue = [...tests]

  async function worker() {
    while (queue.length) {
      const t = queue.shift()!
      const t0 = performance.now()
      try {
        const r = await execute(t.cmd)
        const err = t.check(r)
        results.push({ name: t.name, ok: !err, detail: err ?? undefined, ms: Math.round(performance.now() - t0) })
      } catch (e: any) {
        results.push({ name: t.name, ok: false, detail: `THREW: ${e.message?.slice(0,60)}`, ms: Math.round(performance.now() - t0) })
      }
    }
  }

  await Promise.all(Array.from({ length: 8 }, () => worker()))

  const ordered = tests.map(t => results.find(r => r.name === t.name)!)
  let pass = 0, fail = 0
  for (const r of ordered) {
    if (r.ok) { pass++; console.log(`  ${PASS} ${r.name} (${r.ms}ms)`) }
    else { fail++; console.log(`  ${FAIL} ${r.name} (${r.ms}ms) → ${r.detail}`) }
  }
  console.log(`\n${pass} passed, ${fail} failed (${tests.length} total)\n`)
  process.exitCode = fail > 0 ? 1 : 0
}

main()
