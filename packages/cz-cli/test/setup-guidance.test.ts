import { describe, expect, test } from "bun:test"
import { spawnSync } from "child_process"
import { mkdtempSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import { accountLoginUrlForService, resolveOrAutoSelectOption } from "../src/commands/setup"

function run(args: string[], home = mkdtempSync(join(tmpdir(), "cz-setup-guidance-"))) {
  const result = spawnSync("bun", ["./src/main.ts", ...args], {
    cwd: import.meta.dir + "/..",
    encoding: "utf-8",
    env: { ...process.env, HOME: home },
    stdio: ["ignore", "pipe", "pipe"],
  })
  return {
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    exitCode: result.status ?? 1,
  }
}

function firstJson(output: string) {
  return JSON.parse(output.trim().split("\n")[0] ?? "{}") as Record<string, unknown>
}

describe("setup guidance", () => {
  test("builds account login urls for region and uat api services", () => {
    expect(accountLoginUrlForService("cn-shanghai-alicloud.api.clickzetta.com", "acct")).toBe(
      "https://acct.cn-shanghai-alicloud-accounts.clickzetta.com",
    )
    expect(accountLoginUrlForService("uat-api.clickzetta.com", "acct")).toBe(
      "https://acct.uat-accounts.clickzetta.com",
    )
  })

  test("resolveOrAutoSelectOption auto-selects the only discovered option", () => {
    const result = resolveOrAutoSelectOption(undefined, [{ label: "one", value: "one" }], "instance")
    expect(result.autoSelected).toBe(true)
    expect(result.option).toEqual({ label: "one", value: "one" })
  })

  test("resolveOrAutoSelectOption waits for user choice when multiple options exist", () => {
    const result = resolveOrAutoSelectOption(undefined, [
      { label: "one", value: "one" },
      { label: "two", value: "two" },
    ], "instance")
    expect(result.autoSelected).toBe(false)
    expect(result.option).toBeUndefined()
  })

  test("setup --help explains both new-user and existing-account flows", () => {
    const result = run(["setup", "--help"])
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain("Already have ClickZetta account")
    expect(result.stdout).toContain("username, password, and account name")
    expect(result.stdout).toContain("instance -> workspace -> schema -> vcluster")
    expect(result.stdout).toContain("Non-TTY / agent mode")
  })

  test("non-TTY setup with no args returns staged guidance with next_steps", () => {
    const result = run(["setup"])
    expect(result.exitCode).toBe(1)
    const json = firstJson(result.stdout)
    expect(json.step).toBe("account_fields")
    expect(json.status).toBe("needs_input")
    expect(json.flow).toEqual(["account_fields", "service", "instance", "workspace", "schema", "vcluster", "complete"])
    expect(json.next_steps).toEqual([
      "cz-cli setup --credential <BASE64_CREDENTIAL>",
      "cz-cli setup --username <USERNAME> --password <PASSWORD> --account-name <ACCOUNT_NAME>",
    ])
  })

  test("non-TTY existing-account setup returns next step command when service is missing", () => {
    const result = run(["setup", "--username", "u", "--password", "p", "--account-name", "acct"])
    expect(result.exitCode).toBe(1)
    const json = firstJson(result.stdout)
    expect(json.step).toBe("service")
    expect(json.status).toBe("needs_input")
    expect(Array.isArray(json.options)).toBe(true)
    expect(json.collected).toEqual({ username: "u", account_name: "acct" })
    expect(json.next_steps).toEqual([
      'cz-cli setup --username "u" --password <PASSWORD> --account-name "acct" --service <SERVICE_ENDPOINT>',
    ])
  })
})
