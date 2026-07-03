/**
 * Volume GET/PUT implementation for ClickZetta SDK.
 *
 * NOTE: This module requires Node.js. Browser environments do not support
 * local filesystem I/O (fs/promises, path, os) and will throw NotSupportedError
 * when genVolumeResult is called.
 *
 * Python references (clickzetta/connector/v0/):
 *   - client.py:1340-1344  _process_hint_job volume branch → isVolumeSql
 *   - client.py:863-894    process_volume_sql              → processVolumeSql
 *   - client.py:897-924    _is_retryable_volume_transfer_exception → isRetryableVolumeError
 *   - client.py:926-964    _execute_volume_transfer_with_retry     → executeVolumeTransferWithRetry
 *   - client.py:966-1040   gen_volume_result               → genVolumeResult
 *   - client.py:1042-1053  get_volume_files                → getVolumeFiles
 *   - client.py:1420-1442  _gen_new_put_sql                → genNewPutSql
 *   - _volume.py:22-27     resolve_local_path              → resolveLocalPath
 *   - utils.py:187-209     normalize_file_path             → normalizeFilePath
 */

import { OperationalError, NotSupportedError } from "../types/errors.js"
import { JobStatus, type QueryResult, type JobID, newJobId } from "./types.js"
import { submitJob } from "./submit.js"
import { pollJobResult, parseJobResponse } from "./poll.js"
import type { ClientOptions } from "../client.js"

// -------------------------------------------------------------------------
// VolumeOutcome — mirrors the JSON structure returned by the server
// -------------------------------------------------------------------------

export interface VolumeOutcome {
  status: "SUCCESS" | "CONTINUE" | "FAILED"
  request: {
    command: "GET" | "PUT"
    localPaths: string[]
    volumeIdentifier?: string
    file?: string
    subdirectory?: string
    options?: Array<{ name: string; value: string }>
  }
  ticket: { presignedUrls: string[] }
  nextMarker?: string
  error?: string
}

// -------------------------------------------------------------------------
// isVolumeSql — client.py:1340-1344
// -------------------------------------------------------------------------

/**
 * Returns true when the SQL string is a Volume GET or PUT command.
 * Mirrors `_process_hint_job` volume branch (client.py:1340-1344).
 */
export function isVolumeSql(sql: string): boolean {
  const upper = sql.trim().toUpperCase()
  return upper.startsWith("PUT ") || upper.startsWith("GET ")
}

// -------------------------------------------------------------------------
// normalizeFilePath — utils.py:187-209
// -------------------------------------------------------------------------

/**
 * Normalize a file path by removing the file:/, file://, or file:///
 * protocol prefix if present, and expanding a leading ~ to the home dir.
 * Mirrors `normalize_file_path` (utils.py:187-209).
 */
export function normalizeFilePath(path: string): string {
  // Strip file:// prefix (0-3 slashes after "file:")
  const fileProtocol = /^file:\/{0,3}/
  let normalized = path
  if (fileProtocol.test(path)) {
    const stripped = path.replace(fileProtocol, "")
    // Windows path (e.g. C:\...) — do not prepend slash
    if (/^[a-zA-Z]:/.test(stripped)) {
      normalized = stripped
    } else {
      normalized = "/" + stripped.replace(/^\/+/, "")
    }
  }

  // Expand leading ~ to home directory (Node.js only)
  if (normalized.startsWith("~")) {
    const home =
      (typeof process !== "undefined" && (process.env["HOME"] ?? process.env["USERPROFILE"])) ||
      ""
    if (home) {
      normalized = home + normalized.slice(1)
    }
  }

  return normalized
}

function toPosixPath(path: string): string {
  return path.replace(/\\/g, "/")
}

// -------------------------------------------------------------------------
// resolveLocalPath — _volume.py:22-27
// -------------------------------------------------------------------------

/**
 * Resolve a local path pattern to a list of absolute file paths.
 * Mirrors `resolve_local_path` (_volume.py:22-27).
 *
 * - `*` in path → glob expansion
 * - trailing `/` → recursive directory walk
 * - otherwise → single-element array
 */
export async function resolveLocalPath(path: string): Promise<string[]> {
  if (typeof process === "undefined") {
    throw new NotSupportedError("Volume operations require Node.js")
  }

  const { readdir, stat } = await import("node:fs/promises")
  const nodePath = await import("node:path")
  const normalizedPath = toPosixPath(path)

  if (normalizedPath.includes("*")) {
    return resolveGlob(normalizedPath)
  }

  if (path.endsWith("/") || path.endsWith("\\")) {
    return resolveDir(normalizedPath, readdir, nodePath)
  }

  return [normalizedPath]
}

/** Glob expansion — mirrors _volume.py:6-11 */
async function resolveGlob(pattern: string): Promise<string[]> {
  // Node 22+ has native glob; for compatibility we implement a simple
  // single-level glob using readdir + minimatch-style matching.
  const nodePath = await import("node:path")
  const { readdir } = await import("node:fs/promises")

  const dir = nodePath.dirname(pattern)
  const base = nodePath.basename(pattern)

  // Convert glob pattern to regex (only * wildcard supported, matching Python)
  const regexStr = "^" + base.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$"
  const regex = new RegExp(regexStr)

  let entries: string[]
  try {
    entries = await readdir(dir)
  } catch {
    return []
  }

  const results: string[] = []
  for (const entry of entries) {
    if (regex.test(entry)) {
      results.push(nodePath.join(dir, entry))
    }
  }
  return results
}

/** Recursive directory walk — mirrors _volume.py:14-19 */
async function resolveDir(
  dirPath: string,
  readdir: (p: string, opts: { withFileTypes: true }) => Promise<import("node:fs").Dirent[]>,
  nodePath: typeof import("node:path"),
): Promise<string[]> {
  const results: string[] = []
  const stack = [dirPath]

  while (stack.length > 0) {
    const current = stack.pop()!
    let entries: import("node:fs").Dirent[]
    try {
      entries = await readdir(current, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      const full = nodePath.join(current, entry.name)
      if (entry.isDirectory()) {
        stack.push(full)
      } else {
        results.push(full)
      }
    }
  }
  return results
}

// -------------------------------------------------------------------------
// isRetryableVolumeError — client.py:897-924
// -------------------------------------------------------------------------

const RETRYABLE_HTTP_STATUSES = new Set([408, 429, 500, 502, 503, 504])

const RETRYABLE_MESSAGE_PATTERNS = [
  "failed to establish a new connection",
  "max retries exceeded",
  "timed out",
  "connection reset by peer",
  "temporary failure in name resolution",
  "name or service not known",
  "remote end closed connection",
  "connection aborted",
]

/**
 * Returns true when the error is a transient network/HTTP error that
 * warrants a retry. Mirrors `_is_retryable_volume_transfer_exception`
 * (client.py:897-924).
 */
export function isRetryableVolumeError(err: unknown): boolean {
  if (err instanceof Error) {
    // HTTP status check — look for a `status` or `statusCode` property
    const status =
      (err as { status?: number }).status ??
      (err as { statusCode?: number }).statusCode

    if (status !== undefined && RETRYABLE_HTTP_STATUSES.has(status)) {
      return true
    }

    const msg = err.message.toLowerCase()
    if (RETRYABLE_MESSAGE_PATTERNS.some((p) => msg.includes(p))) {
      return true
    }
  }
  return false
}

// -------------------------------------------------------------------------
// executeVolumeTransferWithRetry — client.py:926-964
// -------------------------------------------------------------------------

/**
 * Execute a volume transfer operation with exponential-backoff retry.
 * Mirrors `_execute_volume_transfer_with_retry` (client.py:926-964).
 *
 * @param operation  "GET" or "PUT" — used for logging
 * @param target     Human-readable target description for logging
 * @param handler    Async function that performs the actual transfer
 * @param _sleepFn   Optional sleep override for testing (default: real setTimeout)
 */
export async function executeVolumeTransferWithRetry<T>(
  operation: string,
  target: string,
  handler: () => Promise<T>,
  _sleepFn?: (ms: number) => Promise<void>,
): Promise<T> {
  const maxRetries = 3
  const retryBaseSeconds = 1.0
  const totalAttempts = maxRetries + 1
  const sleep = _sleepFn ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))

  for (let attempt = 1; attempt <= totalAttempts; attempt++) {
    try {
      return await handler()
    } catch (e) {
      const retryable = isRetryableVolumeError(e)
      const isLastAttempt = attempt >= totalAttempts

      if (!retryable || isLastAttempt) {
        console.error(
          `${operation} volume failed, target:${target}, attempt:${attempt}/${totalAttempts}, retryable:${retryable}, error:${e}`,
        )
        throw e
      }

      const backoffMs = Math.min(retryBaseSeconds * Math.pow(2, attempt - 1), 30.0) * 1000
      console.warn(
        `${operation} volume transient network error, target:${target}, attempt:${attempt}/${totalAttempts}, backoff:${backoffMs / 1000}s, error:${e}`,
      )
      await sleep(backoffMs)
    }
  }

  // TypeScript requires a return here; unreachable in practice
  throw new OperationalError(`${operation} volume failed after ${totalAttempts} attempts`)
}

// -------------------------------------------------------------------------
// getVolumeFiles — client.py:1042-1053
// -------------------------------------------------------------------------

/**
 * Extract the list of volume file names from the outcome object.
 * Mirrors `get_volume_files` (client.py:1042-1053).
 */
export function getVolumeFiles(outcome: VolumeOutcome): string[] {
  const files: string[] = []
  if (outcome.request.file !== undefined) {
    // Use basename of the absolute path of the file field
    // require is synchronous and safe here since we're in Node.js context
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const nodePath: typeof import("node:path") = require("node:path")
    files.push(nodePath.basename(nodePath.resolve(outcome.request.file)))
  } else {
    for (const url of outcome.ticket.presignedUrls) {
      // Parse URL and extract last path segment (URL-decoded)
      try {
        const parsed = new URL(url)
        const parts = decodeURIComponent(parsed.pathname).split("/")
        files.push(parts[parts.length - 1] ?? "")
      } catch {
        const parts = url.split("/")
        files.push(parts[parts.length - 1] ?? "")
      }
    }
  }
  return files
}

// -------------------------------------------------------------------------
// genNewPutSql — client.py:1420-1442
// -------------------------------------------------------------------------

/**
 * Generate the next PUT SQL for a CONTINUE response.
 * Mirrors `_gen_new_put_sql` (client.py:1420-1442).
 */
export async function genNewPutSql(outcome: VolumeOutcome): Promise<string> {
  let optionPart = ""
  const options = outcome.request.options ?? []
  for (const option of options) {
    optionPart += ` ${option.name} = ${option.value}`
  }

  const requestedPaths = outcome.request.localPaths
  const resolvedPaths: string[] = []
  for (const p of requestedPaths) {
    const expanded = await resolveLocalPath(p)
    resolvedPaths.push(...expanded)
  }

  if (resolvedPaths.length === 0) {
    throw new OperationalError("No local file to put into volume")
  }

  let sql = "PUT "
  sql += resolvedPaths.map((p) => `'${toPosixPath(p)}'`).join(", ")
  sql += ` TO ${outcome.request.volumeIdentifier ?? ""}`

  if (outcome.request.subdirectory !== undefined) {
    sql += ` SUBDIRECTORY '${outcome.request.subdirectory}'`
  } else if (outcome.request.file !== undefined) {
    sql += ` FILE '${outcome.request.file}'`
  }

  sql += optionPart
  sql += ";"
  return sql
}

// -------------------------------------------------------------------------
// genVolumeResult — client.py:966-1040
// -------------------------------------------------------------------------

/**
 * Execute the actual file transfers (GET downloads / PUT uploads) and
 * return a QueryResult with one row per transferred file.
 * Mirrors `gen_volume_result` (client.py:966-1040).
 *
 * Requires Node.js — throws NotSupportedError in browser environments.
 */
export async function genVolumeResult(outcome: VolumeOutcome): Promise<QueryResult> {
  if (typeof process === "undefined") {
    throw new NotSupportedError("Volume operations require Node.js")
  }

  const { mkdir, stat, open } = await import("node:fs/promises")
  const nodePath = await import("node:path")

  const rows: unknown[][] = []
  const command = outcome.request.command.toUpperCase()

  if (command === "GET") {
    // client.py:969-994
    const volumeFiles = getVolumeFiles(outcome)
    for (let i = 0; i < volumeFiles.length; i++) {
      const url = outcome.ticket.presignedUrls[i]
      const localDir = normalizeFilePath(outcome.request.localPaths[0] ?? ".")
      const localPath = nodePath.join(localDir, volumeFiles[i])

      // Ensure parent directory exists
      const parentDir = nodePath.dirname(localPath)
      await mkdir(parentDir, { recursive: true })

      await executeVolumeTransferWithRetry(
        "GET",
        `volume_path:${volumeFiles[i]}, local_path:${localPath}`,
        async () => {
          const resp = await fetch(url)
          if (!resp.ok) {
            const httpErr = new Error(`HTTP ${resp.status} fetching ${url}`) as Error & { status: number }
            httpErr.status = resp.status
            throw httpErr
          }
          const buffer = await resp.arrayBuffer()
          const fh = await open(localPath, "w")
          try {
            await fh.write(new Uint8Array(buffer))
          } finally {
            await fh.close()
          }
        },
      )

      console.info(`get volume success, volume_path:${volumeFiles[i]}, local_path:${localPath}`)
      const fileSize = (await stat(localPath)).size
      rows.push([volumeFiles[i], localPath, fileSize])
    }
  } else if (command === "PUT") {
    // client.py:995-1032
    if (outcome.status === "SUCCESS") {
      for (let i = 0; i < outcome.ticket.presignedUrls.length; i++) {
        const localPath = normalizeFilePath(outcome.request.localPaths[i] ?? "")
        const url = outcome.ticket.presignedUrls[i]

        // Verify file exists
        try {
          await stat(localPath)
        } catch {
          throw new OperationalError(`put volume failed, local_path:${localPath} not exists`)
        }

        await executeVolumeTransferWithRetry(
          "PUT",
          `local_path:${localPath}`,
          async () => {
            const fh = await open(localPath, "r")
            let data: ArrayBuffer
            try {
              const fileStat = await fh.stat()
              const buf = new Uint8Array(fileStat.size)
              await fh.read(buf, 0, fileStat.size, 0)
              data = buf.buffer
            } finally {
              await fh.close()
            }
            const resp = await fetch(url, {
              method: "PUT",
              body: data,
              headers: {},
            })
            if (!resp.ok) {
              const httpErr = new Error(`HTTP ${resp.status} putting ${url}`) as Error & { status: number }
              httpErr.status = resp.status
              throw httpErr
            }
          },
        )

        console.info(`put volume success, local_path:${localPath}`)

        // Determine volume_file path — client.py:1021-1030
        let volumeFile: string
        if (outcome.request.file !== undefined) {
          volumeFile = outcome.request.file
        } else if (outcome.request.subdirectory !== undefined) {
          const sub = outcome.request.subdirectory
          const subWithSlash = sub.endsWith("/") ? sub : sub + "/"
          volumeFile = subWithSlash + nodePath.basename(localPath)
        } else {
          volumeFile = nodePath.basename(localPath)
        }

        const fileSize = (await stat(localPath)).size
        rows.push([localPath, volumeFile, fileSize])
      }
    }
  }

  return {
    jobId: "",
    status: JobStatus.SUCCEEDED,
    columns: [
      { name: "0", type: "STRING" },
      { name: "1", type: "STRING" },
      { name: "2", type: "INT64" },
    ],
    rows,
    rowCount: rows.length,
  }
}

// -------------------------------------------------------------------------
// processVolumeSql — client.py:863-894
// -------------------------------------------------------------------------

export interface ProcessVolumeSqlOpts {
  clientOpts: ClientOptions
  workspace: string
  instanceId: number
}

/**
 * Parse the raw QueryResult from a Volume SQL job and execute the
 * actual file transfers. Mirrors `process_volume_sql` (client.py:863-894).
 *
 * @param opts       Client options + workspace/instanceId for follow-up jobs
 * @param jobId      The job ID of the completed volume SQL job
 * @param rawResult  The QueryResult returned by pollJobResult
 * @param sql        The original SQL string (used to detect GET vs PUT)
 */
export async function processVolumeSql(
  opts: ProcessVolumeSqlOpts,
  jobId: JobID,
  rawResult: QueryResult,
  sql: string,
): Promise<QueryResult> {
  const upperSql = sql.trim().toUpperCase()

  // Parse outcome from the single result row — client.py:867-870
  const rows = rawResult.rows
  if (rows.length !== 1) {
    throw new OperationalError(`get volume sql failed, with result: ${JSON.stringify(rows)}`)
  }

  const firstRow = rows[0]
  const firstValue = Object.values(firstRow)[0]
  if (typeof firstValue !== "string") {
    throw new OperationalError(`get volume sql failed, unexpected row value type: ${typeof firstValue}`)
  }

  let outcome: VolumeOutcome
  try {
    outcome = JSON.parse(firstValue) as VolumeOutcome
  } catch (e) {
    throw new OperationalError(`get volume sql failed, cannot parse outcome JSON: ${e}`)
  }

  // FAILED — client.py:871-874
  if (outcome.status === "FAILED") {
    throw new OperationalError(
      `${outcome.request.command} volume failed: ${outcome.error ?? "unknown error"}`,
    )
  }

  if (upperSql.startsWith("GET")) {
    // client.py:875-885
    let result = await genVolumeResult(outcome)

    if (outcome.status === "CONTINUE" && outcome.nextMarker && outcome.nextMarker !== "") {
      const nextSql = `set cz.sql.volume.file.transfer.next.marker=nextMarker;${sql}`
      const nextJobId = newJobId(opts.workspace, opts.instanceId)
      const nextResult = await submitAndPoll(opts.clientOpts, nextJobId, nextSql)

      // Merge rows — client.py:883-884 _merge_get_query_result
      result = {
        ...result,
        rows: [...result.rows, ...nextResult.rows],
        rowCount: result.rows.length + nextResult.rows.length,
      }
    }

    return result
  }

  if (upperSql.startsWith("PUT")) {
    // client.py:886-894
    if (outcome.status === "CONTINUE") {
      const nextSql = await genNewPutSql(outcome)
      const nextJobId = newJobId(opts.workspace, opts.instanceId)
      return submitAndPoll(opts.clientOpts, nextJobId, nextSql)
    }
    return genVolumeResult(outcome)
  }

  throw new OperationalError(`Unexpected volume SQL: ${sql}`)
}

// -------------------------------------------------------------------------
// Internal helper: submit + poll a follow-up job
// -------------------------------------------------------------------------

async function submitAndPoll(
  clientOpts: ClientOptions,
  jobId: JobID,
  sql: string,
): Promise<QueryResult> {
  const submitResp = await submitJob(clientOpts, {
    sql,
    workspace: jobId.workspace,
    schema: "",
    vcluster: "",
    instanceName: "",
    instanceId: jobId.instanceId,
    jobId,
  })

  const raw = submitResp as { status?: { state?: string } }
  if (
    raw?.status?.state &&
    ["SUCCEED", "FAILED", "CANCELLED"].includes(raw.status.state)
  ) {
    return parseJobResponse(
      submitResp as Parameters<typeof parseJobResponse>[0],
      jobId,
    )
  }

  return pollJobResult(clientOpts, jobId)
}
