import { expect, test } from "bun:test"

test("SQL cancellation against real HTTP boundaries", async () => {
  // Other SDK suites replace global fetch. Keep real socket/abort semantics
  // isolated rather than replacing fetch again or depending on test order.
  const child = Bun.spawn([process.execPath, "test", "./test/fixtures/cancellation.ts"], {
    cwd: new URL("..", import.meta.url).pathname,
    stdout: "pipe",
    stderr: "pipe",
  })
  const deadline = setTimeout(() => child.kill("SIGKILL"), 10000)
  try {
    const [code, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ])
    expect({ code, failures: code === 0 ? "" : stdout + stderr }).toEqual({ code: 0, failures: "" })
  } finally {
    clearTimeout(deadline)
    child.kill("SIGKILL")
    await child.exited
  }
}, 15000)
