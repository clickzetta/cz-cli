/**
 * End-to-end test suite for cz-cli via execute().
 * Run: bun test/e2e.ts
 */
import { execute, type ExecuteResult } from "../src/execute.ts"

const PASS = "\x1b[32m✓\x1b[0m"
const FAIL = "\x1b[31m✗\x1b[0m"
const SKIP = "\x1b[33m⊘\x1b[0m"

interface TestCase {
  name: string
  cmd: string
  assert: (r: ExecuteResult) => string | null // null = pass, string = failure reason
  skip?: boolean
}

function isJson(r: ExecuteResult): Record<string, unknown> | null {
  try { return JSON.parse(r.output?.trim().split("\n")[0]) } catch { return null }
}

function assertOk(r: ExecuteResult): string | null {
  const j = isJson(r)
  if (!j) return `not JSON: ${r.output.slice(0, 80)}`
  if (j.error) return `unexpected error: ${JSON.stringify(j.error)}`
  return null
}

function assertError(code?: string) {
  return (r: ExecuteResult): string | null => {
    const j = isJson(r)
    if (!j) return `not JSON: ${r.output?.slice(0, 80)}`
    if (!j.error) return `expected error but got no error field`
    if (code && (j.error as any)?.code !== code) return `expected code=${code} got=${(j.error as any)?.code}`
    return null
  }
}

function assertSingleLine(r: ExecuteResult): string | null {
  const lines = r.output?.trim().split("\n") ?? []
  if (lines.length !== 1) return `expected 1 line, got ${lines.length}: ${lines.slice(0, 3).join(" | ")}`
  return null
}

function assertExitCode(expected: number) {
  return (r: ExecuteResult): string | null => {
    if (r.exitCode !== expected) return `exitCode=${r.exitCode} expected=${expected}`
    return null
  }
}

function all(...checks: ((r: ExecuteResult) => string | null)[]) {
  return (r: ExecuteResult): string | null => {
    for (const check of checks) {
      const err = check(r)
      if (err) return err
    }
    return null
  }
}

const tests: TestCase[] = [
  // === 1. Basic connectivity ===
  { name: "profile list", cmd: "profile list", assert: all(assertSingleLine, assertOk) },
  { name: "status", cmd: "status", assert: all(assertSingleLine, assertOk) },

  // === 2. SQL data types ===
  { name: "SELECT int/string", cmd: 'sql "SELECT 1 as num, \'hello\' as str" --sync', assert: all(assertSingleLine, assertOk) },
  { name: "SELECT decimal", cmd: 'sql "SELECT CAST(3.14159 AS DECIMAL(10,5)) as d" --sync', assert: assertSingleLine },
  { name: "SELECT timestamp", cmd: 'sql "SELECT CURRENT_TIMESTAMP() as ts" --sync', assert: assertSingleLine },
  { name: "SELECT null", cmd: 'sql "SELECT NULL as empty, COALESCE(NULL, \'fallback\') as val" --sync', assert: assertSingleLine },
  { name: "SELECT boolean", cmd: 'sql "SELECT true as t, false as f" --sync', assert: all(assertSingleLine, assertOk) },
  { name: "SELECT array", cmd: 'sql "SELECT ARRAY(1,2,3) as arr" --sync', assert: assertSingleLine },
  { name: "SELECT map", cmd: 'sql "SELECT MAP(\'a\',1,\'b\',2) as m" --sync', assert: assertSingleLine },
  { name: "empty result", cmd: 'sql "SELECT 1 WHERE 1=0" --sync', assert: all(assertSingleLine, assertOk) },

  // === 3. SQL modes ===
  { name: "sync mode", cmd: 'sql "SELECT 42 as answer" --sync', assert: all(assertSingleLine, assertOk) },
  { name: "async/hybrid mode", cmd: 'sql "SELECT 1"', assert: all(assertSingleLine, assertOk) },
  { name: "multi-statement", cmd: 'sql "SET cz.sql.timezone=UTC; SELECT 1 as x" --sync', assert: assertSingleLine },
  { name: "double-quoted SQL text", cmd: `sql 'select "abc";' --sync`, assert: all(assertSingleLine, assertOk) },
  { name: "trailing comment after statement", cmd: `sql "select 'abc', 1 + 1; --comment" --sync`, assert: all(assertSingleLine, assertOk) },
  { name: "variable substitution", cmd: 'sql "SELECT ${val} as v" --variable val=42 --sync', assert: assertSingleLine },
  { name: "variable substitution with dot", cmd: 'sql "SELECT ${env.var} as v" --variable env.var=42 --sync', assert: assertSingleLine },
  { name: "write protection", cmd: 'sql "INSERT INTO nonexist VALUES(1)"', assert: all(assertSingleLine, assertError("WRITE_NOT_ALLOWED")) },
  { name: "missing SQL error", cmd: "sql", assert: all(assertSingleLine, assertError("USAGE_ERROR")) },

  // === 4. Schema management ===
  { name: "schema list", cmd: "schema list", assert: all(assertSingleLine, assertOk) },
  { name: "schema list --like", cmd: "schema list --like 'pub%'", assert: all(assertSingleLine, assertOk) },
  { name: "schema describe (not found)", cmd: "schema describe nonexistent_schema_xyz", assert: assertSingleLine },

  // === 5. Table management ===
  { name: "table list", cmd: "table list", assert: all(assertSingleLine, assertOk) },
  { name: "table list --schema", cmd: "table list --schema public", assert: all(assertSingleLine, assertOk) },

  // === 6. Workspace ===
  { name: "workspace current", cmd: "workspace current", assert: assertSingleLine },

  // === 7. Output formats ===
  { name: "output json", cmd: "profile list --format json", assert: assertSingleLine },
  { name: "output pretty", cmd: "profile list --format pretty", assert: (r) => {
    try { const j = JSON.parse(r.output.trim()); return j.data ? null : "no data field" } catch { return `not valid JSON: ${r.output.slice(0, 40)}` }
  }},
  { name: "output table", cmd: "profile list --format table", assert: (r) => r.output.trim() ? null : "empty output" },
  { name: "output csv", cmd: "profile list --format csv", assert: (r) => r.output.trim() ? null : "empty output" },
  { name: "output toon", cmd: "profile list --format toon", assert: (r) => r.output.trim() ? null : "empty output" },
  { name: "field extraction", cmd: "status --field connected", assert: (r) => r.output.trim() === "true" ? null : `expected 'true' got '${r.output.trim()}'` },

  // === 8. Error handling ===
  { name: "unknown command", cmd: "nonexistent", assert: all(assertSingleLine, assertError("USAGE_ERROR"), assertExitCode(2)) },
  { name: "invalid SQL", cmd: 'sql "INVALID SYNTAX HERE" --sync', assert: assertSingleLine },
  { name: "unicode/中文", cmd: 'sql "SELECT \'你好世界\' as greeting" --sync', assert: all(assertSingleLine, assertOk) },

  // === 9. SQL flags ===
  { name: "--no-truncate", cmd: 'sql "SELECT 1 as v" --sync --no-truncate', assert: all(assertSingleLine, assertOk) },
  { name: "--no-header", cmd: 'sql "SELECT 1 as v" --sync --no-header', assert: all(assertSingleLine, assertOk) },
  { name: "-N flag", cmd: 'sql "SELECT 1 as v" --sync -N', assert: all(assertSingleLine, assertOk) },
  { name: "--no-limit", cmd: 'sql "SELECT 1 as v" --sync --no-limit', assert: all(assertSingleLine, assertOk) },
  { name: "--batch", cmd: 'sql "SELECT 1 as v" --sync --batch', assert: assertSingleLine },
  { name: "--with-schema", cmd: 'sql "SELECT 1 as v" --sync --with-schema', assert: all(assertSingleLine, assertOk) },
  { name: "--set hint", cmd: 'sql "SELECT 1 as v" --sync --set cz.sql.timezone=UTC', assert: all(assertSingleLine, assertOk) },
  { name: "--timeout", cmd: 'sql "SELECT 1 as v" --sync --timeout 10', assert: all(assertSingleLine, assertOk) },
  { name: "dangerous write", cmd: 'sql "DELETE FROM some_table" --write', assert: all(assertSingleLine, assertError("DANGEROUS_WRITE")) },

  // === 10. DECIMAL precision ===
  { name: "DECIMAL 3.14", cmd: 'sql "SELECT 3.14 as d" --sync', assert: (r) => {
    const j = isJson(r); if (!j) return "not json";
    const val = (j as any).rows?.[0]?.d;
    return val === "3.14" ? null : `expected "3.14" got ${JSON.stringify(val)}`
  }},
  { name: "DECIMAL -99.99", cmd: 'sql "SELECT -99.99 as d" --sync', assert: (r) => {
    const j = isJson(r); if (!j) return "not json";
    const val = (j as any).rows?.[0]?.d;
    return val === "-99.99" ? null : `expected "-99.99" got ${JSON.stringify(val)}`
  }},
  { name: "DECIMAL 0.001", cmd: 'sql "SELECT 0.001 as d" --sync', assert: (r) => {
    const j = isJson(r); if (!j) return "not json";
    const val = (j as any).rows?.[0]?.d;
    return val === "0.001" ? null : `expected "0.001" got ${JSON.stringify(val)}`
  }},

  // === 11. Volume SQL (correct syntax) ===
  { name: "SHOW USER VOLUME", cmd: 'sql "SHOW USER VOLUME DIRECTORY" --sync --no-limit', assert: all(assertSingleLine, assertOk) },

  // === 12. Task/Runs (requires Studio access) ===
  { name: "task list", cmd: "task list", assert: assertSingleLine },
  { name: "runs list", cmd: "runs list", assert: assertSingleLine },
  { name: "attempts list", cmd: "attempts list", assert: assertSingleLine },
]

// --- Runner ---
const CONCURRENCY = 5

async function runTest(t: TestCase): Promise<{ name: string; status: "pass" | "fail" | "skip"; detail?: string; ms: number }> {
  if (t.skip) return { name: t.name, status: "skip", ms: 0 }
  const t0 = performance.now()
  const r = await execute(t.cmd)
  const ms = Math.round(performance.now() - t0)
  const err = t.assert(r)
  if (err) return { name: t.name, status: "fail", detail: err, ms }
  return { name: t.name, status: "pass", ms }
}

async function main() {
  console.log(`\nRunning ${tests.length} tests (concurrency=${CONCURRENCY})...\n`)

  const results: Awaited<ReturnType<typeof runTest>>[] = []
  const queue = [...tests]

  async function worker() {
    while (queue.length > 0) {
      const t = queue.shift()!
      results.push(await runTest(t))
    }
  }

  const workers = Array.from({ length: CONCURRENCY }, () => worker())
  await Promise.all(workers)

  // Sort by original order
  const ordered = tests.map(t => results.find(r => r.name === t.name)!)

  let pass = 0, fail = 0, skip = 0
  for (const r of ordered) {
    if (r.status === "pass") { pass++; console.log(`  ${PASS} ${r.name} (${r.ms}ms)`) }
    else if (r.status === "skip") { skip++; console.log(`  ${SKIP} ${r.name} (skipped)`) }
    else { fail++; console.log(`  ${FAIL} ${r.name} (${r.ms}ms)\n    → ${r.detail}`) }
  }

  console.log(`\n${pass} passed, ${fail} failed, ${skip} skipped (${tests.length} total)\n`)
  process.exitCode = fail > 0 ? 1 : 0
}

main()
