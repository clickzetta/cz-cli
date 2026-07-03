import { expect, test } from "bun:test"
import { spawnSync } from "child_process"
import { mkdtempSync, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

function run(args: string[], home: string) {
  const result = spawnSync("bun", ["./src/main.ts", ...args, "--format", "json"], {
    cwd: import.meta.dir + "/..",
    encoding: "utf-8",
    env: { ...process.env, HOME: home, CLICKZETTA_TEST_HOME: home },
    stdio: ["ignore", "pipe", "pipe"],
  })
  return { stdout: result.stdout ?? "", exitCode: result.status ?? 1 }
}

function firstJson(out: string) {
  return JSON.parse(out.trim().split("\n")[0] ?? "{}") as Record<string, any>
}

test("profile create preserves port and vcluster from --jdbc (bug-38)", () => {
  const home = mkdtempSync(join(tmpdir(), "cz-profile-jdbc-"))
  mkdirSync(join(home, ".clickzetta"), { recursive: true })

  const create = run([
    "profile", "create", "prod",
    "--jdbc", "jdbc:clickzetta://1923808b.10.155.2.214:8033/ab_test?username=ks_bjadmin&password=Ks20241228%23&schema=public&vcluster=DEFAULT&use_http=true",
    "--protocol", "http",
    "--skip-verify",
  ], home)
  expect(create.exitCode).toBe(0)

  const detail = run(["profile", "detail", "prod"], home)
  const d = firstJson(detail.stdout).data
  // service must carry the port so the request hits :8033 (bug-37/bug-38)
  expect(d.service).toBe("10.155.2.214:8033")
  expect(d.vcluster).toBe("DEFAULT")
  expect(d.instance).toBe("1923808b")
  expect(d.workspace).toBe("ab_test")
  expect(d.protocol).toBe("http")
})
