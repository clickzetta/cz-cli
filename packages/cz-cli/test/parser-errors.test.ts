import { expect, test } from "bun:test"
import { createCli } from "../src/cli"
import { commandGroup } from "../src/command-group"
import { isParserError } from "../src/usage-error"

test("runtime errors named YError are not parser diagnostics", async () => {
  const error = new Error("Not enough arguments following: join")
  error.name = "YError"
  expect(isParserError(error, undefined)).toBe(false)
  for (const grouped of [false, true]) {
    const cli = createCli(["probe"])
    const target = grouped ? commandGroup(cli, "probe") : cli
    target.command("probe", "", () => {}, async () => { throw error })
    await expect(target.parseAsync()).rejects.toBe(error)
  }
})

test("top-level arity errors use the usage envelope and exit code", async () => {
  const child = Bun.spawn([process.execPath, "src/main.ts", "sql", "SELECT 1", "--variable"], {
    cwd: new URL("..", import.meta.url).pathname,
    stdout: "pipe", stderr: "pipe",
  })
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
  ])
  expect(code, stdout + stderr).toBe(2)
  expect(JSON.parse(stdout).error.code).toBe("USAGE_ERROR")
})
