import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { FsError, FsUtil } from "../src/fsutil.js"
import { quote } from "../src/sql/literal.js"
import { JobStatus, type QueryResult } from "../src/sql/types.js"

function result(rows: unknown[][]): QueryResult {
  return { jobId: "", status: JobStatus.SUCCEEDED, columns: [], rows, rowCount: rows.length }
}

describe("FsUtil", () => {
  let root: string

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "cz-fsutil-"))
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  test("handles local mkdir, put, head, list, copy, move, and remove", async () => {
    const fs = new FsUtil({ execute: async () => { throw new Error("unexpected SQL") } })
    const source = join(root, "source", "nested.txt")
    const copyDir = join(root, "copy")
    const moved = join(root, "moved.txt")

    await fs.mkdirs(join(root, "source"))
    await fs.put(source, "hello")
    expect(await fs.head(source)).toBe("hello")
    expect((await fs.ls(join(root, "source")))[0]?.name).toBe("nested.txt")

    await fs.cp(join(root, "source"), copyDir)
    expect(await fs.head(join(copyDir, "nested.txt"))).toBe("hello")
    await fs.put(join(root, "copy-target.txt"), "old")
    await fs.cp(source, join(root, "copy-target.txt"))
    expect(await fs.head(join(root, "copy-target.txt"))).toBe("hello")
    await fs.mv(join(copyDir, "nested.txt"), moved)
    expect(await fs.head(moved)).toBe("hello")
    await fs.rm(join(root, "source"), true)
    expect(await fs.head(moved)).toBe("hello")
  })

  test("copies a directory shallowly unless recursive is requested", async () => {
    const fs = new FsUtil({ execute: async () => { throw new Error("unexpected SQL") } })
    const source = join(root, "tree")
    await mkdir(join(source, "nested"), { recursive: true })
    await writeFile(join(source, "top.txt"), "top")
    await writeFile(join(source, "nested", "deep.txt"), "deep")

    const shallow = join(root, "shallow")
    await fs.cp(source, shallow)
    expect(await readFile(join(shallow, "top.txt"), "utf8")).toBe("top")
    await expect(fs.head(join(shallow, "nested", "deep.txt"))).rejects.toMatchObject({ code: "FS_NOT_FOUND" })

    const recursive = join(root, "recursive")
    await fs.cp(source, recursive, true)
    expect(await readFile(join(recursive, "nested", "deep.txt"), "utf8")).toBe("deep")
  })

  test("lists local directory entries and preserves empty directory copies", async () => {
    const fs = new FsUtil({ execute: async () => { throw new Error("unexpected SQL") } })
    const source = join(root, "tree")
    await mkdir(join(source, "nested"), { recursive: true })
    await writeFile(join(source, "top.txt"), "top")
    await writeFile(join(source, "nested", "deep.txt"), "deep")

    const entries = await fs.ls(source, true)
    expect(entries.map((entry) => [entry.name, entry.isDir])).toEqual(expect.arrayContaining([
      ["nested", true],
      ["top.txt", false],
    ]))

    const copied = join(root, "copied")
    await fs.cp(source, copied, true)
    expect((await stat(copied)).isDirectory()).toBe(true)
    expect((await stat(join(copied, "nested"))).isDirectory()).toBe(true)

    const emptySource = join(root, "empty")
    const emptyCopy = join(root, "empty-copy")
    await mkdir(emptySource)
    await fs.cp(emptySource, emptyCopy, true)
    expect((await stat(emptyCopy)).isDirectory()).toBe(true)
  })

  test("merges a local directory move into an existing directory", async () => {
    const fs = new FsUtil({ execute: async () => { throw new Error("unexpected SQL") } })
    const source = join(root, "source")
    const archive = join(root, "archive")
    const target = join(archive, "source")
    await mkdir(source, { recursive: true })
    await mkdir(target, { recursive: true })
    await writeFile(join(source, "new.txt"), "new")
    await writeFile(join(target, "old.txt"), "old")

    await fs.mv(source, archive, true)
    expect(await readFile(join(target, "new.txt"), "utf8")).toBe("new")
    expect(await readFile(join(target, "old.txt"), "utf8")).toBe("old")
  })

  test("rejects unsafe and incompatible operations", async () => {
    const fs = new FsUtil({ execute: async () => { throw new Error("unexpected SQL") } })
    await expect(fs.cp(join(root, "missing"), join(root, "target"))).rejects.toMatchObject({ code: "FS_NOT_FOUND" })
    await expect(fs.rm("/", true)).rejects.toMatchObject({ code: "FS_PATH_INVALID" })
    await expect(fs.cp(root, root, true)).rejects.toMatchObject({ code: "FS_PATH_INVALID" })
    await expect(fs.cp(root, join(root, "child"), true)).rejects.toMatchObject({ code: "FS_PATH_INVALID" })
    expect(() => fs.path("s3://bucket/file")).toThrow(FsError)
    expect(() => fs.path("czfs:/Volumes/demo/public/volume/../secret")).toThrow(FsError)
    await expect(fs.mv(join(root, "source"), join(root, "source"), true)).rejects.toMatchObject({ code: "FS_PATH_INVALID" })
  })

  test("does not translate Volume network errors into text errors", async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async () => { throw new TypeError("network down") }) as typeof fetch
    try {
      const fs = new FsUtil({
        execute: async (sql) => sql.startsWith("select get_file")
          ? result([[JSON.stringify({ path: "data.txt", dir: false, size: 1, mtime: 0 })]])
          : result([["https://example.invalid/data.txt"]]),
      })
      await expect(fs.head("volume://workspace.schema.volume/data.txt")).rejects.toThrow("network down")
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test("escapes backslashes in Volume SQL literals", async () => {
    const statements: string[] = []
    const fs = new FsUtil({
      execute: async (sql) => {
        statements.push(sql)
        if (sql.startsWith("select get_file")) return result([[JSON.stringify({ path: "a\\", dir: false, size: 1, mtime: 0 })]])
        throw new Error(`unexpected SQL: ${sql}`)
      },
    })

    await fs.info("volume://workspace.public.volume/a\\")
    expect(statements[0]).toContain(quote("a\\"))
  })

  test("retries transient Volume reads", async () => {
    const originalFetch = globalThis.fetch
    let fetches = 0
    globalThis.fetch = (async () => {
      fetches++
      return fetches === 1 ? new Response(null, { status: 503 }) : new Response("ok")
    }) as typeof fetch
    try {
      const fs = new FsUtil({
        execute: async (sql) => sql.startsWith("select get_file")
          ? result([[JSON.stringify({ path: "data.txt", dir: false, size: 2, mtime: 0 })]])
          : result([["https://example.invalid/data.txt"]]),
      })
      expect(await fs.head("volume://workspace.schema.volume/data.txt")).toBe("ok")
      expect(fetches).toBe(2)
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test("retries transient Volume writes", async () => {
    const originalFetch = globalThis.fetch
    let fetches = 0
    globalThis.fetch = (async () => {
      fetches++
      return fetches === 1 ? new Response(null, { status: 503 }) : new Response(null, { status: 201 })
    }) as typeof fetch
    try {
      const fs = new FsUtil({
        execute: async (sql) => {
          if (sql.startsWith("select get_file")) return { ...result([]), status: JobStatus.FAILED, errorMessage: "Path not found" }
          if (sql.startsWith("select get_presigned_url")) return result([["https://example.invalid/data.txt"]])
          throw new Error(`unexpected SQL: ${sql}`)
        },
        workspace: "workspace",
        schema: "public",
      })
      const source = join(root, "upload.txt")
      await writeFile(source, "upload")
      await fs.cp(source, "volume://volume/data.txt")
      expect(fetches).toBe(2)
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test("maps malformed Volume metadata to FsError", async () => {
    const fs = new FsUtil({
      execute: async () => result([["not-json"]]),
    })
    await expect(fs.info("volume://workspace.schema.volume/data.txt")).rejects.toMatchObject({ code: "FS_TRANSFER_FAILED" })
  })

  test("moves an empty local directory to a Volume", async () => {
    const statements: string[] = []
    const source = join(root, "empty-source")
    await mkdir(source)
    const fs = new FsUtil({
      execute: async (sql) => {
        statements.push(sql)
        if (sql.startsWith("select get_file")) return { ...result([]), status: JobStatus.FAILED, errorMessage: "Path not found" }
        if (sql.startsWith("select create_directory")) return result([[JSON.stringify({ success: true })]])
        throw new Error(`unexpected SQL: ${sql}`)
      },
      workspace: "workspace",
      schema: "public",
    })

    await fs.mv(source, "volume://volume/empty-target", true)
    expect(await stat(source).catch(() => undefined)).toBeUndefined()
    expect(statements.some((sql) => sql.startsWith("select create_directory"))).toBe(true)
  })

  test("rejects a Volume move into its own parent", async () => {
    let transfers = 0
    const fs = new FsUtil({
      execute: async (sql) => {
        if (sql.startsWith("select get_file")) return result([[JSON.stringify({ path: "a.txt", dir: false, size: 1, mtime: 0 })]])
        if (sql.startsWith("select get_presigned_url")) {
          transfers++
          return result([["https://example.invalid/a.txt"]])
        }
        throw new Error(`unexpected SQL: ${sql}`)
      },
    })
    await expect(fs.mv("volume://workspace.schema.volume/a.txt", "volume://workspace.schema.volume/"))
      .rejects.toMatchObject({ code: "FS_PATH_INVALID" })
    expect(transfers).toBe(0)
  })

  test("maps Volume metadata and short paths using connection context", async () => {
    const fs = new FsUtil({
      workspace: "workspace",
      schema: "public",
      execute: async (sql) => {
        if (sql.includes("'data/file.txt'")) return result([[JSON.stringify({ path: "data/file.txt", dir: false, size: 7, mtime: 2 })]])
        if (sql.startsWith("select get_file")) return result([[JSON.stringify({ path: "data", dir: true, size: 0, mtime: 0 })]])
        if (sql.startsWith("select list_directory")) {
          expect(sql).toEndWith("limit 1")
          return result([
          [JSON.stringify({ path: "data/file.txt", dir: false, size: 7 })],
          [JSON.stringify({ path: "data/file.txt", dir: false, size: 7 })],
          ])
        }
        throw new Error(`unexpected SQL: ${sql}`)
      },
    })

    const entries = await fs.ls("volume://volume/data", false, 1)
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({ name: "file.txt", size: 7, isDir: false })
    expect(entries[0]?.modificationTime).toBeNull()
    expect(entries[0]?.path).toBe("czfs:/Volumes/workspace/public/volume/data/file.txt")
    expect(() => fs.path("volume://volume/%ZZ")).toThrow(FsError)
    await expect(fs.mkdirs("volume://volume")).rejects.toMatchObject({ code: "FS_PATH_INVALID" })
    await expect(fs.put("volume://volume/data", "new", true)).rejects.toMatchObject({ code: "FS_IS_DIRECTORY" })
  })

  test("creates only Named Volume roots", async () => {
    const statements: string[] = []
    const fs = new FsUtil({
      execute: async (sql) => {
        statements.push(sql)
        return result([])
      },
    })

    expect(await fs.mb("volume://shared_files/")).toBe(true)
    expect(await fs.mb("volume://public.shared_files")).toBe(true)
    expect(statements).toEqual([
      "create volume `shared_files`",
      "create volume `public`.`shared_files`",
    ])
    await expect(fs.mb("volume://shared_files/data")).rejects.toMatchObject({ code: "FS_PATH_INVALID" })
    await expect(fs.mb("volume:user://~/")).rejects.toMatchObject({ code: "FS_PATH_INVALID" })
    await expect(fs.mb("./shared_files")).rejects.toMatchObject({ code: "FS_PATH_INVALID" })

    const existing = new FsUtil({
      execute: async () => ({ ...result([]), status: JobStatus.FAILED, errorMessage: "AlreadyExist: volume exists" }),
    })
    await expect(existing.mb("volume://shared_files")).rejects.toMatchObject({ code: "FS_TARGET_EXISTS" })
  })

  test("lists an existing empty Named Volume root as empty", async () => {
    const fs = new FsUtil({
      workspace: "workspace",
      schema: "public",
      execute: async (sql) => {
        if (sql.startsWith("select list_directory")) {
          return { ...result([]), status: JobStatus.FAILED, errorMessage: "Path not found: volume root" }
        }
        if (sql.startsWith("list volume")) return result([])
        throw new Error(`unexpected SQL: ${sql}`)
      },
    })

    expect(await fs.ls("volume://volume")).toEqual([])
  })

  test("keeps missing Named Volume roots as not found", async () => {
    const fs = new FsUtil({
      workspace: "workspace",
      schema: "public",
      execute: async (sql) => {
        if (sql.startsWith("select list_directory")) {
          return { ...result([]), status: JobStatus.FAILED, errorMessage: "Path not found: volume root" }
        }
        if (sql.startsWith("list volume")) {
          return { ...result([]), status: JobStatus.FAILED, errorMessage: "volume not found" }
        }
        throw new Error(`unexpected SQL: ${sql}`)
      },
    })

    await expect(fs.ls("volume://missing")).rejects.toMatchObject({ code: "FS_NOT_FOUND" })
  })

  test("preserves target-exists errors for move without overwrite", async () => {
    const fs = new FsUtil({
      execute: async (sql) => {
        if (sql.includes("'source.txt'")) return result([[JSON.stringify({ path: "source.txt", dir: false, size: 1, mtime: 0 })]])
        if (sql.includes("'target.txt'")) return result([[JSON.stringify({ path: "target.txt", dir: false, size: 1, mtime: 0 })]])
        throw new Error(`unexpected SQL: ${sql}`)
      },
    })

    await expect(fs.mv("volume://workspace.public.volume/source.txt", "volume://workspace.public.volume/target.txt", false, false)).rejects.toMatchObject({ code: "FS_TARGET_EXISTS" })
  })
})
