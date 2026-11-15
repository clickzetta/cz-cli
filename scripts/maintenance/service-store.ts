import { Database } from "bun:sqlite"
import { randomUUID } from "node:crypto"
import { execFileSync } from "node:child_process"
import { chmodSync, mkdirSync, readFileSync } from "node:fs"
import path from "node:path"

export type Role = "worker" | "curator"
type Wake = { id: number; role: Role; event_key: string; reason: string }
type Run = {
  id: string
  role: Role
  started_at: number
  status: string
  thread_id: string | null
  detail: string | null
}

// The existing intake/outbox remain authoritative for business effects. These rows only schedule runs.
export class ServiceStore {
  readonly db: Database

  constructor(directory: string) {
    mkdirSync(directory, { recursive: true, mode: 0o700 })
    const file = path.join(directory, "service.sqlite")
    this.db = new Database(file, { create: true, strict: true })
    chmodSync(file, 0o600)
    this.db.exec(`
      PRAGMA busy_timeout=5000;
      PRAGMA journal_mode=WAL;
      PRAGMA synchronous=FULL;
    `)
    this.db
      .transaction(() => {
        this.db.exec(`
      CREATE TABLE IF NOT EXISTS owner (id INTEGER PRIMARY KEY CHECK(id=1), token TEXT, pid INTEGER, identity TEXT);
      CREATE TABLE IF NOT EXISTS roles (role TEXT PRIMARY KEY, paused TEXT, retry_at INTEGER NOT NULL DEFAULT 0, failures INTEGER NOT NULL DEFAULT 0);
      INSERT OR IGNORE INTO roles(role) VALUES ('worker'), ('curator');
      CREATE TABLE IF NOT EXISTS wakes (id INTEGER PRIMARY KEY, role TEXT NOT NULL, event_key TEXT NOT NULL, reason TEXT NOT NULL, run_id TEXT, UNIQUE(role,event_key));
      CREATE TABLE IF NOT EXISTS timers (id TEXT PRIMARY KEY, role TEXT NOT NULL, due_at INTEGER NOT NULL, interval_ms INTEGER, reason TEXT NOT NULL, fired_at INTEGER);
      CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, role TEXT NOT NULL, started_at INTEGER NOT NULL, finished_at INTEGER, status TEXT NOT NULL, thread_id TEXT, detail TEXT);
      CREATE TABLE IF NOT EXISTS health (source TEXT PRIMARY KEY, checked_at INTEGER NOT NULL, success_at INTEGER, failures INTEGER NOT NULL, detail TEXT);
      `)
        if (
          !this.db
            .query<{ name: string }, []>("PRAGMA table_info(owner)")
            .all()
            .some((column) => column.name === "identity")
        )
          this.db.exec("ALTER TABLE owner ADD COLUMN identity TEXT")
      })
      .immediate()
  }

  acquire() {
    return this.db
      .transaction(() => {
        const owner = this.db
          .query<{ token: string; pid: number; identity: string | null }, []>("SELECT * FROM owner WHERE id=1")
          .get()
        const identity = owner && processIdentity(owner.pid)
        if (identity && (!owner.identity || owner.identity === identity))
          throw new Error(`Maintenance service already owned by PID ${owner.pid}`)
        // An interrupted provider run may have performed external effects. Never blindly replay it.
        this.db
          .exec(`UPDATE roles SET paused='Interrupted run: reconcile delegates, worktrees and receipts before resume'
        WHERE role IN (SELECT role FROM runs WHERE status='running');
        UPDATE runs SET status='interrupted' WHERE status='running';`)
        const token = randomUUID()
        this.db
          .query("INSERT OR REPLACE INTO owner(id,token,pid,identity) VALUES (1,?,?,?)")
          .run(token, process.pid, processIdentity(process.pid)!)
        return token
      })
      .immediate()
  }

  release(token: string) {
    this.db.query("DELETE FROM owner WHERE id=1 AND token=?").run(token)
  }

  enqueue(role: Role, key: string, reason: string) {
    this.db.query("INSERT OR IGNORE INTO wakes(role,event_key,reason) VALUES (?,?,?)").run(role, key, reason)
  }

  schedule(id: string, role: Role, due: number, reason: string, interval?: number) {
    if (
      !/^[\w.-]{1,150}$/.test(id) ||
      !Number.isSafeInteger(due) ||
      due < 0 ||
      (interval !== undefined && (!Number.isSafeInteger(interval) || interval < 1000))
    )
      throw new Error("Timer requires a stable ID, epoch milliseconds and an interval of at least 1000ms")
    const previous = this.db
      .query<
        { role: string; due_at: number; interval_ms: number | null; reason: string },
        [string]
      >("SELECT * FROM timers WHERE id=?")
      .get(id)
    if (previous) {
      if (previous.role !== role || previous.reason !== reason || previous.interval_ms !== (interval ?? null))
        throw new Error("Timer ID already has a different definition")
      return
    }
    this.db
      .query("INSERT INTO timers(id,role,due_at,interval_ms,reason) VALUES (?,?,?,?,?)")
      .run(id, role, due, interval ?? null, reason)
  }

  fireTimers(now: number) {
    this.db
      .transaction(() => {
        const timers = this.db
          .query<
            { id: string; role: Role; due_at: number; interval_ms: number | null; reason: string },
            [number]
          >("SELECT * FROM timers WHERE due_at<=? AND fired_at IS NULL")
          .all(now)
        timers.forEach((timer) => {
          this.enqueue(timer.role, `timer:${timer.id}:${timer.due_at}`, timer.reason)
          if (timer.interval_ms === null) {
            this.db.query("UPDATE timers SET fired_at=? WHERE id=?").run(now, timer.id)
            return
          }
          // Coalesce missed intervals after downtime while preserving the original cadence.
          const due = timer.due_at + (Math.floor((now - timer.due_at) / timer.interval_ms) + 1) * timer.interval_ms
          this.db.query("UPDATE timers SET due_at=? WHERE id=?").run(due, timer.id)
        })
      })
      .immediate()
  }

  cancelTimer(id: string) {
    this.db
      .transaction(() => {
        this.db.query("UPDATE timers SET fired_at=0 WHERE id=?").run(id)
        const prefix = `timer:${id}:`
        this.db.query("DELETE FROM wakes WHERE run_id IS NULL AND substr(event_key,1,?)=?").run(prefix.length, prefix)
      })
      .immediate()
  }

  claim(now: number) {
    return this.db
      .transaction(() => {
        if (this.db.query("SELECT id FROM runs WHERE status='running'").get()) return
        const wake = this.db
          .query<Wake, [number]>(
            `SELECT wakes.* FROM wakes JOIN roles USING(role)
        WHERE run_id IS NULL AND paused IS NULL AND retry_at<=? ORDER BY wakes.id LIMIT 1`,
          )
          .get(now)
        if (!wake) return
        const id = randomUUID()
        this.db.query("INSERT INTO runs(id,role,started_at,status) VALUES (?,?,?,'running')").run(id, wake.role, now)
        const events = this.db
          .query<Wake, [string]>("SELECT * FROM wakes WHERE role=? AND run_id IS NULL ORDER BY id")
          .all(wake.role)
        this.db.query("UPDATE wakes SET run_id=? WHERE role=? AND run_id IS NULL").run(id, wake.role)
        return { id, role: wake.role, events }
      })
      .immediate()
  }

  recordThread(id: string, thread: string) {
    this.db.query("UPDATE runs SET thread_id=? WHERE id=? AND status='running'").run(thread, id)
  }

  defer(id: string) {
    this.db
      .transaction(() => {
        this.db.query("UPDATE wakes SET run_id=NULL WHERE run_id=?").run(id)
        this.db.query("UPDATE runs SET status='deferred' WHERE id=?").run(id)
      })
      .immediate()
  }

  discardIdleWorkerTicks(idle: boolean) {
    if (!idle) return
    this.db
      .query("DELETE FROM wakes WHERE role='worker' AND run_id IS NULL AND event_key LIKE 'timer:worker-reconcile:%'")
      .run()
  }

  finish(id: string, result: { success: boolean; thread?: string; detail?: string }, now: number) {
    this.db
      .transaction(() => {
        const run = this.db.query<Run, [string]>("SELECT * FROM runs WHERE id=? AND status='running'").get(id)
        if (!run) throw new Error("Run is no longer active")
        this.db
          .query("UPDATE runs SET status=?,finished_at=?,thread_id=?,detail=? WHERE id=?")
          .run(result.success ? "completed" : "failed", now, result.thread ?? run.thread_id, result.detail ?? null, id)
        if (result.success) {
          this.db.query("UPDATE roles SET failures=0,retry_at=0 WHERE role=?").run(run.role)
          return
        }
        // Any failed execution can have partial business effects, including on a provider error.
        // Explicit reconciliation is required before a fresh run may handle these events again.
        this.db
          .query("UPDATE roles SET paused=?,failures=failures+1 WHERE role=?")
          .run(result.detail || "Execution failed; reconcile side effects before resuming", run.role)
      })
      .immediate()
  }

  resume(role: Role, note: string) {
    if (!note.trim()) throw new Error("Resume requires a reconciliation note")
    this.db
      .transaction(() => {
        if (this.db.query("SELECT id FROM runs WHERE role=? AND status='running'").get(role))
          throw new Error("Role is still running")
        this.db
          .query("UPDATE runs SET detail=COALESCE(detail,'') || ? WHERE role=? AND status IN ('failed','interrupted')")
          .run(`\nReconciled: ${note}`, role)
        this.db
          .query(
            "UPDATE wakes SET run_id=NULL WHERE role=? AND run_id IN (SELECT id FROM runs WHERE status IN ('failed','interrupted'))",
          )
          .run(role)
        this.db.query("UPDATE roles SET paused=NULL,retry_at=0 WHERE role=?").run(role)
      })
      .immediate()
  }

  pause(role: Role, reason: string) {
    if (!reason.trim()) throw new Error("Pause requires a reason")
    this.db.query("UPDATE roles SET paused=? WHERE role=?").run(reason, role)
  }

  health(source: string, now: number, error?: string) {
    this.db
      .transaction(() => {
        const health = this.db
          .query<{ failures: number }, [string, number, number | null, number, string | null]>(
            `INSERT INTO health VALUES (?,?,?,?,?) ON CONFLICT(source) DO UPDATE SET
      checked_at=excluded.checked_at,success_at=COALESCE(excluded.success_at,health.success_at),
      failures=CASE WHEN excluded.detail IS NULL THEN 0 ELSE health.failures+1 END,detail=excluded.detail
      RETURNING failures`,
          )
          .get(source, now, error ? null : now, error ? 1 : 0, error ?? null)
        // Persist one investigation wake per outage, atomically with its first failure.
        if (health?.failures === 1 && (source === "github" || source === "feishu"))
          this.enqueue("worker", `intake-failure:${source}:${now}`, `Investigate ${source} intake failure`)
      })
      .immediate()
  }

  status() {
    return {
      owner: this.db.query<{ pid: number }, []>("SELECT pid FROM owner").get(),
      roles: this.db.query("SELECT * FROM roles").all(),
      pending: this.db
        .query("SELECT role,COUNT(*) AS count,MIN(id) AS oldest FROM wakes WHERE run_id IS NULL GROUP BY role")
        .all(),
      runs: this.db.query<Run, []>("SELECT * FROM runs ORDER BY started_at DESC LIMIT 20").all(),
      timers: this.db.query("SELECT * FROM timers WHERE fired_at IS NULL").all(),
      health: this.db.query("SELECT * FROM health").all(),
    }
  }
}

export function requireRole(value: string): Role {
  if (value !== "worker" && value !== "curator") throw new Error("Role must be worker or curator")
  return value
}

function processIdentity(pid: number) {
  try {
    if (process.platform === "linux") {
      const stat = readFileSync(`/proc/${pid}/stat`, "utf8")
      const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ")
      if (fields[0] === "Z") return
      return `${readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim()}:${fields[19]}`
    }
    return (
      execFileSync("ps", ["-p", String(pid), "-o", "lstart="], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim() || undefined
    )
  } catch (error) {
    if (
      ["ENOENT", "ESRCH"].includes((error as NodeJS.ErrnoException).code ?? "") ||
      (error as { status?: number }).status === 1
    )
      return
    throw error
  }
}
