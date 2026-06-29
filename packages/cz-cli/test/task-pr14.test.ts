/**
 * Regression tests for PR #14 — display fixes, cron fallback, CDC validation, help text.
 * Run: bun test/task-pr14.test.ts
 *
 * Requires a default profile + compute-capable environment (datasources, tasks).
 * Automatically skips tests when prerequisite data is absent.
 */
import { describe, test, expect, beforeAll } from "bun:test"
import { execute, type ExecuteResult } from "../src/execute.ts"
import { spawnSync } from "child_process"
import { resolve } from "path"

function json(r: ExecuteResult): Record<string, unknown> {
  const lines = r.output.trim().split("\n")
  const jsonLine = lines.find(l => l.trim().startsWith("{") || l.trim().startsWith("["))
  if (!jsonLine) throw new Error(`no JSON in output: ${r.output.slice(0, 100)}`)
  const parsed = JSON.parse(jsonLine) as Record<string, unknown>
  console.log(">>> output:", JSON.stringify(parsed).slice(0, 200))
  return parsed
}

function jdata(r: ExecuteResult): unknown {
  return (json(r).data ?? json(r)) as unknown
}

/** Resolve a known-good datasource id/name for queries that need one. */
let _dsId: number | undefined
let _dsName: string | undefined

beforeAll(async () => {
  const r = await execute("datasource list --page-size 1")
  if (r.exitCode === 0) {
    const j = json(r)
    const data = (j.data as Record<string, unknown>[]) ?? []
    if (data.length > 0) {
      _dsId = data[0].id as number
      _dsName = data[0].name as string
    }
  }
  if (!_dsId) console.log("⊘ no datasources — datasource-dependent tests will skip")
})

// ── 1. task list display ────────────────────────────────────────────────

describe("task list", () => {
  test("returns data array with task_id, task_name, task_type, task_edit_state", async () => {
    const r = await execute("task list --page-size 3")
    expect(r.exitCode).toBe(0)
    const j = json(r)
    expect(j.error).toBeUndefined()
    const data = j.data as Record<string, unknown>[]
    expect(Array.isArray(data)).toBe(true)
    if (data.length > 0) {
      const t = data[0]
      // These were showing None before the fix
      expect(t.task_id).toBeDefined()
      expect(t.task_name).toBeDefined()
      expect(t.task_type).toBeDefined()
      expect(t.task_edit_state).toBeDefined()
      expect(typeof t.task_id).toBe("number")
      expect(typeof t.task_name).toBe("string")
    }
  })
})

// ── 2. task list-folders display ────────────────────────────────────────

describe("task list-folders", () => {
  test("returns folders with name field populated", async () => {
    const r = await execute("task list-folders --page-size 10")
    expect(r.exitCode).toBe(0)
    const j = json(r)
    expect(j.error).toBeUndefined()
    const data = j.data as Record<string, unknown>[]
    expect(Array.isArray(data)).toBe(true)
    if (data.length > 0) {
      for (const f of data) {
        expect(f.id).toBeDefined()
        // name was null before fix — now should be populated
        expect(f.name).toBeDefined()
        expect(typeof f.name).toBe("string")
      }
    }
  })
})

// ── 3. cron-preview local fallback ──────────────────────────────────────

describe("cron-preview", () => {
  test("returns non-empty next_runs array (local fallback)", async () => {
    const r = await execute('task cron-preview "0 0/5 * * * ?" --count 3')
    expect(r.exitCode).toBe(0)
    const j = json(r)
    expect(j.error).toBeUndefined()
    const data = (j.data ?? j) as Record<string, unknown>
    const runs = data.next_runs as string[]
    expect(Array.isArray(runs)).toBe(true)
    expect(runs.length).toBeGreaterThan(0)
    // Each should be a date-like string
    for (const run of runs) {
      expect(run).toMatch(/\d{4}-\d{2}-\d{2}/)
    }
  })

  test("handles 7-field cron with year wildcard", async () => {
    const r = await execute('task cron-preview "0 30 9 * * ? *" --count 2')
    expect(r.exitCode).toBe(0)
    const j = json(r)
    const data = (j.data ?? j) as Record<string, unknown>
    expect(data.count as number).toBeGreaterThan(0)
  })
})

// ── 4. datasource check-cdc ─────────────────────────────────────────────

describe("datasource check-cdc", () => {
  test("MySQL — returns checks with log_bin/binlog_format/binlog_row_image", async () => {
    if (!_dsName) { console.log("⊘ skip: no datasource"); return }
    // Use a MySQL datasource if available
    const listR = await execute("datasource list --type mysql --page-size 1")
    const listJ = json(listR)
    const data = (listJ.data as Record<string, unknown>[]) ?? []
    if (data.length === 0) { console.log("⊘ skip: no MySQL datasource"); return }
    const dsName = data[0].name as string

    const r = await execute(`datasource check-cdc "${dsName}"`)
    expect(r.exitCode).toBe(0)
    const j = json(r)
    expect(j.error).toBeUndefined()

    const d = j.data as Record<string, unknown>
    expect(d.datasource).toBe(dsName)
    expect(d.ds_type).toBeDefined()
    expect(Array.isArray(d.checks)).toBe(true)
    const checks = d.checks as Record<string, unknown>[]
    if (checks.length > 0) {
      for (const c of checks) {
        expect(c.name).toBeDefined()
        expect(c.required).toBeDefined()
        expect(c.actual).toBeDefined()
        expect(typeof c.pass).toBe("boolean")
      }
    }
  })

  test("PostgreSQL — returns checks with wal_level/replication_slot", async () => {
    const listR = await execute("datasource list --type postgresql --page-size 1")
    const listJ = json(listR)
    const data = (listJ.data as Record<string, unknown>[]) ?? []
    if (data.length === 0) { console.log("⊘ skip: no PG datasource"); return }
    const dsName = data[0].name as string

    const r = await execute(`datasource check-cdc "${dsName}"`)
    expect(r.exitCode).toBe(0)
    const j = json(r)
    expect(j.error).toBeUndefined()
    const d = j.data as Record<string, unknown>
    expect(d.ds_type).toBeDefined()
    const checks = d.checks as Record<string, unknown>[]
    // wal_level and replication_slot are standard PG CDC checks
    const checkNames = checks.map(c => c.name)
    expect(checkNames.some(n => String(n).includes("wal"))).toBe(true)
  })

  test("Oracle — returns ready=false with cdc_support check", async () => {
    const listR = await execute("datasource list --type oracle --page-size 1")
    const listJ = json(listR)
    const data = (listJ.data as Record<string, unknown>[]) ?? []
    if (data.length === 0) { console.log("⊘ skip: no Oracle datasource"); return }
    const dsName = data[0].name as string

    const r = await execute(`datasource check-cdc "${dsName}"`)
    expect(r.exitCode).toBe(0)
    const j = json(r)
    expect(j.error).toBeUndefined()
    const d = j.data as Record<string, unknown>
    expect(d.ready).toBe(false)  // Oracle not supported for CDC
    const checks = d.checks as Record<string, unknown>[]
    expect(checks.length).toBeGreaterThan(0)
    expect(checks[0].name).toBe("cdc_support")
    expect(checks[0].pass).toBe(false)
  })

  test("SQL Server — returns checks with cdc_enabled/sql_server_agent", async () => {
    const listR = await execute("datasource list --type sqlserver --page-size 1")
    const listJ = json(listR)
    const data = (listJ.data as Record<string, unknown>[]) ?? []
    if (data.length === 0) { console.log("⊘ skip: no SQL Server datasource"); return }
    const dsName = data[0].name as string

    const r = await execute(`datasource check-cdc "${dsName}"`)
    expect(r.exitCode).toBe(0)
    const j = json(r)
    expect(j.error).toBeUndefined()
    const d = j.data as Record<string, unknown>
    const checks = d.checks as Record<string, unknown>[]
    const checkNames = checks.map(c => c.name)
    expect(checkNames.some(n => String(n).includes("cdc"))).toBe(true)
    expect(checkNames.some(n => String(n).includes("agent"))).toBe(true)
  })

  test("Kafka — returns ready=true (no CDC checks needed)", async () => {
    const listR = await execute("datasource list --type kafka --page-size 1")
    const listJ = json(listR)
    const data = (listJ.data as Record<string, unknown>[]) ?? []
    if (data.length === 0) { console.log("⊘ skip: no Kafka datasource"); return }
    const dsName = data[0].name as string

    const r = await execute(`datasource check-cdc "${dsName}"`)
    expect(r.exitCode).toBe(0)
    const j = json(r)
    expect(j.error).toBeUndefined()
    const d = j.data as Record<string, unknown>
    expect(d.ready).toBe(true)
  })
})

// ── 5. dsType whitelist (create-realtime-sync blocks unsupported) ───────

describe("create-realtime-sync dsType whitelist", () => {
  test("blocks Kafka datasource with UNSUPPORTED_DATASOURCE", async () => {
    const listR = await execute("datasource list --type kafka --page-size 1")
    const listJ = json(listR)
    const data = (listJ.data as Record<string, unknown>[]) ?? []
    if (data.length === 0) { console.log("⊘ skip: no Kafka datasource"); return }
    const dsName = data[0].name as string

    // Need a valid folder id — use root (0) for test
    const ts1 = Date.now() % 99999
    const r = await execute(`task create-realtime-sync pr14_kafka_${ts1} --folder 0 --source "${dsName}" --database test`)
    expect(r.exitCode).not.toBe(0)
    const j = json(r)
    expect(j.error).toBeDefined()
    expect((j.error as Record<string, unknown>).code).toBe("UNSUPPORTED_DATASOURCE")
  })

  test("blocks Oracle create-realtime-sync at backend (check-cdc rejects)", async () => {
    const listR = await execute("datasource list --type oracle --page-size 1")
    const listJ = json(listR)
    const data = (listJ.data as Record<string, unknown>[]) ?? []
    if (data.length === 0) { console.log("⊘ skip: no Oracle datasource"); return }
    const dsName = data[0].name as string

    const ts = Date.now() % 100000
    const r = await execute(`task create-realtime-sync pr14_ora_${ts} --folder 0 --source "${dsName}" --database XE --skip-check`)
    expect(r.exitCode).not.toBe(0)
    const j = json(r)
    expect(j.error).toBeDefined()
    // Either whitelist rejection, backend NPE, or CDC check failure — all errors
  })
})

// ── 6. task status — returns edit_state ─────────────────────────────────

describe("task status", () => {
  test("returns edit_state field for a known task", async () => {
    const listR = await execute("task list --page-size 1")
    const listJ = json(listR)
    const data = (listJ.data as Record<string, unknown>[]) ?? []
    if (data.length === 0) { console.log("⊘ skip: no tasks"); return }
    const taskId = data[0].task_id as number

    const r = await execute(`task status ${taskId}`)
    expect(r.exitCode).toBe(0)
    const j = json(r)
    expect(j.error).toBeUndefined()
    const d = j.data as Record<string, unknown>
    expect(d.edit_state).toBeDefined()
    expect(["draft", "published", "offline"]).toContain(d.edit_state as string)
  })
})

// ── 7. task content — returns task_content + schedule_config ─────────────

describe("task content", () => {
  test("returns task_name, task_content, schedule_config, studio_url", async () => {
    const listR = await execute("task list --page-size 1")
    const listJ = json(listR)
    const data = (listJ.data as Record<string, unknown>[]) ?? []
    if (data.length === 0) { console.log("⊘ skip: no tasks"); return }
    const taskId = data[0].task_id as number

    const r = await execute(`task content ${taskId}`)
    expect(r.exitCode).toBe(0)
    const j = json(r)
    expect(j.error).toBeUndefined()
    const d = j.data as Record<string, unknown>
    expect(d.task_id).toBeDefined()
    expect(d.task_name).toBeDefined()
    expect(d.studio_url).toBeDefined()
    // schedule_config always present (may be empty for draft tasks)
    expect(d.schedule_config).toBeDefined()
  })
})

// ── 8. task search ──────────────────────────────────────────────────────

describe("task search", () => {
  test("returns results with task_id, task_name, path", async () => {
    const r = await execute("task search --limit 5")
    expect(r.exitCode).toBe(0)
    const j = json(r)
    expect(j.error).toBeUndefined()
    const data = j.data as Record<string, unknown>[]
    expect(Array.isArray(data)).toBe(true)
    if (data.length > 0) {
      const t = data[0]
      expect(t.task_id).toBeDefined()
      expect(t.task_name).toBeDefined()
      expect(t.path).toBeDefined()
    }
  })
})

// ── 9. task folder-tree ─────────────────────────────────────────────────

describe("task folder-tree", () => {
  test("returns flat list with id, name, parent_id, depth, path", async () => {
    const r = await execute("task folder-tree")
    expect(r.exitCode).toBe(0)
    const j = json(r)
    expect(j.error).toBeUndefined()
    const data = j.data as Record<string, unknown>[]
    expect(Array.isArray(data)).toBe(true)
    if (data.length > 0) {
      const f = data[0]
      expect(f.id).toBeDefined()
      expect(f.name).toBeDefined()
      // indent/depth field depends on API version
      expect(typeof f.indent !== "undefined" || typeof f.depth !== "undefined").toBe(true)
    }
  })
})

// ── 10. task stats ──────────────────────────────────────────────────────

describe("task stats", () => {
  test("returns tasks and run_instances counts", async () => {
    const r = await execute("task stats")
    expect(r.exitCode).toBe(0)
    const j = json(r)
    expect(j.error).toBeUndefined()
    const d = j.data as Record<string, unknown>
    expect(d.tasks).toBeDefined()
    expect(d.run_instances).toBeDefined()
    const tasks = d.tasks as Record<string, number>
    expect(typeof tasks.total).toBe("number")
  })
})

// ── 11. task downstream ─────────────────────────────────────────────────

describe("task downstream", () => {
  test("returns array with mapped task_id and task_name", async () => {
    // Find a task that has dependencies
    const listR = await execute("task list --page-size 10")
    const listJ = json(listR)
    const data = (listJ.data as Record<string, unknown>[]) ?? []
    if (data.length === 0) { console.log("⊘ skip: no tasks"); return }
    // Try first deployed task — it may have downstreams
    const taskId = data[0].task_id as number

    const r = await execute(`task downstream ${taskId}`)
    expect(r.exitCode).toBe(0)
    const j = json(r)
    expect(j.error).toBeUndefined()
    const items = j.data as Record<string, unknown>[]
    expect(Array.isArray(items)).toBe(true)
    if (items.length > 0) {
      const item = items[0]
      // These were None before fix
      expect(item.task_id).toBeDefined()
      expect(item.task_name).toBeDefined()
      expect(typeof item.task_id).toBe("number")
      expect(typeof item.task_name).toBe("string")
    }
  })
})

// ── 12. schedule-info — field mapping ────────────────────────────────────

describe("schedule-info", () => {
  test("returns mapped snake_case fields for deployed cron task", async () => {
    // Find a deployed SQL/PYTHON/SHELL task (not UI-only types like MULTI_REALTIME)
    const listR = await execute("task list --page-size 20")
    const listJ = json(listR)
    const data = (listJ.data as Record<string, unknown>[]) ?? []
    const NON_UI_TYPES = new Set([4, 5, 7, 15, 24]) // SQL, SHELL, PYTHON, JDBC
    const deployed = data.filter(t => t.task_edit_state === 20 && NON_UI_TYPES.has(t.task_type as number))
    if (deployed.length === 0) { console.log("⊘ skip: no deployed script tasks"); return }

    // Try each deployed task until schedule-info returns data or we exhaust
    let found = false
    for (const t of deployed.slice(0, 3)) {
      const taskId = t.task_id as number
      const r = await execute(`task schedule-info ${taskId}`)
      // schedule-info may error if task has no schedule entry — acceptable
      if (r.exitCode !== 0) continue
      const j = json(r)
      expect(j.error).toBeUndefined()
      const d = j.data
      if (d && typeof d === "object" && Object.keys(d as object).length > 0) {
        const sd = d as Record<string, unknown>
        expect(sd.task_id).toBeDefined()
        expect(sd.task_name).toBeDefined()
        if (sd.cron_expression !== undefined) {
          expect(typeof sd.cron_expression).toBe("string")
        }
        found = true
        break
      }
    }
    if (!found) console.log("⊘ note: no deployed task with schedule entry returned data")
  })
})

// ── 13. help texts — use spawnSync (help output goes to stderr) ─────────

function help(args: string[]): string {
  const entry = process.env.CZ_CLI_BIN
    ? [process.env.CZ_CLI_BIN]
    : [resolve(process.cwd(), "src/main.ts")]
  const r = spawnSync(process.execPath, [...entry, ...args], {
    encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"], timeout: 10_000,
  })
  return (r.stdout ?? "") + (r.stderr ?? "")
}

describe("help texts", () => {
  test("task create --help mentions workflow", () => {
    const out = help(["task", "create", "--help"])
    expect(out).toMatch(/workflow/)
    expect(out).toMatch(/DYNAMIC_TABLE/)
    expect(out).not.toMatch(/Create a SQL\/Python\/Shell script task/)
  })

  test("task flow --help shows full workflow", () => {
    const out = help(["task", "flow", "--help"])
    expect(out).toMatch(/create-node/)
    expect(out).toMatch(/node-save/)
  })

  test("task deploy --help mentions prerequisites", () => {
    const out = help(["task", "deploy", "--help"])
    expect(out).toMatch(/Prerequisite|prerequisite/)
  })

  test("task delete --help explains draft vs published procedure", () => {
    const out = help(["task", "delete", "--help"])
    expect(out).toMatch(/Draft|Published|undeploy/)
  })

  test("task list --help explains state codes", () => {
    const out = help(["task", "list", "--help"])
    expect(out).toMatch(/10=draft|20=published|100=offline/)
  })

  test("task create-setup --help shows one-step description with cron example", () => {
    const out = help(["task", "create-setup", "--help"])
    expect(out).toMatch(/One-step|create \+ save-content/)
    expect(out).toMatch(/daily 09:30/)
    expect(out).toMatch(/create-realtime-sync/)
  })

  test("datasource list --help cross-references test command", () => {
    const out = help(["datasource", "list", "--help"])
    expect(out).toMatch(/datasource test/)
  })

  test("datasource test --help explains output format", () => {
    const out = help(["datasource", "test", "--help"])
    expect(out).toMatch(/connected/)
  })

  test("flow node-save --help explains param replace behavior", () => {
    const out = help(["task", "flow", "node-save", "--help"])
    expect(out).toMatch(/Re-save replaces ALL|replaces ALL/)
  })

  test("schedule-info --help mentions flow alternative", () => {
    const out = help(["task", "schedule-info", "--help"])
    expect(out).toMatch(/flow instances/)
  })
})

// ── 14. flow dag (read-only verification) ───────────────────────────────

describe("flow dag", () => {
  test("returns data array for a flow task", async () => {
    // Find a FLOW task (type=500)
    const listR = await execute("task list --page-size 20")
    const listJ = json(listR)
    const data = (listJ.data as Record<string, unknown>[]) ?? []
    const flowTask = data.find(t => t.task_type === 500)
    if (!flowTask) { console.log("⊘ skip: no FLOW tasks"); return }
    const taskId = flowTask.task_id as number

    const r = await execute(`task flow dag ${taskId}`)
    expect(r.exitCode).toBe(0)
    const j = json(r)
    expect(j.error).toBeUndefined()
    const dag = j.data
    // DAG returns array (may be empty if no nodes created)
    expect(Array.isArray(dag)).toBe(true)
  })
})

// ── 15. schedule-info — friendly errors (issues 2 & 4) ──────────────────

describe("schedule-info friendly errors", () => {
  test("returns friendly note for task deployed without cron (no IDE-SYSTEM_EXCEPTION)", async () => {
    // Find a deployed SQL/Python task that has no cron configured
    const listR = await execute("task list --page-size 20")
    const listJ = json(listR)
    const data = (listJ.data as Record<string, unknown>[]) ?? []
    const SQL_TYPES = new Set([4, 5, 7]) // SQL(4→23), SHELL(5→24), PYTHON(7→26)
    const deployed = data.filter(t => t.task_edit_state === 20 && !SQL_TYPES.has(t.task_type as number))
    // Try all deployed tasks and find one without cron
    for (const t of deployed.slice(0, 5)) {
      const taskId = t.task_id as number
      const r = await execute(`task schedule-info ${taskId}`)
      expect(r.exitCode).toBe(0) // must NOT return error exit code
      const j = json(r)
      expect(j.error).toBeUndefined() // must NOT propagate IDE-SYSTEM_EXCEPTION
      const d = j.data as Record<string, unknown>
      // Either real data (cron set) or friendly note (no cron)
      if (d.note) {
        expect(typeof d.note).toBe("string")
        expect(d.note.length).toBeGreaterThan(0)
      } else {
        expect(d.task_id).toBeDefined()
      }
    }
  })

  test("returns FLOW-specific note for FLOW tasks instead of exception", async () => {
    // Find a deployed FLOW task (fileType=500 stored internally)
    // Task status shows these as having cdc_status=None and draft.task_content=''
    const listR = await execute("task list --page-size 20")
    const listJ = json(listR)
    const data = (listJ.data as Record<string, unknown>[]) ?? []
    // FLOW tasks have no content but are deployed
    const deployed = data.filter(t => t.task_edit_state === 20)
    let tested = false
    for (const t of deployed.slice(0, 5)) {
      const taskId = t.task_id as number
      // Check if this is a FLOW task via task content (empty task_content = potential FLOW)
      const r = await execute(`task schedule-info ${taskId}`)
      expect(r.exitCode).toBe(0)
      const j = json(r)
      expect(j.error).toBeUndefined()
      const d = j.data as Record<string, unknown>
      if (d.note && String(d.note).includes("flow instances")) {
        // Found a FLOW task — verify the note is correct
        expect(d.note).toMatch(/flow instances/)
        tested = true
        break
      }
    }
    if (!tested) console.log("⊘ note: no FLOW task found in first 5 deployed tasks")
  })

  test("returns cron info for properly scheduled tasks (still works)", async () => {
    // Find a deployed task that has cron — schedule-info should return full data
    const listR = await execute("task list --page-size 20")
    const listJ = json(listR)
    const data = (listJ.data as Record<string, unknown>[]) ?? []
    const deployed = data.filter(t => t.task_edit_state === 20)
    let found = false
    for (const t of deployed.slice(0, 5)) {
      const taskId = t.task_id as number
      const r = await execute(`task schedule-info ${taskId}`)
      expect(r.exitCode).toBe(0)
      const j = json(r)
      expect(j.error).toBeUndefined()
      const d = j.data as Record<string, unknown>
      if (d.cron_expression && d.task_id) {
        expect(d.task_name).toBeDefined()
        expect(d.vc_code).toBeDefined()
        expect(typeof d.cron_expression).toBe("string")
        found = true
        break
      }
    }
    if (!found) console.log("⊘ note: no deployed task with cron found")
  })
})

// ── 16. REALTIME deploy guard (issue 4) ─────────────────────────────────

describe("REALTIME deploy guard", () => {
  test("bare REALTIME task (no content) → NO_SYNC_CONFIG before deploy", async () => {
    // Find a folder
    const folderR = await execute("task list-folders --page-size 1")
    const folderJ = json(folderR)
    const folders = (folderJ.data as Record<string, unknown>[]) ?? []
    if (folders.length === 0) { console.log("⊘ skip: no folders"); return }
    const folderId = folders[0].id as number

    const ts = Date.now() % 99999
    const name = `test_rt_guard_${ts}`

    // Create bare REALTIME task
    const createR = await execute(`task create "${name}" --folder ${folderId} --type REALTIME`)
    if (createR.exitCode !== 0) {
      console.log("⊘ skip: could not create REALTIME task")
      return
    }
    const createJ = json(createR)
    const taskId = (createJ.data as Record<string, unknown>)?.id
    if (!taskId) { console.log("⊘ skip: no task id"); return }

    // Deploy should return NO_SYNC_CONFIG, not backend error
    const deployR = await execute(`task deploy ${taskId} -y`)
    expect(deployR.exitCode).not.toBe(0)
    const deployJ = json(deployR)
    expect(deployJ.error).toBeDefined()
    const errCode = (deployJ.error as Record<string, unknown>).code as string
    // Must be caught at CLI level (NO_SYNC_CONFIG), not backend (TASK_ERROR/文件参数不匹配)
    expect(errCode).toBe("NO_SYNC_CONFIG")
  })

  test("create-stream-sync task deploys successfully", async () => {
    // Get a kafka datasource
    const listR = await execute("datasource list --type kafka --page-size 1")
    const listJ = json(listR)
    const datasources = (listJ.data as Record<string, unknown>[]) ?? []
    if (datasources.length === 0) { console.log("⊘ skip: no Kafka datasource"); return }
    const dsName = datasources[0].name as string

    // Get a folder
    const folderR = await execute("task list-folders --page-size 1")
    const folderJ = json(folderR)
    const folders = (folderJ.data as Record<string, unknown>[]) ?? []
    if (folders.length === 0) { console.log("⊘ skip: no folders"); return }
    const folderId = folders[0].id as number

    const ts = Date.now() % 99999
    const name = `test_stream_deploy_${ts}`

    // create-stream-sync (configured)
    const createR = await execute(`task create-stream-sync "${name}" --folder ${folderId} --source "${dsName}" --topic test --target LAKEHOUSE_quick_start`)
    const createJ = json(createR)
    const taskId = (createJ.data as Record<string, unknown>)?.task_id
    if (!taskId) { console.log("⊘ skip: create-stream-sync failed"); return }

    // Deploy should succeed
    const deployR = await execute(`task deploy ${taskId} -y`)
    expect(deployR.exitCode).toBe(0)
    const deployJ = json(deployR)
    expect(deployJ.error).toBeUndefined()
    expect((deployJ.data as Record<string, unknown>)?.status).toBe("online")
  })
})
