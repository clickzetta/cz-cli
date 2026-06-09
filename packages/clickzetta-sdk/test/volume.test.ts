/**
 * Tests for sql/volume.ts
 *
 * All HTTP calls are mocked — no real network traffic.
 */
import { describe, expect, test, mock, beforeEach, afterEach } from "bun:test"
import { mkdir, writeFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  isVolumeSql,
  isRetryableVolumeError,
  executeVolumeTransferWithRetry,
  genNewPutSql,
  normalizeFilePath,
  resolveLocalPath,
  getVolumeFiles,
  type VolumeOutcome,
} from "../src/sql/volume.js"

// -------------------------------------------------------------------------
// isVolumeSql — client.py:1340-1344
// -------------------------------------------------------------------------

describe("isVolumeSql (client.py:1340-1344)", () => {
  test("PUT with space → true", () => {
    expect(isVolumeSql("PUT '/local/file' TO @vol")).toBe(true)
  })
  test("GET with space → true", () => {
    expect(isVolumeSql("GET @vol/file TO '/local/'")).toBe(true)
  })
  test("leading whitespace stripped", () => {
    expect(isVolumeSql("  put '/file' TO @vol")).toBe(true)
    expect(isVolumeSql("\n  get @vol TO '/dir/'")).toBe(true)
  })
  test("SELECT → false", () => {
    expect(isVolumeSql("SELECT 1")).toBe(false)
  })
  test("PUTX → false (no trailing space)", () => {
    expect(isVolumeSql("PUTX something")).toBe(false)
  })
  test("GETX → false", () => {
    expect(isVolumeSql("GETX something")).toBe(false)
  })
  test("empty string → false", () => {
    expect(isVolumeSql("")).toBe(false)
  })
})

// -------------------------------------------------------------------------
// normalizeFilePath — utils.py:187-209
// -------------------------------------------------------------------------

describe("normalizeFilePath (utils.py:187-209)", () => {
  test("strips file:// prefix", () => {
    expect(normalizeFilePath("file:///tmp/foo.csv")).toBe("/tmp/foo.csv")
  })
  test("strips file:/ prefix (single slash)", () => {
    expect(normalizeFilePath("file:/tmp/foo.csv")).toBe("/tmp/foo.csv")
  })
  test("strips file:// prefix (double slash)", () => {
    expect(normalizeFilePath("file://tmp/foo.csv")).toBe("/tmp/foo.csv")
  })
  test("plain path unchanged", () => {
    expect(normalizeFilePath("/tmp/foo.csv")).toBe("/tmp/foo.csv")
  })
  test("~ expands to home dir", () => {
    const home = process.env["HOME"] ?? process.env["USERPROFILE"] ?? ""
    const result = normalizeFilePath("~/data/file.csv")
    if (home) {
      expect(result).toBe(home + "/data/file.csv")
    } else {
      // No HOME env — path left as-is
      expect(result).toBe("~/data/file.csv")
    }
  })
  test("Windows path not prefixed with slash", () => {
    expect(normalizeFilePath("file:///C:/Users/foo/bar.csv")).toBe("C:/Users/foo/bar.csv")
  })
})

// -------------------------------------------------------------------------
// resolveLocalPath — _volume.py:22-27
// -------------------------------------------------------------------------

describe("resolveLocalPath (_volume.py:22-27)", () => {
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = join(tmpdir(), `cz-vol-test-${Date.now()}`)
    await mkdir(tmpDir, { recursive: true })
  })

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true })
  })

  test("single file path → [path]", async () => {
    const p = join(tmpDir, "file.csv")
    await writeFile(p, "data")
    const result = await resolveLocalPath(p)
    expect(result).toEqual([p])
  })

  test("glob with * → matching files", async () => {
    await writeFile(join(tmpDir, "a.csv"), "")
    await writeFile(join(tmpDir, "b.csv"), "")
    await writeFile(join(tmpDir, "c.txt"), "")
    const result = await resolveLocalPath(join(tmpDir, "*.csv"))
    expect(result.length).toBe(2)
    expect(result.every((p) => p.endsWith(".csv"))).toBe(true)
  })

  test("glob with no matches → []", async () => {
    const result = await resolveLocalPath(join(tmpDir, "*.parquet"))
    expect(result).toEqual([])
  })

  test("directory path (trailing /) → all files recursively", async () => {
    const subDir = join(tmpDir, "sub")
    await mkdir(subDir)
    await writeFile(join(tmpDir, "root.csv"), "")
    await writeFile(join(subDir, "nested.csv"), "")
    const result = await resolveLocalPath(tmpDir + "/")
    expect(result.length).toBe(2)
    expect(result.some((p) => p.endsWith("root.csv"))).toBe(true)
    expect(result.some((p) => p.endsWith("nested.csv"))).toBe(true)
  })
})

describe("genNewPutSql (client.py:1420-1442)", () => {
  test("emits POSIX-style paths for Windows PUT continuation SQL", async () => {
    const sql = await genNewPutSql({
      status: "CONTINUE",
      request: {
        command: "PUT",
        localPaths: ["C:\\Users\\alice\\data\\part-1.csv"],
        volumeIdentifier: "@vol",
        options: [],
      },
      ticket: { presignedUrls: [] },
    })

    expect(sql).toBe("PUT 'C:/Users/alice/data/part-1.csv' TO @vol;")
  })

  test("treats trailing Windows separator as a directory path", async () => {
    const subDir = join(tmpdir(), `cz-vol-win-dir-${Date.now()}`)
    await mkdir(subDir, { recursive: true })
    await writeFile(join(subDir, "a.csv"), "")

    try {
      const result = await resolveLocalPath(subDir + "\\")
      expect(result.length).toBe(1)
      expect(result[0].endsWith("a.csv")).toBe(true)
    } finally {
      await rm(subDir, { recursive: true, force: true })
    }
  })
})

// -------------------------------------------------------------------------
// isRetryableVolumeError — client.py:897-924
// -------------------------------------------------------------------------

describe("isRetryableVolumeError (client.py:897-924)", () => {
  function httpErr(status: number): Error & { status: number } {
    const e = new Error(`HTTP ${status}`) as Error & { status: number }
    e.status = status
    return e
  }

  test("HTTP 408 → retryable", () => {
    expect(isRetryableVolumeError(httpErr(408))).toBe(true)
  })
  test("HTTP 429 → retryable", () => {
    expect(isRetryableVolumeError(httpErr(429))).toBe(true)
  })
  test("HTTP 500 → retryable", () => {
    expect(isRetryableVolumeError(httpErr(500))).toBe(true)
  })
  test("HTTP 502 → retryable", () => {
    expect(isRetryableVolumeError(httpErr(502))).toBe(true)
  })
  test("HTTP 503 → retryable", () => {
    expect(isRetryableVolumeError(httpErr(503))).toBe(true)
  })
  test("HTTP 504 → retryable", () => {
    expect(isRetryableVolumeError(httpErr(504))).toBe(true)
  })
  test("HTTP 404 → not retryable", () => {
    expect(isRetryableVolumeError(httpErr(404))).toBe(false)
  })
  test("HTTP 200 → not retryable", () => {
    expect(isRetryableVolumeError(httpErr(200))).toBe(false)
  })

  test("message: failed to establish a new connection → retryable", () => {
    expect(isRetryableVolumeError(new Error("Failed to establish a new connection"))).toBe(true)
  })
  test("message: max retries exceeded → retryable", () => {
    expect(isRetryableVolumeError(new Error("Max Retries Exceeded"))).toBe(true)
  })
  test("message: timed out → retryable", () => {
    expect(isRetryableVolumeError(new Error("Request Timed Out"))).toBe(true)
  })
  test("message: connection reset by peer → retryable", () => {
    expect(isRetryableVolumeError(new Error("Connection Reset By Peer"))).toBe(true)
  })
  test("message: temporary failure in name resolution → retryable", () => {
    expect(isRetryableVolumeError(new Error("Temporary Failure In Name Resolution"))).toBe(true)
  })
  test("message: name or service not known → retryable", () => {
    expect(isRetryableVolumeError(new Error("Name Or Service Not Known"))).toBe(true)
  })
  test("message: remote end closed connection → retryable", () => {
    expect(isRetryableVolumeError(new Error("Remote End Closed Connection"))).toBe(true)
  })
  test("message: connection aborted → retryable", () => {
    expect(isRetryableVolumeError(new Error("Connection Aborted"))).toBe(true)
  })
  test("generic error → not retryable", () => {
    expect(isRetryableVolumeError(new Error("Something went wrong"))).toBe(false)
  })
  test("non-Error value → not retryable", () => {
    expect(isRetryableVolumeError("string error")).toBe(false)
    expect(isRetryableVolumeError(null)).toBe(false)
    expect(isRetryableVolumeError(42)).toBe(false)
  })
})

// -------------------------------------------------------------------------
// executeVolumeTransferWithRetry — client.py:926-964
// -------------------------------------------------------------------------

// No-op sleep to avoid real backoff delays in tests
const noSleep = async (_ms: number) => {}

describe("executeVolumeTransferWithRetry (client.py:926-964)", () => {
  test("success on first attempt → returns result", async () => {
    const result = await executeVolumeTransferWithRetry("GET", "target", async () => "ok", noSleep)
    expect(result).toBe("ok")
  })

  test("one retryable failure then success → returns result", async () => {
    let calls = 0
    const result = await executeVolumeTransferWithRetry("GET", "target", async () => {
      calls++
      if (calls === 1) {
        const e = new Error("timed out") as Error & { status: number }
        e.status = 503
        throw e
      }
      return "recovered"
    }, noSleep)
    expect(result).toBe("recovered")
    expect(calls).toBe(2)
  })

  test("non-retryable error → throws immediately without retry", async () => {
    let calls = 0
    await expect(
      executeVolumeTransferWithRetry("PUT", "target", async () => {
        calls++
        throw new Error("permission denied")
      }, noSleep),
    ).rejects.toThrow("permission denied")
    expect(calls).toBe(1)
  })

  test("exceeds max retries → throws last error", async () => {
    let calls = 0
    const retryableErr = (): Error & { status: number } => {
      const e = new Error("connection aborted") as Error & { status: number }
      e.status = 503
      return e
    }
    await expect(
      executeVolumeTransferWithRetry("GET", "target", async () => {
        calls++
        throw retryableErr()
      }, noSleep),
    ).rejects.toThrow("connection aborted")
    // max_retries=3 → total_attempts=4
    expect(calls).toBe(4)
  })
})

// -------------------------------------------------------------------------
// getVolumeFiles — client.py:1042-1053
// -------------------------------------------------------------------------

describe("getVolumeFiles (client.py:1042-1053)", () => {
  function makeOutcome(overrides: Partial<VolumeOutcome["request"]>, urls: string[]): VolumeOutcome {
    return {
      status: "SUCCESS",
      request: {
        command: "GET",
        localPaths: ["/tmp/"],
        ...overrides,
      },
      ticket: { presignedUrls: urls },
    }
  }

  test("request.file present → basename of resolved path", () => {
    const outcome = makeOutcome({ file: "/some/path/report.csv" }, [])
    const files = getVolumeFiles(outcome)
    expect(files).toEqual(["report.csv"])
  })

  test("no request.file → extract from presigned URL path", () => {
    const outcome = makeOutcome({}, [
      "https://storage.example.com/bucket/prefix/data.parquet?sig=abc",
      "https://storage.example.com/bucket/prefix/data2.parquet?sig=xyz",
    ])
    const files = getVolumeFiles(outcome)
    expect(files).toEqual(["data.parquet", "data2.parquet"])
  })

  test("URL-encoded filename decoded", () => {
    const outcome = makeOutcome({}, [
      "https://storage.example.com/bucket/my%20file.csv",
    ])
    const files = getVolumeFiles(outcome)
    expect(files).toEqual(["my file.csv"])
  })
})
