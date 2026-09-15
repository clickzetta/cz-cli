import { Database } from "bun:sqlite"
import { createHash } from "node:crypto"
import { closeSync, existsSync, mkdirSync, openSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import type { AuthToken } from "@clickzetta/sdk"

// Only short, synchronous transactions run here. No database lock spans HTTP.
// Keeping spent-token fingerprints permanently prevents a stale profiles.toml,
// a renamed session, or a crashed refresher from spending the same token twice.
const transactions = new Map<string, Database>()
const WAIT_MS = 35_000

export class OAuthStateError extends Error {
  constructor(
    readonly code: "LOCK_CONTENDED" | "OAUTH_REFRESH_PENDING" | "OAUTH_REFRESH_UNCERTAIN" | "OAUTH_STATE_UNAVAILABLE",
    message: string,
  ) {
    super(message)
    this.name = "OAuthStateError"
  }
}

function stateFile() {
  return join(process.env.CLICKZETTA_TEST_HOME || homedir(), ".clickzetta", "oauth-state.sqlite3")
}

function fingerprint(token: AuthToken) {
  if (!token.refreshToken) throw new Error("An OAuth refresh token is required")
  // The token itself, not a mutable profile/session name, identifies its one use.
  return createHash("sha256").update(token.refreshToken).digest("hex")
}

function errorCode(error: unknown) {
  return error !== null && typeof error === "object" && "code" in error ? error.code : undefined
}

function withState<T>(write: true, fn: (db: Database) => T): T
function withState<T>(write: false, fn: (db: Database) => T): T | undefined
function withState<T>(write: boolean, fn: (db: Database) => T): T | undefined {
  const file = stateFile()
  const active = transactions.get(file)
  if (active) return fn(active)
  if (!write && !existsSync(file)) return undefined
  let db: Database | undefined
  try {
    if (write) {
      mkdirSync(join(file, ".."), { recursive: true, mode: 0o700 })
      try {
        closeSync(openSync(file, "wx", 0o600))
      } catch (error) {
        if (errorCode(error) !== "EEXIST") throw error
      }
    }
    db = new Database(file, { readonly: !write, strict: true })
    db.exec("PRAGMA busy_timeout = 2000")
    if (!write) {
      // Another process may have created the file but not committed its schema yet.
      if (!db.query("SELECT name FROM sqlite_master WHERE name = 'oauth_families'").get()) return undefined
      return fn(db)
    }
    db.exec("PRAGMA synchronous = FULL")
    const connection = db
    return connection
      .transaction(() => {
        connection.exec(`
        CREATE TABLE IF NOT EXISTS oauth_families (
          id TEXT PRIMARY KEY,
          current_hash TEXT NOT NULL UNIQUE,
          token_json TEXT NOT NULL,
          state TEXT NOT NULL CHECK (state IN ('pending', 'ready', 'uncertain'))
        );
        CREATE TABLE IF NOT EXISTS oauth_spent (
          hash TEXT PRIMARY KEY,
          family_id TEXT NOT NULL REFERENCES oauth_families(id)
        );
      `)
        transactions.set(file, connection)
        try {
          return fn(connection)
        } finally {
          transactions.delete(file)
        }
      })
      .immediate()
  } catch (error) {
    if (error instanceof OAuthStateError) throw error
    const code = errorCode(error)
    if (code === "SQLITE_BUSY" || code === "SQLITE_LOCKED") {
      throw new OAuthStateError(
        "LOCK_CONTENDED",
        "OAuth state is busy; retry the command after the other process finishes.",
      )
    }
    // Preserve errors raised by a profile mutation rather than disguising e.g.
    // PROFILE_EXISTS as a storage failure.
    throw error
  } finally {
    db?.close()
  }
}

/** Serialize the entire profiles read/modify/write. Never fall back to unlocked. */
export function withProfilesTransaction<T>(fn: () => T): T {
  return withState(true, () => fn())
}

interface Family {
  id: string
  current_hash: string
  token_json: string
  state: "pending" | "ready" | "uncertain"
}

function family(db: Database, hash: string): Family | null {
  return db
    .query<Family, [string, string]>(
      `
    SELECT * FROM oauth_families
    WHERE id = (SELECT family_id FROM oauth_spent WHERE hash = ?) OR current_hash = ?
  `,
    )
    .get(hash, hash)
}

/** A TOML token is an import seed. Once rotated, SQLite owns its current value. */
export function resolveOAuthToken(token: AuthToken): AuthToken {
  if (!token.refreshToken) return token
  const current = withState(false, (db) => family(db, fingerprint(token)))
  if (!current) return token
  const resolved = JSON.parse(current.token_json) as AuthToken | null
  if (!resolved) throw uncertain()
  return resolved
}

/** Logout/re-login removes the old secret, but never its replay-prevention record. */
export function retireOAuthTokens(previous: AuthToken[], retained: AuthToken[]): void {
  withState(true, (db) => {
    const keep = new Set(
      retained
        .filter((token) => token.refreshToken)
        .map((token) => family(db, fingerprint(token))?.id ?? fingerprint(token)),
    )
    for (const token of previous) {
      if (!token.refreshToken) continue
      const hash = fingerprint(token)
      const current = family(db, hash)
      const id = current?.id ?? hash
      if (keep.has(id)) continue
      if (!current) db.query("INSERT INTO oauth_families VALUES (?, ?, 'null', 'uncertain')").run(id, hash)
      db.query("INSERT OR IGNORE INTO oauth_spent VALUES (?, ?)").run(current?.current_hash ?? hash, id)
      db.query("UPDATE oauth_families SET token_json = 'null', state = 'uncertain' WHERE id = ?").run(id)
    }
  })
}

function uncertain() {
  return new OAuthStateError(
    "OAUTH_REFRESH_UNCERTAIN",
    "The previous OAuth refresh may already have consumed its token. Run `cz-cli auth login <name>` to sign in again; do not retry the old refresh token.",
  )
}

/**
 * Durably claim a refresh BEFORE sending it; publish its result BEFORE returning.
 * A pending claim is never stolen, even after a crash. A timeout or lost response
 * cannot tell us whether the issuer consumed the token. Only a fresh login can
 * recover an uncertain family without an issuer-specific recovery protocol.
 */
export async function refreshOAuthToken(
  previous: AuthToken,
  request: () => Promise<AuthToken>,
  waitMs = WAIT_MS,
): Promise<AuthToken> {
  const hash = fingerprint(previous)
  let owner: string | undefined
  try {
    owner = withState(true, (db) => {
      if (db.query("SELECT hash FROM oauth_spent WHERE hash = ?").get(hash)) return undefined
      const current = family(db, hash)
      const id = current?.id ?? hash
      if (current) {
        db.query("UPDATE oauth_families SET state = 'pending' WHERE id = ?").run(id)
      } else {
        db.query("INSERT INTO oauth_families VALUES (?, ?, ?, 'pending')").run(id, hash, JSON.stringify(previous))
      }
      db.query("INSERT INTO oauth_spent VALUES (?, ?)").run(hash, id)
      return id
    })
  } catch (error) {
    if (error instanceof OAuthStateError) throw error
    throw new OAuthStateError(
      "OAUTH_STATE_UNAVAILABLE",
      "Cannot safely record the OAuth refresh. Check the permissions and free space of ~/.clickzetta.",
    )
  }

  if (!owner) {
    const deadline = performance.now() + waitMs
    for (;;) {
      const current = withState(false, (db) => family(db, hash))
      if (!current || current.state === "uncertain") throw uncertain()
      if (current.state === "ready") return JSON.parse(current.token_json) as AuthToken
      if (performance.now() >= deadline) {
        throw new OAuthStateError(
          "OAUTH_REFRESH_PENDING",
          "An OAuth refresh is still pending. Retry later, or run `cz-cli auth login <name>` if its process exited. The old refresh token will not be reused.",
        )
      }
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
  }

  try {
    const token = await request()
    // ClickZetta rotates on every exchange. Without a replacement we cannot
    // safely use the already-claimed refresh token again.
    if (!token.refreshToken || fingerprint(token) === hash) throw uncertain()
    withState(true, (db) => {
      if (db.query("SELECT hash FROM oauth_spent WHERE hash = ?").get(fingerprint(token))) throw uncertain()
      const updated = db
        .query(
          "UPDATE oauth_families SET current_hash = ?, token_json = ?, state = 'ready' WHERE id = ? AND state = 'pending' AND current_hash = ?",
        )
        .run(fingerprint(token), JSON.stringify(token), owner, hash)
      if (updated.changes !== 1) throw uncertain()
    })
    return token
  } catch (error) {
    try {
      withState(true, (db) => {
        db.query("UPDATE oauth_families SET state = 'uncertain' WHERE id = ?").run(owner)
      })
    } catch {
      // The durable pending claim still prevents replay if storage has failed.
    }
    const code = errorCode(error)
    if (code === "invalid_grant" || code === "invalid_token" || code === "invalid_request") throw error
    throw error instanceof OAuthStateError ? error : uncertain()
  }
}
