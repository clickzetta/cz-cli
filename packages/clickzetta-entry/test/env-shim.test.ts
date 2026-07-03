import { describe, expect, test } from "bun:test"

// The env-shim runs once at module load, so test it in fresh child processes
// with the env preset (mirrors the deleted core flag-alias.test.ts coverage).
function probe(env: Record<string, string>, readKey: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = Bun.spawn({
      cmd: [
        "bun",
        "-e",
        `import("${import.meta.dir}/../src/env-shim.ts").then(() => { process.stdout.write(String(process.env["${readKey}"] ?? "")) })`,
      ],
      env: { ...process.env, ...env },
      stdout: "pipe",
    })
    new Response(proc.stdout).text().then((t) => resolve(t.trim())).catch(reject)
  })
}

describe("env-shim CLICKZETTA_* → OPENCODE_* mirror", () => {
  test("mirrors a CLICKZETTA_ flag to its OPENCODE_ name", async () => {
    expect(await probe({ CLICKZETTA_DISABLE_AUTOUPDATE: "1" }, "OPENCODE_DISABLE_AUTOUPDATE")).toBe("1")
  })

  test("explicit OPENCODE_ value wins over the CLICKZETTA_ alias", async () => {
    expect(
      await probe({ CLICKZETTA_CONFIG: "/from-cz.json", OPENCODE_CONFIG: "/from-opencode.json" }, "OPENCODE_CONFIG"),
    ).toBe("/from-opencode.json")
  })

  test("no CLICKZETTA_ var set → upstream name stays empty (no-op)", async () => {
    expect(await probe({}, "OPENCODE_MODELS_URL")).toBe("")
  })
})
