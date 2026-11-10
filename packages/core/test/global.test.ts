import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { Global } from "@opencode-ai/core/global"

describe("global paths", () => {
  test("tmp path is under the system temp directory", () => {
    //======================== cz-cli change ========================
    // cz-cli renames the on-disk product identity to "clickzetta" so it does not
    // share global directories with a real opencode install (UPSTREAM-PATCHES #1).
    expect(Global.Path.tmp).toBe(path.join(os.tmpdir(), "clickzetta"))
    //====================== end cz-cli change ======================
    expect(Global.make().tmp).toBe(Global.Path.tmp)
  })

  test("tmp path is created on module load", async () => {
    expect((await fs.stat(Global.Path.tmp)).isDirectory()).toBe(true)
  })
})
