import { expect, test } from "bun:test"
import { mkdtempSync, mkdirSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

// Exercise the real parser, command handlers and SDK over HTTP. A terminal
// instance error stops at login: these tests need neither a lakehouse nor tokens.
test("native and programmatic commands send JDBC credentials to the requested service", async () => {
  const requests: { target: string; path: string; body: unknown }[] = []
  const servers = ["profile", "jdbc"].map((target) => Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      requests.push({ target, path: new URL(request.url).pathname, body: await request.json() })
      return Response.json({ code: 400, message: "No such element: local routing probe" })
    },
  }))
  const home = mkdtempSync(join(tmpdir(), "cz-jdbc-routing-"))
  mkdirSync(join(home, ".clickzetta"))
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("CZ_") && !key.startsWith("CLICKZETTA_")))
  const jdbc = `jdbc:clickzetta://requested.127.0.0.1:${servers[1].port}/default?schema=idc_ssb100g&vcluster=idc_ap_128&use_http=true`
  const credentials = ["--username", "jdbc-user", "--password", "raw+#% password"]
  const cases = [
    ...[["status"], ["sql", "SELECT 1"], ["schema", "list"], ["table", "list"]].map((command) => ({
      args: [...command, "--jdbc", jdbc, ...credentials], valid: true,
    })),
    { args: ["status", "--jdbc", jdbc, "--protocol", "http", ...credentials], valid: true },
    { args: ["status", "--jdbc", jdbc + "&username=jdbc-user&password=raw%2B%23%25%20password"], valid: true },
    { args: ["status", "--jdbc", "secret-not-a-url", ...credentials], valid: false },
  ]
  try {
    await Bun.write(join(home, ".clickzetta/profiles.toml"), `
default_profile = "local"
[profiles.local]
service = "127.0.0.1:${servers[0].port}"
protocol = "http"
instance = "profile-instance"
workspace = "quick_start"
schema = "public"
username = "profile-user"
password = "profile-password"
`)
    for (const entry of ["runCli", "execute"] as const) {
      for (const scenario of cases) {
        requests.length = 0
        const args = [...scenario.args, "--format", "json"]
        const code = entry === "runCli"
          ? `import { runCliWithTracking } from "./src/run-cli"; await runCliWithTracking(${JSON.stringify(args)})`
          : `import { execute } from "./src/execute"; const result = await execute("", ${JSON.stringify(args)}); console.log(result.output); process.exitCode = result.exitCode`
        const child = Bun.spawn([process.execPath, "-e", code], {
          cwd: join(import.meta.dir, ".."),
          env: { ...env, HOME: home, CLICKZETTA_TEST_HOME: home, OTEL_SDK_DISABLED: "true" },
          stdout: "pipe",
          stderr: "pipe",
        })
        const [stdout, stderr, exit] = await Promise.all([
          new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
        ])
        expect({ entry, args, requests }).toEqual({
          entry,
          args,
          requests: scenario.valid ? [{
            target: "jdbc",
            path: "/clickzetta-portal/user/loginSingle",
            body: { username: "jdbc-user", password: "raw+#% password", instanceName: "requested" },
          }] : [],
        })
        expect(stdout).toContain(scenario.valid ? "local routing probe" : "Invalid --jdbc")
        expect(stdout).not.toContain("secret-not-a-url")
        expect(stderr).toBe("")
        expect(exit).not.toBe(0)
      }
    }
  } finally {
    servers.forEach((server) => server.stop(true))
    rmSync(home, { recursive: true, force: true })
  }
}, 30_000)
