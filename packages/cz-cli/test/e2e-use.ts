/**
 * End-to-end tests for USE clause support.
 * Creates a temporary schema, uses USE to switch to it, verifies
 * queries run in the correct context, then cleans up.
 * Run: bun test/e2e-use.ts
 */
import { execute, type ExecuteResult } from "../src/execute.ts"

const PASS = "\x1b[32m✓\x1b[0m"
const FAIL = "\x1b[31m✗\x1b[0m"

const TEMP_SCHEMA = `_cz_cli_test_use_${Date.now()}`

interface Test { name: string; run: () => Promise<string | null> }

function json(r: ExecuteResult): Record<string, unknown> | null {
  try { return JSON.parse(r.output.trim().split("\n")[0]) } catch { return null }
}

async function exec(cmd: string) {
  const r = await execute(cmd)
  return json(r) as any
}

async function setup(): Promise<string | null> {
  const j = await exec(`sql "CREATE SCHEMA ${TEMP_SCHEMA}" --write --sync`)
  if (j?.error) return `setup failed: ${j.error.code}: ${j.error.message}`
  // Create a marker table in the temp schema
  const t = await exec(`sql "CREATE TABLE ${TEMP_SCHEMA}._use_test_marker (id INT)" --write --sync`)
  if (t?.error) return `setup table failed: ${t.error.code}: ${t.error.message}`
  return null
}

async function teardown() {
  await execute(`sql "DROP SCHEMA ${TEMP_SCHEMA} CASCADE" --write --sync`)
}

const tests: Test[] = [
  {
    name: "USE <temp_schema>; SHOW TABLES — sees marker table",
    run: async () => {
      const j = await exec(`sql "USE ${TEMP_SCHEMA}; SHOW TABLES" --sync --no-limit`)
      if (j?.error) return `${j.error.code}: ${j.error.message}`
      const tables = j.rows?.map((r: any) => r.table_name) ?? []
      if (!tables.includes("_use_test_marker")) return `expected _use_test_marker in tables, got=${JSON.stringify(tables)}`
      return null
    },
  },
  {
    name: "USE SCHEMA <temp_schema>; SHOW TABLES — sees marker table",
    run: async () => {
      const j = await exec(`sql "USE SCHEMA ${TEMP_SCHEMA}; SHOW TABLES" --sync --no-limit`)
      if (j?.error) return `${j.error.code}: ${j.error.message}`
      const tables = j.rows?.map((r: any) => r.table_name) ?? []
      if (!tables.includes("_use_test_marker")) return `expected _use_test_marker in tables, got=${JSON.stringify(tables)}`
      return null
    },
  },
  {
    name: "Without USE — SHOW TABLES does NOT see marker table (default schema)",
    run: async () => {
      const j = await exec('sql "SHOW TABLES" --sync --no-limit')
      if (j?.error) return `${j.error.code}: ${j.error.message}`
      const tables = j.rows?.map((r: any) => Object.values(r)[0]) ?? []
      if (tables.includes("_use_test_marker")) return `marker table should NOT be in default schema`
      return null
    },
  },
  {
    name: "USE backtick-quoted schema; SHOW TABLES — sees marker table",
    run: async () => {
      const j = await exec("sql \"USE `" + TEMP_SCHEMA + "`; SHOW TABLES\" --sync --no-limit")
      if (j?.error) return `${j.error.code}: ${j.error.message}`
      const tables = j.rows?.map((r: any) => r.table_name) ?? []
      if (!tables.includes("_use_test_marker")) return `expected _use_test_marker in tables, got=${JSON.stringify(tables)}`
      return null
    },
  },
  {
    name: "USE <temp_schema>; INSERT + SELECT — operates in correct schema",
    run: async () => {
      const ins = await exec(`sql "USE ${TEMP_SCHEMA}; INSERT INTO _use_test_marker VALUES(42)" --write --sync`)
      if (ins?.error) return `insert: ${ins.error.code}: ${ins.error.message}`
      const sel = await exec(`sql "USE ${TEMP_SCHEMA}; SELECT * FROM _use_test_marker" --sync`)
      if (sel?.error) return `select: ${sel.error.code}: ${sel.error.message}`
      if (!sel.rows?.some((r: any) => r.id === 42)) return `expected row with id=42, got=${JSON.stringify(sel.rows)}`
      return null
    },
  },
  {
    name: "USE VCLUSTER default; USE <temp_schema>; SELECT — both applied",
    run: async () => {
      const j = await exec(`sql "USE VCLUSTER default; USE ${TEMP_SCHEMA}; SELECT * FROM _use_test_marker" --sync`)
      if (j?.error) return `${j.error.code}: ${j.error.message}`
      if (!j.rows || j.rows.length === 0) return `expected rows from marker table`
      return null
    },
  },
  {
    name: "USE WORKSPACE <other>; SHOW TABLES — sees tables from other workspace",
    run: async () => {
      const j = await exec('sql "USE WORKSPACE clickzetta_sample_data; USE tpch_100g; SHOW TABLES" --sync --no-limit')
      if (j?.error) return `${j.error.code}: ${j.error.message}`
      if (!j.rows || j.rows.length === 0) return `expected tables in clickzetta_sample_data.tpch_100g`
      return null
    },
  },
  {
    name: "USE WORKSPACE switches back — temp schema accessible again",
    run: async () => {
      const j = await exec(`sql "USE WORKSPACE quick_start; USE ${TEMP_SCHEMA}; SHOW TABLES" --sync --no-limit`)
      if (j?.error) return `${j.error.code}: ${j.error.message}`
      const tables = j.rows?.map((r: any) => r.table_name) ?? []
      if (!tables.includes("_use_test_marker")) return `expected _use_test_marker after switching back, got=${JSON.stringify(tables)}`
      return null
    },
  },
  {
    name: "USE in batch mode — only SQL results output",
    run: async () => {
      const r = await execute(`sql "USE ${TEMP_SCHEMA}; SELECT 1 as v; SELECT 2 as v" --sync --batch`)
      const lines = r.output.trim().split("\n")
      if (lines.length < 2) return `expected at least 2 output lines, got ${lines.length}`
      const last = JSON.parse(lines[lines.length - 1]) as any
      if (last.rows?.[0]?.v !== 2) return `expected last v=2, got=${JSON.stringify(last.rows?.[0]?.v)}`
      return null
    },
  },
]

async function main() {
  console.log(`\nSetting up temp schema: ${TEMP_SCHEMA}`)
  const setupErr = await setup()
  if (setupErr) {
    console.log(`  ${FAIL} Setup failed: ${setupErr}`)
    process.exitCode = 1
    return
  }
  console.log(`  ${PASS} Setup complete\n`)

  console.log(`Running ${tests.length} USE clause tests...\n`)
  let pass = 0, fail = 0
  try {
    for (const t of tests) {
      const t0 = performance.now()
      const err = await t.run()
      const ms = Math.round(performance.now() - t0)
      if (err) { fail++; console.log(`  ${FAIL} ${t.name} (${ms}ms)\n    → ${err}`) }
      else { pass++; console.log(`  ${PASS} ${t.name} (${ms}ms)`) }
    }
  } finally {
    console.log(`\nTearing down temp schema: ${TEMP_SCHEMA}`)
    await teardown()
    console.log(`  ${PASS} Cleanup complete`)
  }

  console.log(`\n${pass} passed, ${fail} failed (${tests.length} total)\n`)
  process.exitCode = fail > 0 ? 1 : 0
}

main()
