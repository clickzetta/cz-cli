import { beforeEach, describe, expect, test } from "bun:test"
import { onStudio, stubStudioContext, studioOk } from "./support/cz-fixtures.js"
import { clearTokenCache } from "@clickzetta/sdk"
import { writeFileSync } from "node:fs"
import { join } from "node:path"

// Network-boundary test: no mock.module of our own src or of @clickzetta/sdk. The real
// cz-cli path runs (execute → datasource list → studio-context → SDK) and only the
// network boundary (globalThis.fetch, intercepted in preload) is stubbed via onStudio()
// fixtures. HOME/profile are isolated by test/preload.ts.
//
// `datasource list` must not echo credential material by default: OSS/S3 access keys
// and database passwords in connectionParams are masked with '********' in every
// output format; --show-secrets is the only path to plaintext.
const { execute } = await import("../src/execute.ts")

const OSS_AK = "{{SECRET_y0dzc8o5}}"
const OSS_SK = "{{SECRET_r9i0yaj2}}"
const MYSQL_PW = "{{SECRET_qptpg0qa}}"

beforeEach(() => {
  clearTokenCache()
  writeFileSync(
    join(process.env.CLICKZETTA_TEST_HOME!, ".clickzetta", "profiles.toml"),
    "[profiles.test]\npat = 'pat'\nworkspace = 'wanxin_test_04'\ninstance = 'tmwmzxzs'\n",
  )
  stubStudioContext()
  onStudio("/ide-authority/v1/projectDataSources/list", () =>
    studioOk({
      list: [
        { id: 901, dsName: "oss_src", dsType: 9, status: 1, connectionParams: {
          access_key_id: OSS_AK, access_key_secret: OSS_SK,
          endpoint: "oss-cn-hangzhou.example.com", bucket: "my-bucket",
        } },
        { id: 902, dsName: "mysql_src", dsType: 5, status: 1, connectionParams: {
          username: "dbuser", password: MYSQL_PW,
          jdbcUrl: "jdbc:mysql://rm-bp.example.com:3306/db?password=" + MYSQL_PW + "&useSSL=false",
        } },
      ],
      total: 2,
    }))
})

function json(r: { output: string }) {
  return JSON.parse(r.output.trim().split("\n")[0]) as Record<string, unknown>
}

describe("datasource list secret masking", () => {
  test("masks connection params in the default json output", async () => {
    const r = await execute("datasource list")
    expect(r.exitCode).toBe(0)
    const data = json(r).data as Record<string, unknown>[]

    const oss = data[0]!.connectionParams as Record<string, unknown>
    expect(oss.access_key_id).toBe("********")
    expect(oss.access_key_secret).toBe("********")
    expect(oss.endpoint).toBe("oss-cn-hangzhou.example.com")
    expect(oss.bucket).toBe("my-bucket")

    const mysql = data[1]!.connectionParams as Record<string, unknown>
    expect(mysql.password).toBe("********")
    expect((mysql.jdbcUrl as string)).not.toContain(MYSQL_PW)
    expect(mysql.username).toBe("dbuser")

    expect(r.output).not.toContain(OSS_AK)
    expect(r.output).not.toContain(OSS_SK)
    expect(r.output).not.toContain(MYSQL_PW)
  })

  test("masks connection params in --format text", async () => {
    const r = await execute("datasource list --format text")
    expect(r.exitCode).toBe(0)
    expect(r.output).toContain("********")
    expect(r.output).not.toContain(OSS_AK)
    expect(r.output).not.toContain(OSS_SK)
    expect(r.output).not.toContain(MYSQL_PW)
  })
})
