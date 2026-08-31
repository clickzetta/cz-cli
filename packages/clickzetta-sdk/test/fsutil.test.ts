import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { FsError, FsUtil, parseVolumePath } from "../src/fsutil.js"
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
    await expect(fs.cp(source, join(root, "copy-target.txt"))).rejects.toMatchObject({ code: "FS_TARGET_EXISTS" })
    await fs.cp(source, join(root, "copy-target.txt"), false, true)
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

  test("preflights directory collisions before writing any files", async () => {
    const fs = new FsUtil({ execute: async () => { throw new Error("unexpected SQL") } })
    const source = join(root, "source")
    const destination = join(root, "destination", "source")
    await mkdir(source, { recursive: true })
    await mkdir(destination, { recursive: true })
    await writeFile(join(source, "a.txt"), "new-a")
    await writeFile(join(source, "b.txt"), "new-b")
    await writeFile(join(destination, "a.txt"), "old-a")

    await expect(fs.cp(source, join(root, "destination"), true)).rejects.toMatchObject({ code: "FS_TARGET_EXISTS" })
    expect(await readFile(join(destination, "a.txt"), "utf8")).toBe("old-a")
    expect(await stat(join(destination, "b.txt")).catch(() => undefined)).toBeUndefined()
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

  test("requires the czfs scheme and rejects unknown type markers", () => {
    expect(parseVolumePath("/Volume")).toBeUndefined()
    expect(parseVolumePath("/Volume/Workspace/Schema/Volume/data.csv")).toBeUndefined()
    expect(parseVolumePath("CZFS:/VOLUME/Workspace/Schema/Volume/data.csv")).toMatchObject({
      reference: { kind: "named", identifiers: ["Workspace", "Schema", "Volume"] },
      relativePath: "data.csv",
    })
    expect(parseVolumePath("CZFS:/VOLUMES/@TABLE/ws/sc/orders/data.csv")).toMatchObject({
      reference: { kind: "table", identifiers: ["ws", "sc", "orders"] },
      relativePath: "data.csv",
    })
    expect(parseVolumePath("/Volumes/@future/ws/sc/name/data.csv")).toBeUndefined()
    expect(() => parseVolumePath("CZFS:/Volumes/@future/ws/sc/name/data.csv")).toThrow(FsError)
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
    const fs = new FsUtil({ workspace: "workspace", schema: "public",
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
    const fs = new FsUtil({ workspace: "workspace", schema: "public",
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
    const fs = new FsUtil({ workspace: "workspace", schema: "public",
      execute: async (sql) => {
        statements.push(sql)
        return result([])
      },
    })

    await fs.mb("volume://shared_files/")
    await fs.mb("volume://public.shared_files")
    expect(statements).toEqual([
      "create volume `workspace`.`public`.`shared_files`",
      "create volume `workspace`.`public`.`shared_files`",
    ])
    const qualifiedStatements: string[] = []
    const qualified = new FsUtil({ workspace: "workspace", schema: "public", execute: async (sql) => { qualifiedStatements.push(sql); return result([]) } })
    await qualified.mb("czfs:/Volumes/workspace/public/qualified")
    expect(qualifiedStatements).toEqual(["create volume `workspace`.`public`.`qualified`"])
    await qualified.mb("czfs:/Volumes/other/public/qualified")
    expect(qualifiedStatements).toEqual(["create volume `workspace`.`public`.`qualified`", "create volume `other`.`public`.`qualified`"])
    await expect(fs.mb("volume://shared_files/data")).rejects.toMatchObject({ code: "FS_PATH_INVALID" })
    await expect(fs.mb("zhanglin_test2")).rejects.toMatchObject({
      code: "FS_PATH_INVALID",
      message: "fs mb expects a Named Volume root in the form czfs:/Volumes/<workspace>/<schema>/<volume>; received 'zhanglin_test2'.",
    })
    await expect(fs.mb("volume://")).rejects.toMatchObject({ code: "FS_PATH_INVALID" })
    await expect(fs.mb("volume:user://~/")).rejects.toMatchObject({ code: "FS_PATH_INVALID" })
    await expect(fs.mb("./shared_files")).rejects.toMatchObject({ code: "FS_PATH_INVALID" })
    const noContext = new FsUtil({ execute: async () => result([]) })
    await expect(noContext.mb("volume://shared_files")).rejects.toMatchObject({ code: "FS_PATH_CONTEXT_REQUIRED" })
    await expect(noContext.rb("volume://shared_files")).rejects.toMatchObject({ code: "FS_PATH_CONTEXT_REQUIRED" })

    const existing = new FsUtil({
      execute: async () => ({ ...result([]), status: JobStatus.FAILED, errorMessage: "AlreadyExist: volume exists" }),
    })
    await expect(existing.mb("czfs:/Volumes/workspace/public/shared_files")).rejects.toMatchObject({ code: "FS_TARGET_EXISTS" })

    const dropped: string[] = []
    const removable = new FsUtil({ workspace: "workspace", schema: "public", execute: async (sql) => {
      dropped.push(sql)
      if (sql.startsWith("SHOW VOLUMES")) return { ...result([["public", "shared_files", "", false, "workspace"]]), columns: [{ name: "schema_name", type: "STRING" }, { name: "volume_name", type: "STRING" }, { name: "url", type: "STRING" }, { name: "external", type: "BOOLEAN" }, { name: "workspace_name", type: "STRING" }] }
      return result([])
    } })
    expect(await removable.rb("czfs:/Volumes/workspace/public/shared_files")).toBe(true)
    expect(dropped).toEqual(["SHOW VOLUMES WHERE volume_name = 'shared_files' AND schema_name = 'public' AND workspace_name = 'workspace'", "SHOW VOLUME DIRECTORY `workspace`.`public`.`shared_files`", "drop volume `workspace`.`public`.`shared_files`"])
    await expect(removable.rb("czfs:/Volumes/@table/workspace/public/orders")).rejects.toMatchObject({ code: "FS_PATH_INVALID" })

    const nonEmpty = new FsUtil({ workspace: "workspace", schema: "public",
      execute: async (sql) => sql.startsWith("SHOW VOLUMES")
        ? { ...result([["public", "shared_files", "", false, "workspace"]]), columns: [{ name: "schema_name", type: "STRING" }, { name: "volume_name", type: "STRING" }, { name: "url", type: "STRING" }, { name: "external", type: "BOOLEAN" }, { name: "workspace_name", type: "STRING" }] }
        : sql.startsWith("SHOW VOLUME DIRECTORY")
          ? { ...result([["data.csv", "", 1, ""]]), columns: [{ name: "relative_path", type: "STRING" }, { name: "url", type: "STRING" }, { name: "size", type: "INT" }, { name: "last_modified_time", type: "STRING" }] }
          : result([]),
    })
    await expect(nonEmpty.rb("czfs:/Volumes/workspace/public/shared_files")).rejects.toMatchObject({ code: "FS_NOT_EMPTY" })

    const external = new FsUtil({
      workspace: "workspace",
      schema: "public",
      execute: async (sql) => sql.startsWith("SHOW VOLUMES")
        ? { ...result([["public", "external", "", true, "workspace"]]), columns: [{ name: "schema_name", type: "STRING" }, { name: "volume_name", type: "STRING" }, { name: "url", type: "STRING" }, { name: "external", type: "BOOLEAN" }, { name: "workspace_name", type: "STRING" }] }
        : result([]),
    })
    await expect(external.rb("czfs:/Volumes/workspace/public/external")).rejects.toMatchObject({ code: "FS_PATH_INVALID" })

    const invisible = new FsUtil({ workspace: "workspace", schema: "public", execute: async () => result([]) })
    await expect(invisible.rb("czfs:/Volumes/workspace/public/missing")).rejects.toMatchObject({ code: "FS_NOT_FOUND" })
  })

  test("fails closed when SHOW VOLUMES omits type metadata", async () => {
    const fs = new FsUtil({
      workspace: "workspace",
      schema: "public",
      execute: async (sql) => sql.startsWith("SHOW VOLUMES")
        ? { ...result([["public", "shared_files", "workspace"]]), columns: [{ name: "schema_name", type: "STRING" }, { name: "volume_name", type: "STRING" }, { name: "workspace_name", type: "STRING" }] }
        : result([]),
    })
    await expect(fs.rb("czfs:/Volumes/workspace/public/shared_files")).rejects.toMatchObject({ code: "FS_TRANSFER_FAILED" })
  })

  test("fails closed when Volume directory rows omit their path column", async () => {
    const statements: string[] = []
    const fs = new FsUtil({
      workspace: "workspace",
      schema: "public",
      execute: async (sql) => {
        statements.push(sql)
        if (sql.startsWith("SHOW VOLUMES")) return { ...result([["public", "shared_files", "", false, "workspace"]]), columns: [{ name: "schema_name", type: "STRING" }, { name: "volume_name", type: "STRING" }, { name: "url", type: "STRING" }, { name: "external", type: "BOOLEAN" }, { name: "workspace_name", type: "STRING" }] }
        if (sql.startsWith("SHOW VOLUME DIRECTORY")) return { ...result([["https://example.invalid/file", 1]]), columns: [{ name: "url", type: "STRING" }, { name: "size", type: "INT" }] }
        return result([])
      },
    })
    await expect(fs.rb("czfs:/Volumes/workspace/public/shared_files")).rejects.toMatchObject({ code: "FS_TRANSFER_FAILED" })
    expect(statements.some((sql) => sql.startsWith("drop volume"))).toBe(false)
  })

  test("fails when current_user is missing instead of exposing an empty User Volume", async () => {
    const fs = new FsUtil({
      workspace: "workspace",
      execute: async (sql) => sql === "SELECT current_user()" ? result([[]]) : result([]),
    })
    await expect(fs.ls("czfs:/Volumes/@user")).rejects.toMatchObject({ code: "FS_TRANSFER_FAILED" })
  })

  test("lists an existing empty Named Volume root as empty", async () => {
    const fs = new FsUtil({
      workspace: "workspace",
      schema: "public",
      execute: async (sql) => {
        if (sql.startsWith("SHOW VOLUME DIRECTORY")) return result([])
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
        if (sql.startsWith("SHOW VOLUME DIRECTORY")) return { ...result([]), status: JobStatus.FAILED, errorMessage: "volume not found" }
        throw new Error(`unexpected SQL: ${sql}`)
      },
    })

    await expect(fs.ls("volume://missing")).rejects.toMatchObject({ code: "FS_NOT_FOUND" })
  })

  test("does not hide unsupported Volume SQL functions as empty directories", async () => {
    const fs = new FsUtil({
      workspace: "workspace",
      schema: "public",
      execute: async (sql) => {
        if (sql.startsWith("select get_file")) return result([[JSON.stringify({ path: "data", dir: true, size: 0 })]])
        if (sql.startsWith("select list_directory")) return { ...result([]), status: JobStatus.FAILED, errorMessage: "Function list_directory does not exist" }
        throw new Error(`unexpected SQL: ${sql}`)
      },
    })

    await expect(fs.ls("volume://workspace.public.volume/data")).rejects.toMatchObject({ code: "FS_TRANSFER_FAILED" })
  })

  test("does not classify unrelated SQL object errors as missing files", async () => {
    const fs = new FsUtil({
      execute: async (sql) => sql.startsWith("select get_file")
        ? { ...result([]), status: JobStatus.FAILED, errorMessage: "Table orders does not exist" }
        : result([]),
    })
    await expect(fs.info("volume://workspace.public.volume/data.csv")).rejects.toMatchObject({ code: "FS_TRANSFER_FAILED" })
  })

  test("uses metadata SQL for Volume roots", async () => {
    const statements: string[] = []
    const fs = new FsUtil({
      workspace: "workspace",
      schema: "public",
      execute: async (sql) => {
        statements.push(sql)
        if (sql === "SHOW VOLUMES") return { ...result([["shared_files", "workspace", "public"]]), columns: [{ name: "volume_name", type: "STRING" }, { name: "workspace_name", type: "STRING" }, { name: "schema_name", type: "STRING" }] }
        if (sql === "SELECT current_user()") return result([["alice"]])
        if (sql === "SHOW USER VOLUME DIRECTORY") return { ...result([["uploads/a.csv", "", 3, "2026-08-28T00:00:00Z"]]), columns: [{ name: "relative_path", type: "STRING" }, { name: "url", type: "STRING" }, { name: "size", type: "INT" }, { name: "last_modified_time", type: "STRING" }] }
        if (sql === "SHOW TABLES") return { ...result([["public", "orders"]]), columns: [{ name: "schema_name", type: "STRING" }, { name: "table_name", type: "STRING" }] }
        if (sql === "SHOW TABLE VOLUME DIRECTORY `workspace`.`public`.`orders`") return { ...result([["sample/file.parquet", "", 10, ""]]), columns: [{ name: "relative_path", type: "STRING" }, { name: "url", type: "STRING" }, { name: "size", type: "INT" }, { name: "last_modified_time", type: "STRING" }] }
        throw new Error(`unexpected SQL: ${sql}`)
      },
    })

    const rootEntries = await fs.ls("czfs:/")
    expect(rootEntries).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "shared_files", isDir: true, path: "czfs:/Volumes/workspace/public/shared_files" }),
      expect.objectContaining({ name: "@user", isDir: true, path: "czfs:/Volumes/@user" }),
      expect.objectContaining({ name: "@table", isDir: true, path: "czfs:/Volumes/@table" }),
    ]))
    // The legacy spelling resolves through the same [workspace, user] reference as
    // czfs:/Volumes/@user, so both report identical czfs entry paths.
    expect((await fs.ls("volume:user://~/"))[0]).toMatchObject({ name: "uploads", isDir: true, path: "czfs:/Volumes/@user/workspace/alice/uploads" })
    expect((await fs.ls("volume:table://"))[0]).toMatchObject({ name: "orders", isDir: true, path: "czfs:/Volumes/@table/workspace/public/orders" })
    expect((await fs.ls("czfs:/Volumes/@user"))[0]).toMatchObject({ name: "uploads", isDir: true, path: "czfs:/Volumes/@user/workspace/alice/uploads" })
    expect(await fs.ls("czfs:/Volumes/@user", true)).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "uploads", isDir: true }),
      expect.objectContaining({ name: "a.csv", isDir: false }),
    ]))
    const tableEntries = await fs.ls("czfs:/Volumes/@table/workspace/public/orders/")
    expect(tableEntries[0]).toMatchObject({ name: "sample", isDir: true, path: "czfs:/Volumes/@table/workspace/public/orders/sample" })
    // An empty last_modified_time is unknown, not 1970-01-01.
    expect(tableEntries[0]?.modificationTime).toBeNull()
    expect(statements).toEqual(["SHOW VOLUMES", "SELECT current_user()", "SHOW USER VOLUME DIRECTORY", "SHOW TABLES", "SELECT current_user()", "SHOW USER VOLUME DIRECTORY", "SELECT current_user()", "SHOW USER VOLUME DIRECTORY", "SHOW TABLE VOLUME DIRECTORY `workspace`.`public`.`orders`"])
  })

  test("lists partial czfs namespace paths from metadata", async () => {
    const statements: string[] = []
    const fs = new FsUtil({ workspace: "workspace", schema: "public", execute: async (sql) => {
      statements.push(sql)
      if (sql === "SHOW VOLUMES") return { ...result([["public", "shared", "", false, "workspace"], ["other", "ignored", "", false, "workspace"]]), columns: [{ name: "schema_name", type: "STRING" }, { name: "volume_name", type: "STRING" }, { name: "url", type: "STRING" }, { name: "external", type: "BOOLEAN" }, { name: "workspace_name", type: "STRING" }] }
      if (sql === "SHOW TABLES") return { ...result([["public", "orders", false, false, false, false]]), columns: [{ name: "schema_name", type: "STRING" }, { name: "table_name", type: "STRING" }, { name: "is_view", type: "BOOLEAN" }, { name: "is_materialized_view", type: "BOOLEAN" }, { name: "is_external", type: "BOOLEAN" }, { name: "is_dynamic", type: "BOOLEAN" }] }
      if (sql === "SELECT current_user()") return result([["alice"]])
      if (sql === "SHOW USER VOLUME DIRECTORY") return { ...result([["data.csv", "", 1, ""]]), columns: [{ name: "relative_path", type: "STRING" }, { name: "url", type: "STRING" }, { name: "size", type: "INT" }, { name: "last_modified_time", type: "STRING" }] }
      throw new Error(`unexpected SQL: ${sql}`)
    } })

    expect((await fs.ls("czfs:/Volumes/workspace/public/")).map((entry) => entry.path)).toEqual(["czfs:/Volumes/workspace/public/shared"])
    expect((await fs.ls("czfs:/Volumes/@table/workspace/public/")).map((entry) => entry.path)).toEqual(["czfs:/Volumes/@table/workspace/public/orders"])
    expect((await fs.ls("czfs:/Volumes/@user/workspace/")).map((entry) => entry.path)).toEqual(["czfs:/Volumes/@user/workspace/alice/data.csv"])
    expect(statements).toEqual(["SHOW VOLUMES", "SHOW TABLES", "SELECT current_user()", "SHOW USER VOLUME DIRECTORY"])
  })

  test("sends decoded relative paths to Volume SQL for root listings", async () => {
    const statements: string[] = []
    const columns = [{ name: "relative_path", type: "STRING" }, { name: "url", type: "STRING" }, { name: "size", type: "INT" }, { name: "last_modified_time", type: "STRING" }]
    const fs = new FsUtil({
      workspace: "workspace",
      schema: "public",
      execute: async (sql) => {
        statements.push(sql)
        if (sql.startsWith("SHOW VOLUME DIRECTORY")) return { ...result([["a b.csv", "", 8, ""], ["数据/月度 报表.csv", "", 9, ""]]), columns }
        if (sql.startsWith("remove volume")) return result([])
        throw new Error(`unexpected SQL: ${sql}`)
      },
    })

    const entries = await fs.ls("czfs:/Volumes/workspace/public/vol/", true)
    // Display paths stay percent-encoded; the SQL argument must be the decoded key.
    expect(entries.map((entry) => entry.name)).toEqual(["a b.csv", "数据", "月度 报表.csv"])
    expect(entries[0]?.path).toBe("czfs:/Volumes/workspace/public/vol/a%20b.csv")

    const children = await fs.path("czfs:/Volumes/workspace/public/vol/").children(false, 0)
    const file = children.find((child) => child.original.includes("a%20b.csv"))
    expect(file).toBeDefined()
    await file!.remove(false)
    expect(statements.at(-1)).toBe("remove volume `workspace`.`public`.`vol` file 'a b.csv'")
  })

  test("rejects traversal segments and collapses directory markers in root listings", async () => {
    const columns = [{ name: "relative_path", type: "STRING" }, { name: "url", type: "STRING" }, { name: "size", type: "INT" }, { name: "last_modified_time", type: "STRING" }]
    const listing = (rows: unknown[][]) => new FsUtil({
      workspace: "workspace",
      schema: "public",
      execute: async (sql) => {
        if (sql.startsWith("SHOW VOLUME DIRECTORY")) return { ...result(rows), columns }
        throw new Error(`unexpected SQL: ${sql}`)
      },
    })

    // A server-supplied "../.." must not become a local write target during fs cp -R.
    await expect(listing([["../../escape.txt", "", 7, ""]]).ls("czfs:/Volumes/workspace/public/vol/", true))
      .rejects.toMatchObject({ code: "FS_PATH_INVALID" })

    // "logs/" and "logs/app.txt" describe one directory, not two entries.
    const collapsed = await listing([["logs/", "", 0, ""], ["logs/app.txt", "", 7, ""]]).ls("czfs:/Volumes/workspace/public/vol/")
    expect(collapsed).toEqual([expect.objectContaining({ name: "logs", isDir: true })])
  })

  test("lists only real tables as Table Volume roots", async () => {
    const fs = new FsUtil({
      workspace: "workspace",
      schema: "public",
      execute: async (sql) => {
        if (sql === "SHOW TABLES") {
          return {
            ...result([
              ["public", "orders", false, false, false, false],
              ["public", "orders_view", true, false, false, false],
              ["public", "orders_mv", false, true, false, false],
              ["public", "orders_ext", false, false, true, false],
              ["public", "orders_dt", false, false, false, true],
            ]),
            columns: [
              { name: "schema_name", type: "STRING" },
              { name: "table_name", type: "STRING" },
              { name: "is_view", type: "BOOLEAN" },
              { name: "is_materialized_view", type: "BOOLEAN" },
              { name: "is_external", type: "BOOLEAN" },
              { name: "is_dynamic", type: "BOOLEAN" },
            ],
          }
        }
        throw new Error(`unexpected SQL: ${sql}`)
      },
    })

    expect((await fs.ls("czfs:/Volumes/@table")).map((entry) => entry.name)).toEqual(["orders"])
  })

  test("keeps the @user and @table entry points when the Volume list exceeds the limit", async () => {
    const many = Array.from({ length: 101 }, (_, index) => [`vol_${index}`, "workspace", "public"])
    const fs = new FsUtil({
      workspace: "workspace",
      schema: "public",
      execute: async (sql) => {
        if (sql === "SHOW VOLUMES") return { ...result(many), columns: [{ name: "volume_name", type: "STRING" }, { name: "workspace_name", type: "STRING" }, { name: "schema_name", type: "STRING" }] }
        throw new Error(`unexpected SQL: ${sql}`)
      },
    })

    const entries = await fs.ls("czfs:/", false, 5)
    expect(entries.map((entry) => entry.name)).toEqual(["@user", "@table", "vol_0", "vol_1", "vol_2"])
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

  test("preserves the old target when local move cannot remove the source", async () => {
    const sourceDir = join(root, "read-only-source")
    const source = join(sourceDir, "data.txt")
    const target = join(root, "target.txt")
    await mkdir(sourceDir)
    await writeFile(source, "new")
    await writeFile(target, "old")
    const { chmod, readdir } = await import("node:fs/promises")
    await chmod(sourceDir, 0o555)
    try {
      const fs = new FsUtil({ execute: async () => { throw new Error("unexpected SQL") } })
      await expect(fs.mv(source, target, false, true)).rejects.toMatchObject({ code: "PARTIAL_FAILED" })
      expect(await readFile(source, "utf8")).toBe("new")
      expect(await readFile(target, "utf8")).toBe("new")
      const backups = (await readdir(root)).filter((name) => name.startsWith("target.txt.cz-backup-"))
      expect(backups).toHaveLength(1)
      expect(await readFile(join(root, backups[0]!), "utf8")).toBe("old")
    } finally {
      await chmod(sourceDir, 0o755)
    }
  })
})
