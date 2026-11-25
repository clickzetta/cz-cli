import { afterAll, beforeAll, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { staticTokenSource, type StudioConfig } from "@clickzetta/sdk"
import { uploadDatasourceFile } from "../src/commands/datasource.ts"

// Real HTTP: a local server reads the multipart request that actually goes over the wire. A mocked
// File.name assertion passed while the server saw the full local path, so this one does not mock.
const received: { filename?: string; bytes?: string; contentType?: string | null }[] = []
let server: ReturnType<typeof Bun.serve>

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    async fetch(req) {
      const form = await req.formData()
      const file = form.get("file") as File
      received.push({ filename: file.name, bytes: await file.text(), contentType: req.headers.get("content-type") })
      return Response.json({ code: 0, data: "https://storage.invalid/ca.pem?sig=1" })
    },
  })
})

afterAll(() => {
  server.stop(true)
})

test("only the base name of the local file goes over the wire", async () => {
  const nested = join(mkdtempSync(join(tmpdir(), "ds-upload-wire-")), "private", "certs")
  mkdirSync(nested, { recursive: true })
  const path = join(nested, "ca.pem")
  writeFileSync(path, "-----BEGIN CERTIFICATE-----\nabc\n-----END CERTIFICATE-----\n")

  const sc = {
    baseUrl: `http://localhost:${server.port}`,
    tokens: staticTokenSource({ token: "tok", instanceId: 1, userId: 2 }),
    instanceId: 1, workspaceId: 0, projectId: 1, userId: 2, tenantId: 3,
    instanceName: "inst", workspaceName: "ws", env: "prod",
  } as unknown as StudioConfig

  const resp = await uploadDatasourceFile(sc, path)

  expect(resp.data).toBe("https://storage.invalid/ca.pem?sig=1")
  expect(received[0]!.filename).toBe("ca.pem")
  expect(received[0]!.filename).not.toContain("/")
  expect(received[0]!.bytes).toBe("-----BEGIN CERTIFICATE-----\nabc\n-----END CERTIFICATE-----\n")
  expect(received[0]!.contentType).toContain("multipart/form-data; boundary=")
})
