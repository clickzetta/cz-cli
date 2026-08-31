import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtemp, mkdir, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { execute } from "../src/execute.js"

describe("fs commands", () => {
  let root: string

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "cz-cli-fs-"))
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  test("runs local head, ls, cp, and rm through the CLI", async () => {
    const file = join(root, "nested", "hello.txt")
    const copy = join(root, "copy.txt")

    await mkdir(join(root, "nested"), { recursive: true })
    await writeFile(file, "hello 世界")
    const head = await execute(`fs head ${quote(file)} --format json`)
    expect(head.exitCode).toBe(0)
    expect(JSON.parse(head.output).data.content).toBe("hello 世界")

    const listing = await execute(`fs ls ${quote(join(root, "nested"))} --format json`)
    expect(listing.exitCode).toBe(0)
    expect(JSON.parse(listing.output).data.entries[0].name).toBe("hello.txt")

    expect((await execute(`fs cp ${quote(file)} ${quote(copy)}`)).exitCode).toBe(0)
    expect((await execute(`fs rm ${quote(copy)}`)).exitCode).toBe(0)
  })

  test("protects filesystem root and rejects invalid UTF-8 truncation", async () => {
    const file = join(root, "utf8.txt")
    await writeFile(file, Buffer.from("a世"))

    const invalid = await execute(`fs head ${quote(file)} --bytes 2 --format json`)
    expect(invalid.exitCode).toBe(1)
    expect(JSON.parse(invalid.output).error.code).toBe("FS_NOT_TEXT")

    const rootRemoval = await execute("fs rm / -R --format json")
    expect(rootRemoval.exitCode).toBe(2)
    expect(JSON.parse(rootRemoval.output).error.code).toBe("FS_PATH_INVALID")

    const legacyShortFlag = await execute(`fs head ${quote(file)} -c 2 --format json`)
    expect(legacyShortFlag.exitCode).toBe(2)
    expect(JSON.parse(legacyShortFlag.output).error.code).toBe("USAGE_ERROR")

    const rootRecursive = await execute("fs ls czfs:/ -R --format json")
    expect(rootRecursive.exitCode).toBe(2)
    expect(JSON.parse(rootRecursive.output).error.code).toBe("FS_PATH_INVALID")
  })

  test("limits listings and protects existing targets by default", async () => {
    const directory = join(root, "files")
    await mkdir(directory, { recursive: true })
    await Promise.all(["a.txt", "b.txt", "c.txt"].map((name) => writeFile(join(directory, name), name)))

    const listing = await execute(`fs ls ${quote(directory)} --limit 2 --format json`)
    expect(listing.exitCode).toBe(0)
    const payload = JSON.parse(listing.output).data
    expect(payload.entries).toHaveLength(2)
    expect(payload.truncated).toBe(true)

    const source = join(root, "source.txt")
    const target = join(root, "target.txt")
    await writeFile(source, "new")
    await writeFile(target, "old")
    const protectedDefault = await execute(`fs cp ${quote(source)} ${quote(target)} --format json`)
    expect(protectedDefault.exitCode).toBe(1)
    expect(JSON.parse(protectedDefault.output).error.code).toBe("FS_TARGET_EXISTS")
    expect(await Bun.file(target).text()).toBe("old")
    expect((await execute(`fs cp ${quote(source)} ${quote(target)} --overwrite`)).exitCode).toBe(0)
    expect(await Bun.file(target).text()).toBe("new")

    await writeFile(source, "newer")
    const protectedCopy = await execute(`fs cp ${quote(source)} ${quote(target)} --no-overwrite --format json`)
    expect(protectedCopy.exitCode).toBe(1)
    expect(JSON.parse(protectedCopy.output).error.code).toBe("FS_TARGET_EXISTS")
    expect(await Bun.file(target).text()).toBe("new")

    const movedSource = join(root, "move-source.txt")
    const movedTarget = join(root, "move-target.txt")
    await writeFile(movedSource, "moved")
    await writeFile(movedTarget, "old")
    const protectedMove = await execute(`fs mv ${quote(movedSource)} ${quote(movedTarget)} --format json`)
    expect(protectedMove.exitCode).toBe(1)
    expect(JSON.parse(protectedMove.output).error.code).toBe("FS_TARGET_EXISTS")
    expect((await execute(`fs mv ${quote(movedSource)} ${quote(movedTarget)} --overwrite`)).exitCode).toBe(0)
    expect(await Bun.file(movedTarget).text()).toBe("moved")
    expect(await Bun.file(movedSource).exists()).toBe(false)

    const emptySource = join(root, "empty-source")
    const emptyTarget = join(root, "empty-target")
    await mkdir(emptySource)
    expect((await execute(`fs mv ${quote(emptySource)} ${quote(emptyTarget)} -R --format json`)).exitCode).toBe(0)
    expect(await Bun.file(emptySource).exists()).toBe(false)
    expect((await stat(emptyTarget)).isDirectory()).toBe(true)
  })
})

function quote(path: string): string {
  return JSON.stringify(path)
}
