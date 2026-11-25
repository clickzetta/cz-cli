import { beforeEach, describe, expect, test } from "bun:test"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { clearTokenCache } from "@clickzetta/sdk"
import { onStudio, stubStudioContext, studioOk } from "./support/cz-fixtures.js"

// Command-level regression for credential handling: the whole execute → datasource create →
// studio-context → SDK path runs, only fetch is stubbed. A params file keeps credentials out of
// argv, so what is left to check is what the command writes back: stdout, stderr, the debug log
// and the error for a file that does not parse. The request itself must still carry the credential.
const { execute } = await import("../src/execute.ts")

const PASSWORD = "Pw-4f8a1c-secret"
const API_KEY = "ApiKey-91d2e7-secret"
const CREATE_PATH = "/ide-authority/v1/projectDataSources/create"

const dir = mkdtempSync(join(tmpdir(), "ds-create-cmd-"))
const bodies: Record<string, unknown>[] = []

function paramsFile(name: string, content: string) {
  const path = join(dir, name)
  writeFileSync(path, content)
  return path
}

beforeEach(() => {
  clearTokenCache()
  bodies.length = 0
  writeFileSync(
    join(process.env.CLICKZETTA_TEST_HOME!, ".clickzetta", "profiles.toml"),
    "[profiles.test]\npat = 'pat'\nworkspace = 'wanxin_test_04'\ninstance = 'tmwmzxzs'\n",
  )
  stubStudioContext()
  onStudio(CREATE_PATH, (body) => {
    bodies.push(body as Record<string, unknown>)
    return studioOk({ id: 42 })
  })
})

// execute() merges stdout and stderr into one output, so this is everything the command printed.
function everything(r: { output: string }) {
  return r.output
}

describe("datasource create credentials", () => {
  test("--debug does not print the credentials, and the request still carries them", async () => {
    const file = paramsFile("ok.json", JSON.stringify({ jdbcUrl: "jdbc:mysql://h:3306", username: "app", password: PASSWORD, apiKey: API_KEY }))
    const r = await execute(`datasource create mysql_a --type mysql --params-file ${file} --debug`)
    expect(r.exitCode).toBe(0)
    expect(everything(r)).not.toContain(PASSWORD)
    expect(everything(r)).not.toContain(API_KEY)
    expect(everything(r)).toContain("[debug] studioRequest: POST")
    expect(everything(r)).toContain("body=<redacted>")
    const sent = JSON.parse((bodies[0]!.connectionParamsList as { connectionParam: string }[])[0]!.connectionParam)
    expect(sent.password).toBe(PASSWORD)
    expect(sent.apiKey).toBe(API_KEY)
  })

  test("a file that does not parse is rejected without echoing its content", async () => {
    // An unquoted value: the JSON parser's own error would quote it.
    const file = paramsFile("broken.json", `{"username": "app", "password": ${PASSWORD}}`)
    const r = await execute(`datasource create mysql_a --type mysql --params-file ${file}`)
    expect(r.exitCode).not.toBe(0)
    expect(everything(r)).not.toContain(PASSWORD)
    expect(JSON.parse(r.output.trim().split("\n")[0]).error.code).toBe("INVALID_PARAMS")
    expect(bodies).toHaveLength(0)
  })

  test("a JSON value that is not an object is rejected the same way", async () => {
    const file = paramsFile("array.json", JSON.stringify([PASSWORD]))
    const r = await execute(`datasource create mysql_a --type mysql --params-file ${file}`)
    expect(r.exitCode).not.toBe(0)
    expect(everything(r)).not.toContain(PASSWORD)
    expect(JSON.parse(r.output.trim().split("\n")[0]).error.code).toBe("INVALID_PARAMS")
  })

  test("warns that credentials are stored unencrypted, without printing them", async () => {
    const file = paramsFile("cred.json", JSON.stringify({ jdbcUrl: "jdbc:mysql://h:3306", password: PASSWORD }))
    const r = await execute(`datasource create mysql_a --type mysql --params-file ${file}`)
    expect(r.exitCode).toBe(0)
    expect(everything(r)).toContain("stored unencrypted by the backend")
    expect(everything(r)).not.toContain(PASSWORD)
  })

  test("does not warn when the params carry no credential", async () => {
    const file = paramsFile("plain.json", JSON.stringify({ jdbcUrl: "jdbc:mysql://h:3306", username: "app" }))
    const r = await execute(`datasource create mysql_a --type mysql --params-file ${file}`)
    expect(r.exitCode).toBe(0)
    expect(everything(r)).not.toContain("unencrypted")
  })

  test("conflicting dsName and dsDesc in the file lose to the command options", async () => {
    const file = paramsFile("conflict.json", JSON.stringify({ dsName: "other", dsDesc: "other desc", jdbcUrl: "jdbc:mysql://h:3306" }))
    const r = await execute(`datasource create mysql_a --type mysql --params-file ${file} --description orders`)
    expect(r.exitCode).toBe(0)
    const sent = JSON.parse((bodies[0]!.connectionParamsList as { connectionParam: string }[])[0]!.connectionParam)
    expect(bodies[0]!.dsName).toBe("mysql_a")
    expect(bodies[0]!.dsDesc).toBe("orders")
    expect(sent.dsName).toBe("mysql_a")
    expect(sent.dsDesc).toBe("orders")
  })
})
