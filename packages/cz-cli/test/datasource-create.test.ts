import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const actualSdk = { ...(await import("@clickzetta/sdk")) }

// mock.module is process-global; restore the real SDK for the suites that run after this one.
afterAll(() => {
  mock.module("@clickzetta/sdk", () => actualSdk)
})

const calls: { path: string; body: unknown; options?: unknown }[] = []

function installSdkMock() {
  mock.module("@clickzetta/sdk", () => ({
    ...actualSdk,
    studioRequest: async (_sc: unknown, path: string, body?: unknown, _headers?: unknown, _method?: string, options?: unknown) => {
      calls.push({ path, body, options })
      if (path.startsWith("/clickzetta-groot/api/v1/storage/uploadFile")) return { code: 0, data: "https://oss.invalid/ca.pem?sig" }
      if (path === "/ide-authority/v1/projectDataSources/create") return { code: 200, data: { id: 42 } }
      return { code: 200, data: true }
    },
  }))
}
installSdkMock()

// "?real" skips other suites' mock of this module while still using the mocked SDK above.
const { createDatasource, deleteDatasource, uploadDatasourceFile, readParamsFile } = await import(
  "../src/commands/datasource.ts?real"
)

const sc = { projectId: 57002, workspaceName: "ws" } as unknown as Parameters<typeof createDatasource>[0]
const dir = mkdtempSync(join(tmpdir(), "ds-create-"))

beforeEach(() => {
  installSdkMock()
  calls.length = 0
})

describe("datasource create", () => {
  test("binds the datasource to the current workspace with one prod connection", async () => {
    const resp = await createDatasource(sc, {
      name: "es_ssl",
      dsType: 13,
      params: { hosts: ["https://es:9200"], tlsVerifyCertificate: true, authType: "API_KEY", apiKey: "k" },
    })
    expect(resp.data?.id).toBe(42)
    const body = calls[0]!.body as Record<string, unknown>
    expect(calls[0]!.path).toBe("/ide-authority/v1/projectDataSources/create")
    expect(body.projectIds).toBe("57002")
    expect(body.relatedProjectId).toBe(57002)
    expect(body.dsName).toBe("es_ssl")
    expect(body.dsType).toBe(13)
    expect(body.modelType).toBe(1)
    const list = body.connectionParamsList as { env: string; connectionParam: string }[]
    expect(list).toHaveLength(1)
    expect(list[0]!.env).toBe("prod")
    expect(JSON.parse(list[0]!.connectionParam)).toEqual({
      dsName: "es_ssl",
      hosts: ["https://es:9200"],
      tlsVerifyCertificate: true,
      authType: "API_KEY",
      apiKey: "k",
    })
  })

  test("writes the description next to dsName in the connection params, where the edit page reads it", async () => {
    await createDatasource(sc, { name: "mysql_a", dsType: 5, params: { jdbcUrl: "jdbc:mysql://h:3306" }, description: "orders db" })
    const body = calls[0]!.body as Record<string, unknown>
    expect(body.dsDesc).toBe("orders db")
    const list = body.connectionParamsList as { connectionParam: string }[]
    expect(JSON.parse(list[0]!.connectionParam)).toEqual({ dsName: "mysql_a", dsDesc: "orders db", jdbcUrl: "jdbc:mysql://h:3306" })
  })

  test("keeps the request body out of the debug log", async () => {
    await createDatasource(sc, { name: "mysql_a", dsType: 5, params: { jdbcUrl: "jdbc:mysql://h:3306", password: "p" } })
    expect(calls[0]!.options).toEqual({ redactBody: true })
  })

  test("the command's name and description replace dsName and dsDesc in the params", async () => {
    await createDatasource(sc, {
      name: "mysql_a", dsType: 5, description: "orders db",
      params: { dsName: "other", dsDesc: "other desc", jdbcUrl: "jdbc:mysql://h:3306" },
    })
    const body = calls[0]!.body as Record<string, unknown>
    const params = JSON.parse((body.connectionParamsList as { connectionParam: string }[])[0]!.connectionParam)
    expect(body.dsName).toBe("mysql_a")
    expect(body.dsDesc).toBe("orders db")
    expect(params).toEqual({ dsName: "mysql_a", dsDesc: "orders db", jdbcUrl: "jdbc:mysql://h:3306" })
  })

  test("a dsDesc in the params does not survive when the command has no description", async () => {
    await createDatasource(sc, { name: "mysql_a", dsType: 5, params: { dsDesc: "from file", jdbcUrl: "jdbc:mysql://h:3306" } })
    const body = calls[0]!.body as Record<string, unknown>
    const params = JSON.parse((body.connectionParamsList as { connectionParam: string }[])[0]!.connectionParam)
    expect(body.dsDesc).toBe("")
    expect(params).toEqual({ dsName: "mysql_a", jdbcUrl: "jdbc:mysql://h:3306" })
  })

  test("adds no dsDesc to the connection params when there is no description", async () => {
    await createDatasource(sc, { name: "mysql_b", dsType: 5, params: { jdbcUrl: "jdbc:mysql://h:3306" } })
    const list = (calls[0]!.body as Record<string, unknown>).connectionParamsList as { connectionParam: string }[]
    expect(JSON.parse(list[0]!.connectionParam)).toEqual({ dsName: "mysql_b", jdbcUrl: "jdbc:mysql://h:3306" })
    expect((calls[0]!.body as Record<string, unknown>).dsDesc).toBe("")
  })
})

describe("datasource delete", () => {
  test("sends the project datasource id", async () => {
    await deleteDatasource(sc, 13744)
    expect(calls[0]).toEqual({ path: "/ide-authority/v1/projectDataSources/delete", body: { id: 13744 } })
  })
})

describe("datasource upload-file", () => {
  test("posts the file as multipart and returns the URL", async () => {
    const path = join(dir, "ca.pem")
    writeFileSync(path, "-----BEGIN CERTIFICATE-----\n")
    const resp = await uploadDatasourceFile(sc, path, 3600)
    expect(resp.data).toBe("https://oss.invalid/ca.pem?sig")
    expect(calls[0]!.path).toBe("/clickzetta-groot/api/v1/storage/uploadFile?expireTimeSeconds=3600")
    const form = calls[0]!.body as FormData
    expect(form).toBeInstanceOf(FormData)
    const file = form.get("file") as File
    expect(file.name).toBe("ca.pem")
    expect(await file.text()).toBe("-----BEGIN CERTIFICATE-----\n")
  })

  test("a missing file fails before any request", async () => {
    await expect(uploadDatasourceFile(sc, join(dir, "missing.pem"))).rejects.toThrow("File not found")
    expect(calls).toHaveLength(0)
  })
})

describe("readParamsFile", () => {
  test("reads a JSON object", async () => {
    const path = join(dir, "params.json")
    writeFileSync(path, '{"hosts":["https://es:9200"],"username":"elastic"}')
    expect(await readParamsFile(path)).toEqual({ hosts: ["https://es:9200"], username: "elastic" })
  })

  test("rejects a JSON array", async () => {
    const path = join(dir, "array.json")
    writeFileSync(path, "[1]")
    await expect(readParamsFile(path)).rejects.toThrow("JSON object")
  })
})
